import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

type Row = string[];

export interface SelectedCell {
    rowIndex: number;
    columnIndex: number;
}

interface VirtualTableProps {
    header: string[] | null;
    rows: string[][];
    maxColumns: number;
    selected: SelectedCell | null;
    onSelect: (cell: SelectedCell) => void;
}

const ROW_NUMBER_WIDTH = 64;
const DEFAULT_COL_WIDTH = 160;
const ROW_HEIGHT = 28;
const HEAD_HEIGHT = 32;

export function VirtualTable({
    header,
    rows,
    maxColumns,
    selected,
    onSelect,
}: VirtualTableProps) {
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
                size: DEFAULT_COL_WIDTH,
            });
        }
        return cols;
    }, [header, maxColumns]);

    const table = useReactTable({
        data: rows,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const scrollRef = useRef<HTMLDivElement>(null);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 16,
        scrollPaddingStart: HEAD_HEIGHT,
    });

    const totalWidth = ROW_NUMBER_WIDTH + maxColumns * DEFAULT_COL_WIDTH;

    const ensureCellVisible = useCallback(
        (rowIndex: number, columnIndex: number) => {
            const container = scrollRef.current;
            if (!container) return;

            const rowTop = HEAD_HEIGHT + rowIndex * ROW_HEIGHT;
            const rowBottom = rowTop + ROW_HEIGHT;
            const viewTop = container.scrollTop + HEAD_HEIGHT;
            const viewBottom = container.scrollTop + container.clientHeight;
            if (rowTop < viewTop) {
                container.scrollTop = rowTop - HEAD_HEIGHT;
            } else if (rowBottom > viewBottom) {
                container.scrollTop = rowBottom - container.clientHeight;
            }

            const cellLeft = ROW_NUMBER_WIDTH + columnIndex * DEFAULT_COL_WIDTH;
            const cellRight = cellLeft + DEFAULT_COL_WIDTH;
            if (cellLeft < container.scrollLeft + ROW_NUMBER_WIDTH) {
                container.scrollLeft = cellLeft - ROW_NUMBER_WIDTH;
            } else if (cellRight > container.scrollLeft + container.clientWidth) {
                container.scrollLeft = cellRight - container.clientWidth;
            }
        },
        [],
    );

    const moveSelection = useCallback(
        (rowIndex: number, columnIndex: number) => {
            const r = Math.max(0, Math.min(rows.length - 1, rowIndex));
            const c = Math.max(0, Math.min(maxColumns - 1, columnIndex));
            onSelect({ rowIndex: r, columnIndex: c });
            ensureCellVisible(r, c);
        },
        [rows.length, maxColumns, onSelect, ensureCellVisible],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (rows.length === 0 || maxColumns === 0) return;

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

            // No selection yet: any nav key starts at (0, 0).
            if (selected == null) {
                e.preventDefault();
                moveSelection(0, 0);
                return;
            }

            const cmdOrCtrl = e.metaKey || e.ctrlKey;
            const pageSize = Math.max(
                1,
                Math.floor(((scrollRef.current?.clientHeight ?? 0) - HEAD_HEIGHT) / ROW_HEIGHT) - 1,
            );

            let r = selected.rowIndex;
            let c = selected.columnIndex;

            switch (e.key) {
                case 'ArrowUp':
                    r = cmdOrCtrl ? 0 : r - 1;
                    break;
                case 'ArrowDown':
                    r = cmdOrCtrl ? rows.length - 1 : r + 1;
                    break;
                case 'ArrowLeft':
                    c = cmdOrCtrl ? 0 : c - 1;
                    break;
                case 'ArrowRight':
                    c = cmdOrCtrl ? maxColumns - 1 : c + 1;
                    break;
                case 'Home':
                    c = 0;
                    break;
                case 'End':
                    c = maxColumns - 1;
                    break;
                case 'PageUp':
                    r = r - pageSize;
                    break;
                case 'PageDown':
                    r = r + pageSize;
                    break;
            }

            e.preventDefault();
            moveSelection(r, c);
        },
        [rows.length, maxColumns, selected, moveSelection],
    );

    // Focus the table when data changes so keyboard navigation works without
    // an explicit click. preventScroll keeps the page from jumping.
    useEffect(() => {
        scrollRef.current?.focus({ preventScroll: true });
    }, [rows]);

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
                            {hg.headers.map((h) => (
                                <div
                                    className="vt-cell vt-cell-head"
                                    key={h.id}
                                    style={{ width: h.getSize() }}
                                >
                                    {flexRender(h.column.columnDef.header, h.getContext())}
                                </div>
                            ))}
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
                                const isSelected =
                                    !isRowNum &&
                                    selected?.rowIndex === v.index &&
                                    selected?.columnIndex === dataColIdx;
                                const className =
                                    'vt-cell' +
                                    (isRowNum ? ' vt-cell-rownum' : '') +
                                    (isSelected ? ' vt-cell-selected' : '');
                                return (
                                    <div
                                        key={cell.id}
                                        className={className}
                                        style={{ width: cell.column.getSize() }}
                                        onClick={
                                            isRowNum
                                                ? undefined
                                                : () => {
                                                      scrollRef.current?.focus({ preventScroll: true });
                                                      onSelect({
                                                          rowIndex: v.index,
                                                          columnIndex: dataColIdx,
                                                      });
                                                  }
                                        }
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
