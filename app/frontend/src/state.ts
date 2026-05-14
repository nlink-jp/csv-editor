import type { main } from '../wailsjs/go/models';

// CellEdit records a single-cell change for the undo/redo stack.
export interface CellEdit {
    rowIndex: number;
    columnIndex: number;
    before: string;
    after: string;
}

// EditableState wraps the immutable file metadata plus the mutable rows and
// the edit history. `header` lives alongside file but is currently not edited
// (header editing is deferred — see RFP Phase 2 notes).
export interface EditableState {
    file: main.FileLoadResult | null;
    rows: string[][];
    history: CellEdit[];
    future: CellEdit[];
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

export type Action =
    | { type: 'LOAD'; payload: main.FileLoadResult }
    | { type: 'EDIT_CELL'; rowIndex: number; columnIndex: number; value: string }
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'SAVED' }
    | { type: 'CLEAR' };

function setCell(rows: string[][], r: number, c: number, value: string): string[][] {
    return rows.map((row, i) => {
        if (i !== r) return row;
        const newRow = row.slice();
        while (newRow.length <= c) newRow.push('');
        newRow[c] = value;
        return newRow;
    });
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

        case 'EDIT_CELL': {
            if (!state.file) return state;
            const { rowIndex, columnIndex, value } = action;
            const before = state.rows[rowIndex]?.[columnIndex] ?? '';
            if (before === value) return state;
            const edit: CellEdit = { rowIndex, columnIndex, before, after: value };
            return {
                ...state,
                rows: setCell(state.rows, rowIndex, columnIndex, value),
                history: [...state.history, edit],
                future: [],
            };
        }

        case 'UNDO': {
            if (state.history.length === 0) return state;
            const edit = state.history[state.history.length - 1];
            return {
                ...state,
                rows: setCell(state.rows, edit.rowIndex, edit.columnIndex, edit.before),
                history: state.history.slice(0, -1),
                future: [...state.future, edit],
            };
        }

        case 'REDO': {
            if (state.future.length === 0) return state;
            const edit = state.future[state.future.length - 1];
            return {
                ...state,
                rows: setCell(state.rows, edit.rowIndex, edit.columnIndex, edit.after),
                history: [...state.history, edit],
                future: state.future.slice(0, -1),
            };
        }

        case 'SAVED':
            return { ...state, savedHistoryLength: state.history.length };

        case 'CLEAR':
            return initialState;
    }
}
