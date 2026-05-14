import { useCallback, useEffect, useReducer, useState } from 'react';
import './App.css';
import { StatusBar } from './components/StatusBar';
import {
    VirtualTable,
    type EditingCell,
    type SelectedCell,
} from './components/VirtualTable';
import {
    LoadFile,
    SaveFile,
    SupportedReadEncodings,
} from '../wailsjs/go/main/Bindings';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { main } from '../wailsjs/go/models';
import { initialState, isDirty, reducer } from './state';

function App() {
    const [state, dispatch] = useReducer(reducer, initialState);
    const [supportedEncodings, setSupportedEncodings] = useState<string[]>([]);
    const [selected, setSelected] = useState<SelectedCell | null>(null);
    const [editing, setEditing] = useState<EditingCell | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { file, rows } = state;
    const dirty = isDirty(state);

    useEffect(() => {
        SupportedReadEncodings().then(setSupportedEncodings).catch(() => {});
    }, []);

    useEffect(() => {
        const offLoaded = EventsOn('file:loaded', (payload: main.FileLoadResult) => {
            dispatch({ type: 'LOAD', payload });
            setSelected(null);
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

    const handleSave = useCallback(async () => {
        if (!file) return;
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
    }, [file, rows]);

    useEffect(() => {
        const off = EventsOn('menu:save', () => {
            handleSave();
        });
        return () => off();
    }, [handleSave]);

    const handleEncodingChange = useCallback(
        async (encoding: string) => {
            if (!file) return;
            try {
                const result = await LoadFile(file.path, encoding, file.delimiter, file.hasHeader);
                dispatch({ type: 'LOAD', payload: result });
                setSelected(null);
                setEditing(null);
                setError(null);
            } catch (e) {
                setError(String(e));
            }
        },
        [file],
    );

    const handleHasHeaderToggle = useCallback(
        async (hasHeader: boolean) => {
            if (!file) return;
            try {
                const result = await LoadFile(file.path, file.usedEncoding, file.delimiter, hasHeader);
                dispatch({ type: 'LOAD', payload: result });
                setSelected(null);
                setEditing(null);
                setError(null);
            } catch (e) {
                setError(String(e));
            }
        },
        [file],
    );

    const handleStartEdit = useCallback((cell: EditingCell) => {
        setEditing(cell);
    }, []);

    const handleCommitEdit = useCallback(
        (value: string) => {
            if (editing) {
                dispatch({
                    type: 'EDIT_CELL',
                    rowIndex: editing.rowIndex,
                    columnIndex: editing.columnIndex,
                    value,
                });
            }
            setEditing(null);
        },
        [editing],
    );

    const handleCancelEdit = useCallback(() => {
        setEditing(null);
    }, []);

    const handleUndo = useCallback(() => dispatch({ type: 'UNDO' }), []);
    const handleRedo = useCallback(() => dispatch({ type: 'REDO' }), []);

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
                    maxColumns={file.maxColumns}
                    selected={selected}
                    onSelect={setSelected}
                    editing={editing}
                    onStartEdit={handleStartEdit}
                    onCommitEdit={handleCommitEdit}
                    onCancelEdit={handleCancelEdit}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                />
            ) : (
                <main className="placeholder">
                    <h1>CSV Editor</h1>
                    <p>
                        Open a CSV or TSV file from the <strong>File ▸ Open…</strong> menu
                        (⌘O).
                    </p>
                </main>
            )}
            <StatusBar
                file={file}
                rows={rows}
                selected={selected}
                dirty={dirty}
                supportedEncodings={supportedEncodings}
                onEncodingChange={handleEncodingChange}
                onHasHeaderToggle={handleHasHeaderToggle}
            />
        </div>
    );
}

export default App;
