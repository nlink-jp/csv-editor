import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import './App.css';
import { StatusBar } from './components/StatusBar';
import {
    VirtualTable,
    type ContextMenuTarget,
    type EditingCell,
} from './components/VirtualTable';
import type { CommitDirection } from './components/CellEditor';
import { ContextMenu, type MenuItem } from './components/ContextMenu';
import {
    ConfirmDialog,
    LoadFile,
    NewFile,
    SaveFile,
    SaveFileDialog,
    SupportedReadEncodings,
} from '../wailsjs/go/main/Bindings';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { main } from '../wailsjs/go/models';
import {
    initialState,
    isDirty,
    reducer,
    type PendingEdit,
    type Rect,
} from './state';
import {
    bounds,
    singleCell,
    type CellPosition,
    type Selection,
} from './selection';
import { decodeTSV, encodeTSV } from './tsv';

function App() {
    const [state, dispatch] = useReducer(reducer, initialState);
    const [supportedEncodings, setSupportedEncodings] = useState<string[]>([]);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [editing, setEditing] = useState<EditingCell | null>(null);
    const [editingHeader, setEditingHeader] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        items: MenuItem[];
        x: number;
        y: number;
    } | null>(null);

    const { file, rows } = state;
    const dirty = isDirty(state);

    const maxColumns = useMemo(() => {
        let m = file?.hasHeader && file.header ? file.header.length : 0;
        for (const row of rows) if (row.length > m) m = row.length;
        return Math.max(m, file?.maxColumns ?? 0);
    }, [file?.hasHeader, file?.header, file?.maxColumns, rows]);

    useEffect(() => {
        SupportedReadEncodings().then(setSupportedEncodings).catch(() => {});
    }, []);

    useEffect(() => {
        const offLoaded = EventsOn('file:loaded', (payload: main.FileLoadResult) => {
            dispatch({ type: 'LOAD', payload });
            setSelection(null);
            setEditing(null);
            setError(null);
        });
        const offError = EventsOn('file:error', (message: string) => {
            setError(message);
        });
        return () => {
            offLoaded();
            offError();
        };
    }, []);

    const handleSaveAs = useCallback(async () => {
        if (!file) return;
        try {
            const path = await SaveFileDialog(file.filename);
            if (!path) return;
            const delimiter = path.toLowerCase().endsWith('.tsv') ? '\t' : ',';
            await SaveFile(
                path,
                file.usedEncoding,
                file.lineEnding,
                delimiter,
                file.hasHeader,
                file.hasHeader ? file.header : [],
                rows,
            );
            const filename = path.split(/[\\/]/).pop() ?? path;
            dispatch({
                type: 'UPDATE_FILE',
                patch: { path, filename, delimiter },
            });
            dispatch({ type: 'SAVED' });
            setError(null);
        } catch (e) {
            setError(String(e));
        }
    }, [file, rows]);

    // Save falls back to Save As when there's no path (e.g., newly created
    // Untitled file).
    const handleSave = useCallback(async () => {
        if (!file) return;
        if (!file.path) {
            await handleSaveAs();
            return;
        }
        try {
            await SaveFile(
                file.path,
                file.usedEncoding,
                file.lineEnding,
                file.delimiter,
                file.hasHeader,
                file.hasHeader ? file.header : [],
                rows,
            );
            dispatch({ type: 'SAVED' });
            setError(null);
        } catch (e) {
            setError(String(e));
        }
    }, [file, rows, handleSaveAs]);

    const handleNew = useCallback(async () => {
        if (dirty) {
            try {
                const ok = await ConfirmDialog(
                    'Discard changes?',
                    'You have unsaved changes. Create a new file anyway?',
                );
                if (!ok) return;
            } catch (e) {
                setError(String(e));
                return;
            }
        }
        try {
            const blank = await NewFile();
            dispatch({ type: 'LOAD', payload: blank });
            setSelection(null);
            setEditing(null);
            setEditingHeader(null);
            setError(null);
        } catch (e) {
            setError(String(e));
        }
    }, [dirty]);

    useEffect(() => {
        const offSave = EventsOn('menu:save', () => {
            handleSave();
        });
        const offSaveAs = EventsOn('menu:saveAs', () => {
            handleSaveAs();
        });
        const offNew = EventsOn('menu:new', () => {
            handleNew();
        });
        return () => {
            offSave();
            offSaveAs();
            offNew();
        };
    }, [handleSave, handleSaveAs, handleNew]);

    const handleEncodingChange = useCallback(
        async (encoding: string) => {
            if (!file) return;
            // No backing file (Untitled, or never saved) → just update the
            // metadata in memory; nothing to re-decode.
            if (!file.path) {
                dispatch({ type: 'UPDATE_FILE', patch: { usedEncoding: encoding } });
                return;
            }
            if (dirty) {
                try {
                    const ok = await ConfirmDialog(
                        'Discard changes?',
                        `Re-reading the file with ${encoding} will discard your unsaved edits. Continue?`,
                    );
                    if (!ok) return;
                } catch (e) {
                    setError(String(e));
                    return;
                }
            }
            try {
                const result = await LoadFile(file.path, encoding, file.delimiter, file.hasHeader);
                dispatch({ type: 'LOAD', payload: result });
                setSelection(null);
                setEditing(null);
                setEditingHeader(null);
                setError(null);
            } catch (e) {
                setError(String(e));
            }
        },
        [file, dirty],
    );

    // hasHeader is purely an in-memory interpretation — toggling it just
    // shuffles the first row between rows[] and header[]. This avoids
    // re-reading the file (which would fail for Untitled documents and
    // would silently discard unsaved edits).
    const handleHasHeaderToggle = useCallback(
        (hasHeader: boolean) => {
            if (!file) return;
            dispatch({ type: 'SET_HAS_HEADER', value: hasHeader });
            setSelection(null);
            setEditing(null);
            setEditingHeader(null);
        },
        [file],
    );

    const handleLineEndingChange = useCallback((lineEnding: string) => {
        dispatch({ type: 'UPDATE_FILE', patch: { lineEnding } });
    }, []);

    const handleStartEdit = useCallback((cell: EditingCell) => {
        setEditing(cell);
    }, []);

    const handleCommitEdit = useCallback(
        (value: string, direction: CommitDirection) => {
            if (!editing) {
                setEditing(null);
                return;
            }
            dispatch({
                type: 'APPLY_EDITS',
                edits: [
                    {
                        rowIndex: editing.rowIndex,
                        columnIndex: editing.columnIndex,
                        value,
                    },
                ],
            });
            setEditing(null);
            if (direction !== 'none') {
                let r = editing.rowIndex;
                let c = editing.columnIndex;
                if (direction === 'up') r = Math.max(0, r - 1);
                if (direction === 'down') r = Math.min(rows.length - 1, r + 1);
                if (direction === 'left') c = Math.max(0, c - 1);
                if (direction === 'right') c = Math.min(maxColumns - 1, c + 1);
                setSelection(singleCell({ rowIndex: r, columnIndex: c }));
            }
        },
        [editing, maxColumns, rows.length],
    );

    const handleCancelEdit = useCallback(() => {
        setEditing(null);
    }, []);

    const handleStartHeaderEdit = useCallback((columnIndex: number) => {
        setEditingHeader(columnIndex);
    }, []);

    const handleCommitHeaderEdit = useCallback(
        (value: string, direction: CommitDirection) => {
            if (editingHeader === null) {
                setEditingHeader(null);
                return;
            }
            dispatch({
                type: 'RENAME_COLUMN',
                columnIndex: editingHeader,
                value,
            });
            // Move to neighbor header on Tab. Enter just exits.
            if (direction === 'left' || direction === 'right') {
                const delta = direction === 'left' ? -1 : 1;
                const next = editingHeader + delta;
                if (next >= 0 && next < maxColumns) {
                    setEditingHeader(next);
                    return;
                }
            }
            setEditingHeader(null);
        },
        [editingHeader, maxColumns],
    );

    const handleCancelHeaderEdit = useCallback(() => {
        setEditingHeader(null);
    }, []);

    const handleUndo = useCallback(() => dispatch({ type: 'UNDO' }), []);
    const handleRedo = useCallback(() => dispatch({ type: 'REDO' }), []);

    const handleCopy = useCallback(async () => {
        if (!selection) return;
        const b = bounds(selection);
        const grid: string[][] = [];
        for (let r = b.r0; r <= b.r1; r++) {
            const row: string[] = [];
            for (let c = b.c0; c <= b.c1; c++) {
                row.push(rows[r]?.[c] ?? '');
            }
            grid.push(row);
        }
        try {
            await navigator.clipboard.writeText(encodeTSV(grid));
        } catch (e) {
            setError(`Clipboard copy failed: ${e}`);
        }
    }, [selection, rows]);

    const handleClear = useCallback(() => {
        if (!selection) return;
        const b = bounds(selection);
        dispatch({ type: 'CLEAR_CELLS', rect: b as Rect });
    }, [selection]);

    const handleCut = useCallback(async () => {
        await handleCopy();
        handleClear();
    }, [handleCopy, handleClear]);

    const handlePaste = useCallback(async () => {
        if (!selection || !file) return;
        let text: string;
        try {
            text = await navigator.clipboard.readText();
        } catch (e) {
            setError(`Clipboard read failed: ${e}`);
            return;
        }
        if (!text) return;
        const grid = decodeTSV(text);
        if (grid.length === 0) return;

        const b = bounds(selection);
        const selRows = b.r1 - b.r0 + 1;
        const selCols = b.c1 - b.c0 + 1;
        const clipRows = grid.length;
        const clipCols = grid.reduce((m, r) => Math.max(m, r.length), 0);

        const singleCellSelected = selRows === 1 && selCols === 1;
        const shapeMatches = selRows === clipRows && selCols === clipCols;
        const overflowsRows = b.r0 + clipRows > rows.length;
        const overflowsCols = b.c0 + clipCols > maxColumns;
        const wouldExtend = overflowsRows || overflowsCols;

        const reasons: string[] = [];
        if (!singleCellSelected && !shapeMatches) {
            reasons.push(
                `clipboard (${clipRows}×${clipCols}) doesn't match the selected ${selRows}×${selCols} range`,
            );
        }
        if (wouldExtend) {
            const newRows = Math.max(rows.length, b.r0 + clipRows);
            const newCols = Math.max(maxColumns, b.c0 + clipCols);
            reasons.push(
                `paste will extend the table to ${newRows} rows × ${newCols} columns`,
            );
        }
        if (reasons.length > 0) {
            try {
                const ok = await ConfirmDialog(
                    'Confirm paste',
                    `${reasons.join('; ')}. Continue?`,
                );
                if (!ok) return;
            } catch (e) {
                setError(`Dialog failed: ${e}`);
                return;
            }
        }

        const edits: PendingEdit[] = [];
        for (let r = 0; r < clipRows; r++) {
            const clipRow = grid[r];
            for (let c = 0; c < clipRow.length; c++) {
                edits.push({
                    rowIndex: b.r0 + r,
                    columnIndex: b.c0 + c,
                    value: clipRow[c],
                });
            }
        }
        if (edits.length === 0) return;
        dispatch({ type: 'APPLY_EDITS', edits });

        const newAnchor: CellPosition = { rowIndex: b.r0, columnIndex: b.c0 };
        const newFocus: CellPosition = {
            rowIndex: b.r0 + clipRows - 1,
            columnIndex: b.c0 + clipCols - 1,
        };
        setSelection({ anchor: newAnchor, focus: newFocus });
    }, [selection, file, rows, rows.length, maxColumns]);

    // --- Structural row/column operations ---

    // Range of currently-selected rows when the selection spans full rows
    // (or when the target is from a row-header right-click).
    const selectedRowRange = useCallback(
        (fallback: number): { start: number; count: number } => {
            if (
                selection &&
                selection.anchor.columnIndex === 0 &&
                selection.focus.columnIndex === Math.max(0, maxColumns - 1)
            ) {
                const b = bounds(selection);
                return { start: b.r0, count: b.r1 - b.r0 + 1 };
            }
            return { start: fallback, count: 1 };
        },
        [selection, maxColumns],
    );

    const selectedColRange = useCallback(
        (fallback: number): { start: number; count: number } => {
            if (
                selection &&
                selection.anchor.rowIndex === 0 &&
                selection.focus.rowIndex === Math.max(0, rows.length - 1)
            ) {
                const b = bounds(selection);
                return { start: b.c0, count: b.c1 - b.c0 + 1 };
            }
            return { start: fallback, count: 1 };
        },
        [selection, rows.length],
    );

    const insertRowsAbove = useCallback(
        (atIndex: number, count: number) => {
            dispatch({ type: 'INSERT_ROWS', atIndex, count });
            setSelection({
                anchor: { rowIndex: atIndex, columnIndex: 0 },
                focus: {
                    rowIndex: atIndex + count - 1,
                    columnIndex: Math.max(0, maxColumns - 1),
                },
            });
        },
        [maxColumns],
    );

    const insertRowsBelow = useCallback(
        (atIndex: number, count: number) => {
            const at = atIndex + 1;
            dispatch({ type: 'INSERT_ROWS', atIndex: at, count });
            setSelection({
                anchor: { rowIndex: at, columnIndex: 0 },
                focus: {
                    rowIndex: at + count - 1,
                    columnIndex: Math.max(0, maxColumns - 1),
                },
            });
        },
        [maxColumns],
    );

    const deleteRows = useCallback(
        (startIndex: number, count: number) => {
            dispatch({ type: 'DELETE_ROWS', startIndex, count });
            const remaining = rows.length - count;
            if (remaining <= 0) {
                setSelection(null);
            } else {
                const r = Math.min(startIndex, remaining - 1);
                setSelection({
                    anchor: { rowIndex: r, columnIndex: 0 },
                    focus: { rowIndex: r, columnIndex: Math.max(0, maxColumns - 1) },
                });
            }
        },
        [rows.length, maxColumns],
    );

    const duplicateRows = useCallback(
        (startIndex: number, count: number) => {
            dispatch({ type: 'DUPLICATE_ROWS', startIndex, count });
            const newStart = startIndex + count;
            setSelection({
                anchor: { rowIndex: newStart, columnIndex: 0 },
                focus: {
                    rowIndex: newStart + count - 1,
                    columnIndex: Math.max(0, maxColumns - 1),
                },
            });
        },
        [maxColumns],
    );

    const insertColsLeft = useCallback(
        (atIndex: number, count: number) => {
            dispatch({ type: 'INSERT_COLS', atIndex, count });
            setSelection({
                anchor: { rowIndex: 0, columnIndex: atIndex },
                focus: {
                    rowIndex: Math.max(0, rows.length - 1),
                    columnIndex: atIndex + count - 1,
                },
            });
        },
        [rows.length],
    );

    const insertColsRight = useCallback(
        (atIndex: number, count: number) => {
            const at = atIndex + 1;
            dispatch({ type: 'INSERT_COLS', atIndex: at, count });
            setSelection({
                anchor: { rowIndex: 0, columnIndex: at },
                focus: {
                    rowIndex: Math.max(0, rows.length - 1),
                    columnIndex: at + count - 1,
                },
            });
        },
        [rows.length],
    );

    const deleteCols = useCallback(
        (startIndex: number, count: number) => {
            dispatch({ type: 'DELETE_COLS', startIndex, count });
            const remaining = maxColumns - count;
            if (remaining <= 0) {
                setSelection(null);
            } else {
                const c = Math.min(startIndex, remaining - 1);
                setSelection({
                    anchor: { rowIndex: 0, columnIndex: c },
                    focus: { rowIndex: Math.max(0, rows.length - 1), columnIndex: c },
                });
            }
        },
        [rows.length, maxColumns],
    );

    const duplicateCols = useCallback(
        (startIndex: number, count: number) => {
            dispatch({ type: 'DUPLICATE_COLS', startIndex, count });
            const newStart = startIndex + count;
            setSelection({
                anchor: { rowIndex: 0, columnIndex: newStart },
                focus: {
                    rowIndex: Math.max(0, rows.length - 1),
                    columnIndex: newStart + count - 1,
                },
            });
        },
        [rows.length],
    );

    const moveRows = useCallback(
        (startIndex: number, count: number, direction: 'up' | 'down') => {
            dispatch({ type: 'MOVE_ROWS', startIndex, count, direction });
            const delta = direction === 'up' ? -1 : 1;
            const newStart = startIndex + delta;
            if (newStart < 0 || newStart + count > rows.length) return;
            setSelection({
                anchor: { rowIndex: newStart, columnIndex: 0 },
                focus: {
                    rowIndex: newStart + count - 1,
                    columnIndex: Math.max(0, maxColumns - 1),
                },
            });
        },
        [rows.length, maxColumns],
    );

    const moveCols = useCallback(
        (startIndex: number, count: number, direction: 'left' | 'right') => {
            dispatch({ type: 'MOVE_COLS', startIndex, count, direction });
            const delta = direction === 'left' ? -1 : 1;
            const newStart = startIndex + delta;
            if (newStart < 0 || newStart + count > maxColumns) return;
            setSelection({
                anchor: { rowIndex: 0, columnIndex: newStart },
                focus: {
                    rowIndex: Math.max(0, rows.length - 1),
                    columnIndex: newStart + count - 1,
                },
            });
        },
        [rows.length, maxColumns],
    );

    // Alt+arrow shortcut handlers — operate on whatever the selection is
    // currently covering (defaults to focus row/col).
    const moveRowsByKey = useCallback(
        (direction: 'up' | 'down') => {
            if (!selection) return;
            const fb = selection.focus.rowIndex;
            const range = selectedRowRange(fb);
            moveRows(range.start, range.count, direction);
        },
        [selection, selectedRowRange, moveRows],
    );

    const moveColsByKey = useCallback(
        (direction: 'left' | 'right') => {
            if (!selection) return;
            const fb = selection.focus.columnIndex;
            const range = selectedColRange(fb);
            moveCols(range.start, range.count, direction);
        },
        [selection, selectedColRange, moveCols],
    );

    const handleContextMenu = useCallback(
        (e: React.MouseEvent, target: ContextMenuTarget) => {
            e.preventDefault();
            let items: MenuItem[];
            switch (target.kind) {
                case 'row': {
                    const range = selectedRowRange(target.rowIndex);
                    const label = range.count === 1 ? 'row' : `${range.count} rows`;
                    items = [
                        {
                            label: `Insert ${label} above`,
                            onClick: () => insertRowsAbove(range.start, range.count),
                        },
                        {
                            label: `Insert ${label} below`,
                            onClick: () =>
                                insertRowsBelow(range.start + range.count - 1, range.count),
                        },
                        {
                            label: `Duplicate ${label}`,
                            onClick: () => duplicateRows(range.start, range.count),
                        },
                        {
                            label: `Move ${label} up`,
                            onClick: () => moveRows(range.start, range.count, 'up'),
                            disabled: range.start === 0,
                            separatorBefore: true,
                        },
                        {
                            label: `Move ${label} down`,
                            onClick: () => moveRows(range.start, range.count, 'down'),
                            disabled: range.start + range.count >= rows.length,
                        },
                        {
                            label: `Delete ${label}`,
                            onClick: () => deleteRows(range.start, range.count),
                            separatorBefore: true,
                        },
                    ];
                    break;
                }
                case 'column': {
                    const range = selectedColRange(target.columnIndex);
                    const label = range.count === 1 ? 'column' : `${range.count} columns`;
                    items = [
                        {
                            label: `Insert ${label} left`,
                            onClick: () => insertColsLeft(range.start, range.count),
                        },
                        {
                            label: `Insert ${label} right`,
                            onClick: () =>
                                insertColsRight(range.start + range.count - 1, range.count),
                        },
                        {
                            label: `Duplicate ${label}`,
                            onClick: () => duplicateCols(range.start, range.count),
                        },
                        {
                            label: `Move ${label} left`,
                            onClick: () => moveCols(range.start, range.count, 'left'),
                            disabled: range.start === 0,
                            separatorBefore: true,
                        },
                        {
                            label: `Move ${label} right`,
                            onClick: () => moveCols(range.start, range.count, 'right'),
                            disabled: range.start + range.count >= maxColumns,
                        },
                        {
                            label: `Delete ${label}`,
                            onClick: () => deleteCols(range.start, range.count),
                            separatorBefore: true,
                        },
                    ];
                    break;
                }
                case 'cell':
                default:
                    items = [
                        { label: 'Cut', onClick: () => handleCut() },
                        { label: 'Copy', onClick: () => handleCopy() },
                        { label: 'Paste', onClick: () => handlePaste() },
                        {
                            label: 'Clear contents',
                            onClick: () => handleClear(),
                            separatorBefore: true,
                        },
                    ];
                    break;
            }
            setContextMenu({ items, x: e.clientX, y: e.clientY });
        },
        [
            selectedRowRange,
            selectedColRange,
            insertRowsAbove,
            insertRowsBelow,
            duplicateRows,
            deleteRows,
            moveRows,
            insertColsLeft,
            insertColsRight,
            duplicateCols,
            deleteCols,
            moveCols,
            handleCut,
            handleCopy,
            handlePaste,
            handleClear,
            rows.length,
            maxColumns,
        ],
    );

    return (
        <div id="App">
            {error && (
                <div className="error-bar" onClick={() => setError(null)}>
                    {error}
                </div>
            )}
            {file ? (
                <VirtualTable
                    header={file.hasHeader ? file.header : null}
                    rows={rows}
                    maxColumns={maxColumns}
                    selection={selection}
                    onSelectionChange={setSelection}
                    editing={editing}
                    onStartEdit={handleStartEdit}
                    onCommitEdit={handleCommitEdit}
                    onCancelEdit={handleCancelEdit}
                    editingHeader={editingHeader}
                    onStartHeaderEdit={handleStartHeaderEdit}
                    onCommitHeaderEdit={handleCommitHeaderEdit}
                    onCancelHeaderEdit={handleCancelHeaderEdit}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onCopy={handleCopy}
                    onCut={handleCut}
                    onPaste={handlePaste}
                    onClear={handleClear}
                    onMoveRows={moveRowsByKey}
                    onMoveCols={moveColsByKey}
                    onContextMenu={handleContextMenu}
                />
            ) : (
                <main className="placeholder">
                    <h1>CSV Editor</h1>
                    <p>
                        Create a new file with <strong>File ▸ New</strong> (⌘N) or open
                        an existing file with <strong>File ▸ Open…</strong> (⌘O).
                    </p>
                </main>
            )}
            <StatusBar
                file={file}
                rows={rows}
                selection={selection}
                dirty={dirty}
                supportedEncodings={supportedEncodings}
                onEncodingChange={handleEncodingChange}
                onHasHeaderToggle={handleHasHeaderToggle}
                onLineEndingChange={handleLineEndingChange}
            />
            {contextMenu && (
                <ContextMenu
                    items={contextMenu.items}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}

export default App;
