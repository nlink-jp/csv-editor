import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CellEditor, type CommitDirection } from './CellEditor';
import {
    bounds,
    type CellPosition,
    type Selection,
    singleCell,
} from '../selection';
import type { Match } from '../find';

type Row = string[];

interface CellMatchInfo {
    starts: number[];
    ends: number[];
    currentLocal: number; // index within this cell's matches that is "current", or -1
}

// renderTextWithNewlines turns "a\nb" into ["a", <↵ glyph>, "b"] so that
// quoted CSV fields with embedded newlines show their breaks in the
// single-line cell layout. Returns the raw string when there are no
// newlines so React skips array reconciliation in the common case.
function renderTextWithNewlines(
    text: string,
    keyPrefix: string,
): React.ReactNode {
    if (!text.includes('\n')) return text;
    const parts: React.ReactNode[] = [];
    const segments = text.split('\n');
    for (let i = 0; i < segments.length; i++) {
        if (segments[i]) parts.push(segments[i]);
        if (i < segments.length - 1) {
            parts.push(
                <span key={`${keyPrefix}n${i}`} className="vt-cell-newline">
                    ↵
                </span>,
            );
        }
    }
    return parts;
}

function renderCellWithMatches(text: string, info: CellMatchInfo): React.ReactNode {
    if (!text) return text;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (let i = 0; i < info.starts.length; i++) {
        const start = info.starts[i];
        const end = info.ends[i];
        if (start > cursor) {
            parts.push(
                <span key={`pre${i}`}>
                    {renderTextWithNewlines(text.substring(cursor, start), `pre${i}`)}
                </span>,
            );
        }
        const isCurrent = i === info.currentLocal;
        parts.push(
            <span
                key={i}
                className={'vt-match' + (isCurrent ? ' vt-match-current' : '')}
            >
                {renderTextWithNewlines(text.substring(start, end), `m${i}`)}
            </span>,
        );
        cursor = end;
    }
    if (cursor < text.length) {
        parts.push(
            <span key="tail">
                {renderTextWithNewlines(text.substring(cursor), 'tail')}
            </span>,
        );
    }
    return parts;
}

export interface EditingCell {
    rowIndex: number;
    columnIndex: number;
}

export type ContextMenuTarget =
    | { kind: 'cell'; rowIndex: number; columnIndex: number }
    | { kind: 'row'; rowIndex: number }
    | { kind: 'column'; columnIndex: number };

interface VirtualTableProps {
    header: string[] | null;
    rows: string[][];
    maxColumns: number;
    columnWidths: Map<number, number>;
    onResizeColumn: (columnIndex: number, width: number) => void;
    onAutoFitColumn: (columnIndex: number) => void;
    numericColumns: boolean[];
    selection: Selection | null;
    onSelectionChange: (sel: Selection) => void;
    editing: EditingCell | null;
    onStartEdit: (cell: EditingCell) => void;
    onCommitEdit: (value: string, direction: CommitDirection) => void;
    onCancelEdit: () => void;
    editingHeader: number | null;
    onStartHeaderEdit: (columnIndex: number) => void;
    onCommitHeaderEdit: (value: string, direction: CommitDirection) => void;
    onCancelHeaderEdit: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onClear: () => void;
    onMoveRows: (direction: 'up' | 'down') => void;
    onMoveCols: (direction: 'left' | 'right') => void;
    onContextMenu: (e: React.MouseEvent, target: ContextMenuTarget) => void;
    matches: Match[];
    currentMatchIndex: number;
}

const ROW_NUMBER_WIDTH = 64;
const DEFAULT_COL_WIDTH = 160;
const ROW_HEIGHT = 28;
const HEAD_HEIGHT = 32;

export function VirtualTable({
    header,
    rows,
    maxColumns,
    columnWidths,
    onResizeColumn,
    onAutoFitColumn,
    numericColumns,
    selection,
    onSelectionChange,
    editing,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    editingHeader,
    onStartHeaderEdit,
    onCommitHeaderEdit,
    onCancelHeaderEdit,
    onUndo,
    onRedo,
    onCopy,
    onCut,
    onPaste,
    onClear,
    onMoveRows,
    onMoveCols,
    onContextMenu,
    matches,
    currentMatchIndex,
}: VirtualTableProps) {
    // Index matches by cell for O(1) lookup during render.
    const matchesByCell = useMemo(() => {
        const map = new Map<string, CellMatchInfo>();
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const key = `${m.rowIndex},${m.columnIndex}`;
            let info = map.get(key);
            if (!info) {
                info = { starts: [], ends: [], currentLocal: -1 };
                map.set(key, info);
            }
            if (i === currentMatchIndex) info.currentLocal = info.starts.length;
            info.starts.push(m.matchStart);
            info.ends.push(m.matchEnd);
        }
        return map;
    }, [matches, currentMatchIndex]);
    const getColWidth = useCallback(
        (i: number) => columnWidths.get(i) ?? DEFAULT_COL_WIDTH,
        [columnWidths],
    );

    const columns = useMemo<ColumnDef<Row>[]>(() => {
        const cols: ColumnDef<Row>[] = [];
        cols.push({
            id: '__rownum',
            header: '#',
            cell: ({ row }) => row.index + 1,
            size: ROW_NUMBER_WIDTH,
        });
        for (let i = 0; i < maxColumns; i++) {
            cols.push({
                id: `c${i}`,
                header: header?.[i] ?? (header ? `(col ${i + 1})` : `Col ${i + 1}`),
                accessorFn: (row: Row) => row[i] ?? '',
                size: getColWidth(i),
            });
        }
        return cols;
    }, [header, maxColumns, getColWidth]);

    const table = useReactTable({
        data: rows,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const scrollRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    // Header click is deferred so a dblclick (for header rename) can cancel
    // the would-be column selection.
    const headerClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelHeaderClickTimer = useCallback(() => {
        if (headerClickTimerRef.current !== null) {
            clearTimeout(headerClickTimerRef.current);
            headerClickTimerRef.current = null;
        }
    }, []);
    useEffect(() => () => cancelHeaderClickTimer(), [cancelHeaderClickTimer]);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 16,
        scrollPaddingStart: HEAD_HEIGHT,
    });

    const totalWidth = useMemo(() => {
        let sum = ROW_NUMBER_WIDTH;
        for (let i = 0; i < maxColumns; i++) sum += getColWidth(i);
        return sum;
    }, [maxColumns, getColWidth]);
    const lastRow = Math.max(0, rows.length - 1);
    const lastCol = Math.max(0, maxColumns - 1);

    const ensureCellVisible = useCallback(
        (rowIndex: number, columnIndex: number) => {
            const container = scrollRef.current;
            if (!container) return;
            const rowTop = HEAD_HEIGHT + rowIndex * ROW_HEIGHT;
            const rowBottom = rowTop + ROW_HEIGHT;
            const viewTop = container.scrollTop + HEAD_HEIGHT;
            const viewBottom = container.scrollTop + container.clientHeight;
            if (rowTop < viewTop) container.scrollTop = rowTop - HEAD_HEIGHT;
            else if (rowBottom > viewBottom) container.scrollTop = rowBottom - container.clientHeight;

            let cellLeft = ROW_NUMBER_WIDTH;
            for (let i = 0; i < columnIndex; i++) cellLeft += getColWidth(i);
            const cellRight = cellLeft + getColWidth(columnIndex);
            if (cellLeft < container.scrollLeft + ROW_NUMBER_WIDTH)
                container.scrollLeft = cellLeft - ROW_NUMBER_WIDTH;
            else if (cellRight > container.scrollLeft + container.clientWidth)
                container.scrollLeft = cellRight - container.clientWidth;
        },
        [getColWidth],
    );

    const clamp = useCallback(
        (p: CellPosition): CellPosition => ({
            rowIndex: Math.max(0, Math.min(lastRow, p.rowIndex)),
            columnIndex: Math.max(0, Math.min(lastCol, p.columnIndex)),
        }),
        [lastRow, lastCol],
    );

    const setFocus = useCallback(
        (focus: CellPosition, extend: boolean) => {
            const f = clamp(focus);
            const next: Selection = extend && selection
                ? { anchor: selection.anchor, focus: f }
                : singleCell(f);
            onSelectionChange(next);
            ensureCellVisible(f.rowIndex, f.columnIndex);
        },
        [clamp, selection, onSelectionChange, ensureCellVisible],
    );

    const selectRow = useCallback(
        (rowIndex: number, extend: boolean) => {
            scrollRef.current?.focus({ preventScroll: true });
            const next: Selection = extend && selection
                ? {
                      anchor: selection.anchor,
                      focus: { rowIndex, columnIndex: lastCol },
                  }
                : {
                      anchor: { rowIndex, columnIndex: 0 },
                      focus: { rowIndex, columnIndex: lastCol },
                  };
            onSelectionChange(next);
            ensureCellVisible(rowIndex, extend ? next.focus.columnIndex : 0);
        },
        [selection, lastCol, onSelectionChange, ensureCellVisible],
    );

    const selectColumn = useCallback(
        (columnIndex: number, extend: boolean) => {
            scrollRef.current?.focus({ preventScroll: true });
            const next: Selection = extend && selection
                ? {
                      anchor: selection.anchor,
                      focus: { rowIndex: lastRow, columnIndex },
                  }
                : {
                      anchor: { rowIndex: 0, columnIndex },
                      focus: { rowIndex: lastRow, columnIndex },
                  };
            onSelectionChange(next);
            ensureCellVisible(extend ? next.focus.rowIndex : 0, columnIndex);
        },
        [selection, lastRow, onSelectionChange, ensureCellVisible],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (editing || editingHeader !== null) return;
            if (rows.length === 0 || maxColumns === 0) return;

            const cmdOrCtrl = e.metaKey || e.ctrlKey;

            // Alt + arrow moves the selected rows / columns.
            if (e.altKey && !cmdOrCtrl && !e.shiftKey && selection) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    onMoveRows('up');
                    return;
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    onMoveRows('down');
                    return;
                }
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    onMoveCols('left');
                    return;
                }
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    onMoveCols('right');
                    return;
                }
            }

            if (cmdOrCtrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                onUndo();
                return;
            }
            if (
                cmdOrCtrl &&
                ((e.key.toLowerCase() === 'z' && e.shiftKey) ||
                    e.key.toLowerCase() === 'y')
            ) {
                e.preventDefault();
                onRedo();
                return;
            }
            if (cmdOrCtrl && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                onCopy();
                return;
            }
            if (cmdOrCtrl && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                onCut();
                return;
            }
            if (cmdOrCtrl && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                onPaste();
                return;
            }
            if (cmdOrCtrl && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                onSelectionChange({
                    anchor: { rowIndex: 0, columnIndex: 0 },
                    focus: { rowIndex: lastRow, columnIndex: lastCol },
                });
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selection) {
                    e.preventDefault();
                    onClear();
                }
                return;
            }

            if ((e.key === 'Enter' || e.key === 'F2') && selection) {
                e.preventDefault();
                onStartEdit(selection.focus);
                return;
            }

            if (e.key === 'Tab' && selection) {
                e.preventDefault();
                const dir = e.shiftKey ? -1 : 1;
                setFocus(
                    {
                        rowIndex: selection.focus.rowIndex,
                        columnIndex: selection.focus.columnIndex + dir,
                    },
                    false,
                );
                return;
            }

            const navKeys = [
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
                'PageUp',
                'PageDown',
            ];
            if (!navKeys.includes(e.key)) return;

            if (selection == null) {
                e.preventDefault();
                setFocus({ rowIndex: 0, columnIndex: 0 }, false);
                return;
            }

            const pageSize = Math.max(
                1,
                Math.floor(((scrollRef.current?.clientHeight ?? 0) - HEAD_HEIGHT) / ROW_HEIGHT) - 1,
            );

            let { rowIndex: r, columnIndex: c } = selection.focus;
            const cmdJump = cmdOrCtrl;

            switch (e.key) {
                case 'ArrowUp':
                    r = cmdJump ? 0 : r - 1;
                    break;
                case 'ArrowDown':
                    r = cmdJump ? lastRow : r + 1;
                    break;
                case 'ArrowLeft':
                    c = cmdJump ? 0 : c - 1;
                    break;
                case 'ArrowRight':
                    c = cmdJump ? lastCol : c + 1;
                    break;
                case 'Home':
                    c = 0;
                    break;
                case 'End':
                    c = lastCol;
                    break;
                case 'PageUp':
                    r = r - pageSize;
                    break;
                case 'PageDown':
                    r = r + pageSize;
                    break;
            }
            e.preventDefault();
            setFocus({ rowIndex: r, columnIndex: c }, e.shiftKey);
        },
        [
            rows.length,
            maxColumns,
            lastRow,
            lastCol,
            selection,
            editing,
            editingHeader,
            setFocus,
            onSelectionChange,
            onStartEdit,
            onUndo,
            onRedo,
            onCopy,
            onCut,
            onPaste,
            onClear,
            onMoveRows,
            onMoveCols,
        ],
    );

    useEffect(() => {
        if (!editing) scrollRef.current?.focus({ preventScroll: true });
    }, [editing]);

    // Scroll the current match into view whenever it changes.
    useEffect(() => {
        if (currentMatchIndex >= 0 && matches[currentMatchIndex]) {
            const m = matches[currentMatchIndex];
            ensureCellVisible(m.rowIndex, m.columnIndex);
        }
    }, [currentMatchIndex, matches, ensureCellVisible]);

    // Refocus the table on data load — but don't steal focus from a form
    // input the user might currently be typing into (e.g., the find bar).
    useEffect(() => {
        const active = document.activeElement;
        if (
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            active instanceof HTMLSelectElement
        ) {
            return;
        }
        scrollRef.current?.focus({ preventScroll: true });
    }, [rows]);

    useEffect(() => {
        const onUp = () => {
            draggingRef.current = false;
        };
        window.addEventListener('mouseup', onUp);
        return () => window.removeEventListener('mouseup', onUp);
    }, []);

    const selBounds = selection ? bounds(selection) : null;

    return (
        <div
            className="vt-scroll"
            ref={scrollRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            <div
                className="vt-content"
                style={{
                    width: totalWidth,
                    height: HEAD_HEIGHT + rowVirtualizer.getTotalSize(),
                }}
            >
                <div className="vt-head" style={{ width: totalWidth, height: HEAD_HEIGHT }}>
                    {table.getHeaderGroups().map((hg) => (
                        <div className="vt-row vt-row-head" key={hg.id}>
                            {hg.headers.map((h, idx) => {
                                const isRowNumHeader = idx === 0;
                                const dataColIdx = idx - 1;
                                const isHeaderEditable = !isRowNumHeader && header !== null;
                                const isEditingThis =
                                    !isRowNumHeader && editingHeader === dataColIdx;
                                const cellWidth = isRowNumHeader
                                    ? h.getSize()
                                    : getColWidth(dataColIdx);
                                const resizeHandle = isRowNumHeader ? null : (
                                    <div
                                        className="vt-resize-handle"
                                        onMouseDown={(e) => {
                                            if (e.button !== 0) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const startX = e.clientX;
                                            const startWidth = getColWidth(dataColIdx);
                                            const onMove = (ev: MouseEvent) => {
                                                const next = Math.max(
                                                    40,
                                                    Math.round(startWidth + (ev.clientX - startX)),
                                                );
                                                onResizeColumn(dataColIdx, next);
                                            };
                                            const onUp = () => {
                                                window.removeEventListener('mousemove', onMove);
                                                window.removeEventListener('mouseup', onUp);
                                            };
                                            window.addEventListener('mousemove', onMove);
                                            window.addEventListener('mouseup', onUp);
                                        }}
                                        onDoubleClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onAutoFitColumn(dataColIdx);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        title="Drag to resize, double-click to auto-fit"
                                    />
                                );
                                const headerHandlers = isRowNumHeader
                                    ? {}
                                    : {
                                          onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
                                              // Always prevent the browser's default text
                                              // selection on header cells (left, right, and
                                              // middle clicks). Deferring the state-changing
                                              // selectColumn keeps the DOM stable so dblclick
                                              // still fires.
                                              e.preventDefault();
                                              if (e.button !== 0) return;
                                              if (isEditingThis) return;
                                              window.getSelection()?.removeAllRanges();
                                              cancelHeaderClickTimer();
                                              if (e.shiftKey) {
                                                  selectColumn(dataColIdx, true);
                                                  return;
                                              }
                                              headerClickTimerRef.current = setTimeout(() => {
                                                  headerClickTimerRef.current = null;
                                                  selectColumn(dataColIdx, false);
                                              }, 250);
                                          },
                                          onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => {
                                              e.preventDefault();
                                              window.getSelection()?.removeAllRanges();
                                              cancelHeaderClickTimer();
                                              if (isHeaderEditable) onStartHeaderEdit(dataColIdx);
                                          },
                                          onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => {
                                              onContextMenu(e, {
                                                  kind: 'column',
                                                  columnIndex: dataColIdx,
                                              });
                                          },
                                      };
                                return (
                                    <div
                                        className={
                                            'vt-cell vt-cell-head' +
                                            (isEditingThis ? ' vt-cell-editing' : '')
                                        }
                                        key={h.id}
                                        style={{ width: cellWidth }}
                                        {...headerHandlers}
                                    >
                                        {isEditingThis ? (
                                            <CellEditor
                                                initialValue={header?.[dataColIdx] ?? ''}
                                                width={cellWidth}
                                                height={HEAD_HEIGHT}
                                                onCommit={onCommitHeaderEdit}
                                                onCancel={onCancelHeaderEdit}
                                            />
                                        ) : (
                                            flexRender(h.column.columnDef.header, h.getContext())
                                        )}
                                        {resizeHandle}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                {rowVirtualizer.getVirtualItems().map((v) => {
                    const tableRow = table.getRowModel().rows[v.index];
                    return (
                        <div
                            className="vt-row"
                            key={v.key}
                            style={{
                                transform: `translateY(${HEAD_HEIGHT + v.start}px)`,
                                height: ROW_HEIGHT,
                            }}
                        >
                            {tableRow.getVisibleCells().map((cell, colIdx) => {
                                const isRowNum = colIdx === 0;
                                const dataColIdx = colIdx - 1;
                                const inSelection =
                                    !isRowNum &&
                                    selBounds != null &&
                                    v.index >= selBounds.r0 &&
                                    v.index <= selBounds.r1 &&
                                    dataColIdx >= selBounds.c0 &&
                                    dataColIdx <= selBounds.c1;
                                const isFocus =
                                    !isRowNum &&
                                    selection != null &&
                                    selection.focus.rowIndex === v.index &&
                                    selection.focus.columnIndex === dataColIdx;
                                const isEditing =
                                    !isRowNum &&
                                    editing?.rowIndex === v.index &&
                                    editing?.columnIndex === dataColIdx;
                                const isNumericCol =
                                    !isRowNum && numericColumns[dataColIdx] === true;
                                const className =
                                    'vt-cell' +
                                    (isRowNum ? ' vt-cell-rownum' : '') +
                                    (isNumericCol ? ' vt-cell-numeric' : '') +
                                    (inSelection ? ' vt-cell-selected' : '') +
                                    (isFocus ? ' vt-cell-focus' : '') +
                                    (isEditing ? ' vt-cell-editing' : '');
                                const cellWidth = cell.column.getSize();
                                const cellHandlers = isRowNum
                                    ? {
                                          onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
                                              // Always suppress default mousedown so neither
                                              // left- nor right-click extends the WebView
                                              // text selection over the row number label.
                                              e.preventDefault();
                                              if (e.button !== 0) return;
                                              window.getSelection()?.removeAllRanges();
                                              selectRow(v.index, e.shiftKey);
                                          },
                                          onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => {
                                              onContextMenu(e, { kind: 'row', rowIndex: v.index });
                                          },
                                      }
                                    : {
                                          onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
                                              if (e.button === 2) {
                                                  // Right-click: don't change the selection,
                                                  // but suppress any text selection extension.
                                                  e.preventDefault();
                                                  return;
                                              }
                                              if (e.button !== 0) return;
                                              if (e.shiftKey) {
                                                  e.preventDefault();
                                                  window.getSelection()?.removeAllRanges();
                                              }
                                              scrollRef.current?.focus({ preventScroll: true });
                                              const pos: CellPosition = {
                                                  rowIndex: v.index,
                                                  columnIndex: dataColIdx,
                                              };
                                              draggingRef.current = true;
                                              setFocus(pos, e.shiftKey);
                                          },
                                          onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
                                              if (!draggingRef.current) return;
                                              if (e.buttons === 0) {
                                                  draggingRef.current = false;
                                                  return;
                                              }
                                              setFocus(
                                                  {
                                                      rowIndex: v.index,
                                                      columnIndex: dataColIdx,
                                                  },
                                                  true,
                                              );
                                          },
                                          onDoubleClick: () =>
                                              onStartEdit({
                                                  rowIndex: v.index,
                                                  columnIndex: dataColIdx,
                                              }),
                                          onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => {
                                              onContextMenu(e, {
                                                  kind: 'cell',
                                                  rowIndex: v.index,
                                                  columnIndex: dataColIdx,
                                              });
                                          },
                                      };
                                const cellText = rows[v.index]?.[dataColIdx] ?? '';
                                const cellMatches = isRowNum
                                    ? undefined
                                    : matchesByCell.get(`${v.index},${dataColIdx}`);
                                return (
                                    <div
                                        key={cell.id}
                                        className={className}
                                        style={{ width: cellWidth }}
                                        {...cellHandlers}
                                    >
                                        {cellMatches ? (
                                            renderCellWithMatches(cellText, cellMatches)
                                        ) : cellText.includes('\n') ? (
                                            renderTextWithNewlines(cellText, 'cell')
                                        ) : (
                                            flexRender(cell.column.columnDef.cell, cell.getContext())
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
