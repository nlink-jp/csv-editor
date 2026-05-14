import type { main } from '../wailsjs/go/models';

// PendingEdit is what callers supply to APPLY_EDITS. The reducer reads
// the current value to record it as the "before" half of the snapshot.
export interface PendingEdit {
    rowIndex: number;
    columnIndex: number;
    value: string;
}

// HistoryEntry stores a complete before/after pair for both rows and the
// header (if present). This makes undo/redo trivial — assign the snapshot
// back — and correctly handles structural changes (insert/delete row/col)
// alongside cell edits. The rows arrays share references for unchanged rows
// so the memory cost is just the modified rows.
export interface HistoryEntry {
    rowsBefore: string[][];
    rowsAfter: string[][];
    headerBefore: string[] | null;
    headerAfter: string[] | null;
    // Set only when the action toggled hasHeader (SET_HAS_HEADER); used by
    // UNDO/REDO to restore the flag along with the data.
    hasHeaderBefore?: boolean;
    hasHeaderAfter?: boolean;
}

export interface EditableState {
    file: main.FileLoadResult | null;
    rows: string[][];
    history: HistoryEntry[];
    future: HistoryEntry[];
    savedHistoryLength: number;
}

export const initialState: EditableState = {
    file: null,
    rows: [],
    history: [],
    future: [],
    savedHistoryLength: 0,
};

export function isDirty(state: EditableState): boolean {
    return state.history.length !== state.savedHistoryLength;
}

export interface Rect {
    r0: number;
    c0: number;
    r1: number;
    c1: number;
}

export type Action =
    | { type: 'LOAD'; payload: main.FileLoadResult }
    | { type: 'APPLY_EDITS'; edits: PendingEdit[] }
    | { type: 'RENAME_COLUMN'; columnIndex: number; value: string }
    | { type: 'CLEAR_CELLS'; rect: Rect }
    | { type: 'INSERT_ROWS'; atIndex: number; count: number }
    | { type: 'DELETE_ROWS'; startIndex: number; count: number }
    | { type: 'DUPLICATE_ROWS'; startIndex: number; count: number }
    | { type: 'MOVE_ROWS'; startIndex: number; count: number; direction: 'up' | 'down' }
    | { type: 'INSERT_COLS'; atIndex: number; count: number }
    | { type: 'DELETE_COLS'; startIndex: number; count: number }
    | { type: 'DUPLICATE_COLS'; startIndex: number; count: number }
    | { type: 'MOVE_COLS'; startIndex: number; count: number; direction: 'left' | 'right' }
    | { type: 'SET_HAS_HEADER'; value: boolean }
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'SAVED' }
    | { type: 'UPDATE_FILE'; patch: Partial<main.FileLoadResult> }
    | { type: 'CLEAR' };

function setCell(rows: string[][], r: number, c: number, value: string): string[][] {
    let next: string[][];
    if (r >= rows.length) {
        next = rows.slice();
        while (next.length <= r) next.push([]);
    } else {
        next = rows.map((row, i) => (i === r ? row.slice() : row));
    }
    const targetRow = next[r].slice();
    while (targetRow.length <= c) targetRow.push('');
    targetRow[c] = value;
    next[r] = targetRow;
    return next;
}

function maxColumnsOf(rows: string[][], header: string[] | null | undefined): number {
    let max = header?.length ?? 0;
    for (const row of rows) if (row.length > max) max = row.length;
    return max;
}

function pushHistory(
    state: EditableState,
    rowsAfter: string[][],
    headerAfter: string[] | null,
): EditableState {
    return {
        ...state,
        rows: rowsAfter,
        file: state.file ? { ...state.file, header: headerAfter ?? [] } : state.file,
        history: [
            ...state.history,
            {
                rowsBefore: state.rows,
                rowsAfter,
                headerBefore: state.file?.header ?? null,
                headerAfter,
            },
        ],
        future: [],
    };
}

export function reducer(state: EditableState, action: Action): EditableState {
    switch (action.type) {
        case 'LOAD':
            return {
                file: action.payload,
                rows: action.payload.rows.map((r) => r.slice()),
                history: [],
                future: [],
                savedHistoryLength: 0,
            };

        case 'APPLY_EDITS': {
            if (!state.file) return state;
            let rows = state.rows;
            let touched = false;
            for (const e of action.edits) {
                const before = rows[e.rowIndex]?.[e.columnIndex] ?? '';
                if (before === e.value) continue;
                rows = setCell(rows, e.rowIndex, e.columnIndex, e.value);
                touched = true;
            }
            if (!touched) return state;
            return pushHistory(state, rows, state.file.header);
        }

        case 'CLEAR_CELLS': {
            if (!state.file) return state;
            const { r0, c0, r1, c1 } = action.rect;
            let rows = state.rows;
            let touched = false;
            for (let r = r0; r <= r1 && r < rows.length; r++) {
                const rowLen = rows[r]?.length ?? 0;
                for (let c = c0; c <= c1 && c < rowLen; c++) {
                    if (rows[r][c] !== '') {
                        rows = setCell(rows, r, c, '');
                        touched = true;
                    }
                }
            }
            if (!touched) return state;
            return pushHistory(state, rows, state.file.header);
        }

        case 'INSERT_ROWS': {
            if (!state.file) return state;
            const { atIndex, count } = action;
            if (count <= 0) return state;
            const cols = maxColumnsOf(state.rows, state.file.header);
            const insertions: string[][] = Array.from({ length: count }, () =>
                Array(cols).fill(''),
            );
            const clamped = Math.max(0, Math.min(state.rows.length, atIndex));
            const rowsAfter = [
                ...state.rows.slice(0, clamped),
                ...insertions,
                ...state.rows.slice(clamped),
            ];
            return pushHistory(state, rowsAfter, state.file.header);
        }

        case 'DELETE_ROWS': {
            if (!state.file) return state;
            const { startIndex, count } = action;
            if (count <= 0 || startIndex >= state.rows.length) return state;
            const rowsAfter = [
                ...state.rows.slice(0, startIndex),
                ...state.rows.slice(startIndex + count),
            ];
            if (rowsAfter.length === state.rows.length) return state;
            return pushHistory(state, rowsAfter, state.file.header);
        }

        case 'DUPLICATE_ROWS': {
            if (!state.file) return state;
            const { startIndex, count } = action;
            if (count <= 0 || startIndex >= state.rows.length) return state;
            const end = Math.min(startIndex + count, state.rows.length);
            const duplicates = state.rows.slice(startIndex, end).map((r) => r.slice());
            const rowsAfter = [
                ...state.rows.slice(0, end),
                ...duplicates,
                ...state.rows.slice(end),
            ];
            return pushHistory(state, rowsAfter, state.file.header);
        }

        case 'MOVE_ROWS': {
            if (!state.file) return state;
            const { startIndex, count, direction } = action;
            if (count <= 0) return state;
            const end = startIndex + count;
            if (startIndex < 0 || end > state.rows.length) return state;
            if (direction === 'up' && startIndex === 0) return state;
            if (direction === 'down' && end === state.rows.length) return state;
            const moving = state.rows.slice(startIndex, end);
            let rowsAfter: string[][];
            if (direction === 'up') {
                rowsAfter = [
                    ...state.rows.slice(0, startIndex - 1),
                    ...moving,
                    state.rows[startIndex - 1],
                    ...state.rows.slice(end),
                ];
            } else {
                rowsAfter = [
                    ...state.rows.slice(0, startIndex),
                    state.rows[end],
                    ...moving,
                    ...state.rows.slice(end + 1),
                ];
            }
            return pushHistory(state, rowsAfter, state.file.header);
        }

        case 'INSERT_COLS': {
            if (!state.file) return state;
            const { atIndex, count } = action;
            if (count <= 0) return state;
            const fillers = Array(count).fill('');
            const rowsAfter = state.rows.map((row) => {
                const newRow = row.slice();
                while (newRow.length < atIndex) newRow.push('');
                newRow.splice(atIndex, 0, ...fillers);
                return newRow;
            });
            let headerAfter = state.file.header;
            if (state.file.hasHeader && state.file.header) {
                const newHeader = state.file.header.slice();
                while (newHeader.length < atIndex) newHeader.push('');
                newHeader.splice(atIndex, 0, ...Array(count).fill(''));
                headerAfter = newHeader;
            }
            return pushHistory(state, rowsAfter, headerAfter);
        }

        case 'DELETE_COLS': {
            if (!state.file) return state;
            const { startIndex, count } = action;
            if (count <= 0) return state;
            const rowsAfter = state.rows.map((row) => {
                if (row.length <= startIndex) return row;
                const newRow = row.slice();
                newRow.splice(startIndex, count);
                return newRow;
            });
            let headerAfter = state.file.header;
            if (
                state.file.hasHeader &&
                state.file.header &&
                state.file.header.length > startIndex
            ) {
                const newHeader = state.file.header.slice();
                newHeader.splice(startIndex, count);
                headerAfter = newHeader;
            }
            return pushHistory(state, rowsAfter, headerAfter);
        }

        case 'DUPLICATE_COLS': {
            if (!state.file) return state;
            const { startIndex, count } = action;
            if (count <= 0) return state;
            const insertAt = startIndex + count;
            const rowsAfter = state.rows.map((row) => {
                if (row.length <= startIndex) return row;
                const newRow = row.slice();
                const slice = newRow.slice(startIndex, startIndex + count);
                while (slice.length < count) slice.push('');
                newRow.splice(insertAt, 0, ...slice);
                return newRow;
            });
            let headerAfter = state.file.header;
            if (state.file.hasHeader && state.file.header) {
                const newHeader = state.file.header.slice();
                if (newHeader.length > startIndex) {
                    const slice = newHeader.slice(startIndex, startIndex + count);
                    while (slice.length < count) slice.push('');
                    newHeader.splice(insertAt, 0, ...slice);
                }
                headerAfter = newHeader;
            }
            return pushHistory(state, rowsAfter, headerAfter);
        }

        case 'MOVE_COLS': {
            if (!state.file) return state;
            const { startIndex, count, direction } = action;
            if (count <= 0) return state;
            const end = startIndex + count;
            if (direction === 'left' && startIndex === 0) return state;
            const headerLen = state.file.header?.length ?? 0;
            let maxCols = headerLen;
            for (const r of state.rows) if (r.length > maxCols) maxCols = r.length;
            if (direction === 'right' && end >= maxCols) return state;

            const order: number[] = [];
            if (direction === 'left') {
                for (let i = 0; i < startIndex - 1; i++) order.push(i);
                for (let i = startIndex; i < end; i++) order.push(i);
                order.push(startIndex - 1);
                for (let i = end; i < maxCols; i++) order.push(i);
            } else {
                for (let i = 0; i < startIndex; i++) order.push(i);
                order.push(end);
                for (let i = startIndex; i < end; i++) order.push(i);
                for (let i = end + 1; i < maxCols; i++) order.push(i);
            }
            const reorder = (row: string[]) => order.map((i) => row[i] ?? '');
            const rowsAfter = state.rows.map(reorder);
            let headerAfter = state.file.header;
            if (state.file.hasHeader && state.file.header) {
                headerAfter = reorder(state.file.header);
            }
            return pushHistory(state, rowsAfter, headerAfter);
        }

        case 'RENAME_COLUMN': {
            if (!state.file || !state.file.hasHeader) return state;
            const { columnIndex, value } = action;
            const current = state.file.header ?? [];
            const before = current[columnIndex] ?? '';
            if (before === value && columnIndex < current.length) return state;
            const newHeader = current.slice();
            while (newHeader.length <= columnIndex) newHeader.push('');
            newHeader[columnIndex] = value;
            return pushHistory(state, state.rows, newHeader);
        }

        case 'SET_HAS_HEADER': {
            if (!state.file) return state;
            const newValue = action.value;
            if (newValue === state.file.hasHeader) return state;

            let newRows = state.rows;
            let newHeader: string[] = state.file.header ?? [];

            if (newValue && !state.file.hasHeader) {
                // Off → On: promote the first data row to be the header.
                if (state.rows.length > 0) {
                    newHeader = state.rows[0].slice();
                    newRows = state.rows.slice(1);
                } else {
                    newHeader = [];
                }
            } else if (!newValue && state.file.hasHeader) {
                // On → Off: demote the header back into the data rows.
                if (state.file.header && state.file.header.length > 0) {
                    newRows = [state.file.header.slice(), ...state.rows];
                }
                newHeader = [];
            }

            return {
                ...state,
                rows: newRows,
                file: {
                    ...state.file,
                    hasHeader: newValue,
                    header: newHeader,
                },
                history: [
                    ...state.history,
                    {
                        rowsBefore: state.rows,
                        rowsAfter: newRows,
                        headerBefore: state.file.header,
                        headerAfter: newHeader,
                        hasHeaderBefore: state.file.hasHeader,
                        hasHeaderAfter: newValue,
                    },
                ],
                future: [],
            };
        }

        case 'UNDO': {
            if (state.history.length === 0) return state;
            const entry = state.history[state.history.length - 1];
            const headerChanged = entry.headerBefore !== entry.headerAfter;
            const hasHeaderChanged =
                entry.hasHeaderBefore !== undefined &&
                entry.hasHeaderAfter !== undefined &&
                entry.hasHeaderBefore !== entry.hasHeaderAfter;
            let newFile = state.file;
            if (state.file && (headerChanged || hasHeaderChanged)) {
                newFile = { ...state.file };
                if (headerChanged) newFile.header = entry.headerBefore ?? [];
                if (hasHeaderChanged) newFile.hasHeader = entry.hasHeaderBefore!;
            }
            return {
                ...state,
                rows: entry.rowsBefore,
                file: newFile,
                history: state.history.slice(0, -1),
                future: [...state.future, entry],
            };
        }

        case 'REDO': {
            if (state.future.length === 0) return state;
            const entry = state.future[state.future.length - 1];
            const headerChanged = entry.headerBefore !== entry.headerAfter;
            const hasHeaderChanged =
                entry.hasHeaderBefore !== undefined &&
                entry.hasHeaderAfter !== undefined &&
                entry.hasHeaderBefore !== entry.hasHeaderAfter;
            let newFile = state.file;
            if (state.file && (headerChanged || hasHeaderChanged)) {
                newFile = { ...state.file };
                if (headerChanged) newFile.header = entry.headerAfter ?? [];
                if (hasHeaderChanged) newFile.hasHeader = entry.hasHeaderAfter!;
            }
            return {
                ...state,
                rows: entry.rowsAfter,
                file: newFile,
                history: [...state.history, entry],
                future: state.future.slice(0, -1),
            };
        }

        case 'SAVED':
            return { ...state, savedHistoryLength: state.history.length };

        case 'UPDATE_FILE': {
            if (!state.file) return state;
            return { ...state, file: { ...state.file, ...action.patch } };
        }

        case 'CLEAR':
            return initialState;
    }
}
