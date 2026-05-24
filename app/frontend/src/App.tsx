import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import './App.css';
import { CellEditDialog } from './components/CellEditDialog';
import { StatusBar } from './components/StatusBar';
import {
    VirtualTable,
    type ContextMenuTarget,
    type EditingCell,
} from './components/VirtualTable';
import type { CommitDirection } from './components/CellEditor';
import { ContextMenu, type MenuItem } from './components/ContextMenu';
import { FindBar } from './components/FindBar';
import {
    findMatches,
    replaceAllEdits,
    replaceOneEdit,
    type FindOptions,
    type Match,
} from './find';
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
import type { SortKey } from './sort';
import { inferColumnTypes } from './coltype';
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

    const [columnWidths, setColumnWidths] = useState<Map<number, number>>(
        () => new Map(),
    );

    // Find / replace state.
    const [findOpen, setFindOpen] = useState(false);
    const [replaceMode, setReplaceMode] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [replaceValue, setReplaceValue] = useState('');
    const [findOptions, setFindOptions] = useState<FindOptions>({
        caseSensitive: false,
        regex: false,
        wholeCell: false,
    });
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

    const { file, rows } = state;
    const dirty = isDirty(state);

    const maxColumns = useMemo(() => {
        let m = file?.hasHeader && file.header ? file.header.length : 0;
        for (const row of rows) if (row.length > m) m = row.length;
        return Math.max(m, file?.maxColumns ?? 0);
    }, [file?.hasHeader, file?.header, file?.maxColumns, rows]);

    const numericColumns = useMemo(
        () => inferColumnTypes(rows, maxColumns),
        [rows, maxColumns],
    );

    const matches: Match[] = useMemo(() => {
        if (!findOpen || !findQuery) return [];
        return findMatches(findQuery, findOptions, rows);
    }, [findOpen, findQuery, findOptions, rows]);

    // Clamp currentMatchIndex when matches shrink (e.g., after a replace
    // or an edit removed matches). Does NOT move the selection.
    useEffect(() => {
        if (matches.length === 0) {
            if (currentMatchIndex !== 0) setCurrentMatchIndex(0);
            return;
        }
        if (currentMatchIndex >= matches.length) {
            setCurrentMatchIndex(matches.length - 1);
        }
    }, [matches, currentMatchIndex]);

    // Reset the active match and jump to it only when the user changes the
    // query / options / opens the bar — explicitly NOT when rows change
    // mid-edit (that would keep yanking the selection back).
    useEffect(() => {
        if (!findOpen) return;
        setCurrentMatchIndex(0);
        if (matches.length > 0) {
            const m = matches[0];
            setSelection({
                anchor: { rowIndex: m.rowIndex, columnIndex: m.columnIndex },
                focus: { rowIndex: m.rowIndex, columnIndex: m.columnIndex },
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [findOpen, findQuery, findOptions]);

    useEffect(() => {
        SupportedReadEncodings().then(setSupportedEncodings).catch(() => {});
    }, []);

    useEffect(() => {
        const offLoaded = EventsOn('file:loaded', (payload: main.FileLoadResult) => {
            dispatch({ type: 'LOAD', payload });
            setSelection(null);
            setEditing(null);
            setError(null);
            setColumnWidths(new Map());
        });
        const offError = EventsOn('file:error', (message: string) => {
            setError(message);
        });
        return () => {
            offLoaded();
            offError();
        };
    }, []);

    // Open a file by absolute path. Triggered by drag-and-drop and the
    // File ▸ Open Recent submenu.
    const openPath = useCallback(
        async (path: string) => {
            if (!path) return;
            if (dirty) {
                try {
                    const ok = await ConfirmDialog(
                        'Discard changes?',
                        `You have unsaved changes. Open ${path.split(/[\\/]/).pop()} anyway?`,
                    );
                    if (!ok) return;
                } catch (e) {
                    setError(String(e));
                    return;
                }
            }
            try {
                const result = await LoadFile(path, '', '', true);
                dispatch({ type: 'LOAD', payload: result });
                setSelection(null);
                setEditing(null);
                setError(null);
                setColumnWidths(new Map());
            } catch (e) {
                setError(String(e));
            }
        },
        [dirty],
    );

    useEffect(() => {
        const off = EventsOn('file:open-path', (path: string) => openPath(path));
        return () => off();
    }, [openPath]);

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
            setColumnWidths(new Map());
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

    // --- Find / Replace ---

    const handleFindNext = useCallback(() => {
        if (matches.length === 0) return;
        const next = (currentMatchIndex + 1) % matches.length;
        setCurrentMatchIndex(next);
        const m = matches[next];
        setSelection({
            anchor: { rowIndex: m.rowIndex, columnIndex: m.columnIndex },
            focus: { rowIndex: m.rowIndex, columnIndex: m.columnIndex },
        });
    }, [matches, currentMatchIndex]);

    const handleFindPrev = useCallback(() => {
        if (matches.length === 0) return;
        const prev = (currentMatchIndex - 1 + matches.length) % matches.length;
        setCurrentMatchIndex(prev);
        const m = matches[prev];
        setSelection({
            anchor: { rowIndex: m.rowIndex, columnIndex: m.columnIndex },
            focus: { rowIndex: m.rowIndex, columnIndex: m.columnIndex },
        });
    }, [matches, currentMatchIndex]);

    const handleFindOpen = useCallback((withReplace: boolean) => {
        setFindOpen(true);
        if (withReplace) setReplaceMode(true);
    }, []);

    const handleFindClose = useCallback(() => {
        setFindOpen(false);
        setReplaceMode(false);
    }, []);

    const handleReplaceOne = useCallback(() => {
        if (!findOpen || matches.length === 0) return;
        const match = matches[Math.min(currentMatchIndex, matches.length - 1)];
        if (!match) return;
        const edit = replaceOneEdit(match, replaceValue, findOptions, rows, findQuery);
        if (edit) {
            dispatch({ type: 'APPLY_EDITS', edits: [edit] });
        }
        // After the edit, matches will be recomputed; index handling kicks in.
    }, [findOpen, matches, currentMatchIndex, replaceValue, findOptions, rows, findQuery]);

    const handleReplaceAll = useCallback(() => {
        if (!findOpen || matches.length === 0) return;
        const edits = replaceAllEdits(findQuery, replaceValue, findOptions, rows);
        if (edits.length > 0) {
            dispatch({ type: 'APPLY_EDITS', edits });
        }
    }, [findOpen, matches.length, findQuery, replaceValue, findOptions, rows]);

    // When find bar is open, keep focus in the find input across edits.
    // Cell editing transitions focus to the CellEditor input; after commit
    // we want to return to the find bar (not the underlying table) so the
    // user can keep searching.
    useEffect(() => {
        if (!findOpen || editing !== null) return;
        const active = document.activeElement;
        // Don't steal focus if the user explicitly moved to another control.
        if (
            active instanceof HTMLInputElement &&
            active.classList.contains('findbar-input')
        ) {
            return;
        }
        if (active instanceof HTMLSelectElement) return;
        const input = document.querySelector<HTMLInputElement>('.findbar-input');
        input?.focus();
    }, [editing, findOpen]);

    // Global Cmd+F / Cmd+H / Cmd+G / F3 shortcuts. These need to fire even
    // when focus is on the find input or status bar select.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const cmdOrCtrl = e.metaKey || e.ctrlKey;
            if (cmdOrCtrl && e.key.toLowerCase() === 'f' && !e.shiftKey) {
                e.preventDefault();
                handleFindOpen(false);
                return;
            }
            if (cmdOrCtrl && e.key.toLowerCase() === 'h') {
                e.preventDefault();
                handleFindOpen(true);
                return;
            }
            if (cmdOrCtrl && e.key.toLowerCase() === 'g') {
                e.preventDefault();
                if (e.shiftKey) handleFindPrev();
                else handleFindNext();
                return;
            }
            if (e.key === 'F3') {
                e.preventDefault();
                if (e.shiftKey) handleFindPrev();
                else handleFindNext();
                return;
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [handleFindOpen, handleFindNext, handleFindPrev]);

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

    const handleResizeColumn = useCallback((columnIndex: number, width: number) => {
        setColumnWidths((prev) => {
            const next = new Map(prev);
            next.set(columnIndex, width);
            return next;
        });
    }, []);

    const handleAutoFitColumn = useCallback(
        (columnIndex: number) => {
            // Measure with a real off-screen <span> so all the font-related
            // CSS (font-variant-numeric: tabular-nums, etc.) is applied as the
            // browser actually renders cells. Canvas measureText was unreliable
            // here because the CSS font shorthand it expects can't represent
            // every value getComputedStyle returns.
            const sample = document.querySelector<HTMLDivElement>(
                '.vt-cell:not(.vt-cell-head):not(.vt-cell-rownum)',
            );
            const headerSample = document.querySelector<HTMLDivElement>(
                '.vt-cell-head',
            );
            if (!sample) return;

            const span = document.createElement('span');
            span.style.position = 'absolute';
            span.style.visibility = 'hidden';
            span.style.whiteSpace = 'pre';
            span.style.pointerEvents = 'none';
            span.style.left = '-99999px';
            span.style.top = '0';
            document.body.appendChild(span);

            const applyFont = (el: Element) => {
                const cs = window.getComputedStyle(el);
                span.style.fontFamily = cs.fontFamily;
                span.style.fontSize = cs.fontSize;
                span.style.fontWeight = cs.fontWeight;
                span.style.fontStyle = cs.fontStyle;
                span.style.fontVariantNumeric = cs.fontVariantNumeric;
                span.style.letterSpacing = cs.letterSpacing;
            };

            const PAD = 16; // 0.5rem padding × 2
            const BUFFER = 8; // breathing room so text doesn't get ellipsis-cut

            let maxWidth = 0;
            if (file?.hasHeader && file.header?.[columnIndex] && headerSample) {
                applyFont(headerSample);
                span.textContent = file.header[columnIndex];
                maxWidth = span.offsetWidth;
            }

            applyFont(sample);
            // Sample to keep this responsive on huge tables (~100k+ rows).
            const stride = rows.length > 20000 ? Math.ceil(rows.length / 20000) : 1;
            for (let r = 0; r < rows.length; r += stride) {
                const cell = rows[r]?.[columnIndex];
                if (!cell) continue;
                span.textContent = cell;
                const w = span.offsetWidth;
                if (w > maxWidth) maxWidth = w;
            }

            span.remove();
            const width = Math.max(60, Math.min(800, Math.ceil(maxWidth) + PAD + BUFFER));
            handleResizeColumn(columnIndex, width);
        },
        [file?.hasHeader, file?.header, rows, handleResizeColumn],
    );

    const sortByColumns = useCallback(
        (columnIndexes: number[], direction: 'asc' | 'desc') => {
            if (columnIndexes.length === 0) return;
            const keys: SortKey[] = columnIndexes.map((columnIndex) => ({
                columnIndex,
                direction,
                mode: 'auto',
            }));
            dispatch({ type: 'SORT_ROWS', keys });
        },
        [],
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
                    const sortCols = Array.from(
                        { length: range.count },
                        (_, i) => range.start + i,
                    );
                    const sortLabel =
                        range.count === 1 ? 'this column' : `these ${range.count} columns`;
                    items = [
                        {
                            label: `Sort ascending by ${sortLabel}`,
                            onClick: () => sortByColumns(sortCols, 'asc'),
                        },
                        {
                            label: `Sort descending by ${sortLabel}`,
                            onClick: () => sortByColumns(sortCols, 'desc'),
                        },
                        {
                            label: `Auto-fit ${label} width`,
                            onClick: () => {
                                for (let i = 0; i < range.count; i++) {
                                    handleAutoFitColumn(range.start + i);
                                }
                            },
                            separatorBefore: true,
                        },
                        {
                            label: `Insert ${label} left`,
                            onClick: () => insertColsLeft(range.start, range.count),
                            separatorBefore: true,
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
            sortByColumns,
            handleAutoFitColumn,
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
            {file && findOpen && (
                <FindBar
                    query={findQuery}
                    onQueryChange={setFindQuery}
                    options={findOptions}
                    onOptionsChange={setFindOptions}
                    matchCount={matches.length}
                    currentIndex={Math.min(currentMatchIndex, Math.max(0, matches.length - 1))}
                    onNext={handleFindNext}
                    onPrev={handleFindPrev}
                    onClose={handleFindClose}
                    replaceMode={replaceMode}
                    onToggleReplaceMode={() => setReplaceMode((m) => !m)}
                    replaceValue={replaceValue}
                    onReplaceValueChange={setReplaceValue}
                    onReplaceOne={handleReplaceOne}
                    onReplaceAll={handleReplaceAll}
                />
            )}
            {file ? (
                <VirtualTable
                    header={file.hasHeader ? file.header : null}
                    rows={rows}
                    maxColumns={maxColumns}
                    columnWidths={columnWidths}
                    onResizeColumn={handleResizeColumn}
                    onAutoFitColumn={handleAutoFitColumn}
                    numericColumns={numericColumns}
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
                    matches={matches}
                    currentMatchIndex={Math.min(
                        currentMatchIndex,
                        Math.max(0, matches.length - 1),
                    )}
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
            {editing && (
                <CellEditDialog
                    initialValue={rows[editing.rowIndex]?.[editing.columnIndex] ?? ''}
                    rowIndex={editing.rowIndex}
                    columnIndex={editing.columnIndex}
                    onSave={(value) => {
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
                    }}
                    onCancel={() => setEditing(null)}
                />
            )}
        </div>
    );
}

export default App;
