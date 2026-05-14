import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { Toolbar } from './components/Toolbar';
import { VirtualTable, type SelectedCell } from './components/VirtualTable';
import {
    LoadFile,
    OpenFileDialog,
    SupportedReadEncodings,
} from '../wailsjs/go/main/Bindings';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { main } from '../wailsjs/go/models';

function App() {
    const [file, setFile] = useState<main.FileLoadResult | null>(null);
    const [supportedEncodings, setSupportedEncodings] = useState<string[]>([]);
    const [selected, setSelected] = useState<SelectedCell | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        SupportedReadEncodings().then(setSupportedEncodings).catch(() => {});
    }, []);

    useEffect(() => {
        const offLoaded = EventsOn('file:loaded', (payload: main.FileLoadResult) => {
            setFile(payload);
            setSelected(null);
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

    const handleOpen = useCallback(async () => {
        try {
            const path = await OpenFileDialog();
            if (!path) return;
            const result = await LoadFile(path, '', '', true);
            setFile(result);
            setSelected(null);
            setError(null);
        } catch (e) {
            setError(String(e));
        }
    }, []);

    const handleEncodingChange = useCallback(
        async (encoding: string) => {
            if (!file) return;
            try {
                const result = await LoadFile(file.path, encoding, file.delimiter, file.hasHeader);
                setFile(result);
                setSelected(null);
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
                setFile(result);
                setSelected(null);
                setError(null);
            } catch (e) {
                setError(String(e));
            }
        },
        [file],
    );

    return (
        <div id="App">
            <Toolbar
                file={file}
                supportedEncodings={supportedEncodings}
                onOpen={handleOpen}
                onEncodingChange={handleEncodingChange}
                onHasHeaderToggle={handleHasHeaderToggle}
            />
            {error && (
                <div className="error-bar" onClick={() => setError(null)}>
                    {error}
                </div>
            )}
            {file ? (
                <VirtualTable
                    header={file.hasHeader ? file.header : null}
                    rows={file.rows}
                    maxColumns={file.maxColumns}
                    selected={selected}
                    onSelect={setSelected}
                />
            ) : (
                <main className="placeholder">
                    <h1>CSV Editor</h1>
                    <p>Open a CSV or TSV file from the File menu, or use the Open button.</p>
                </main>
            )}
            <footer className="statusbar">
                {selected && file ? (
                    <span>
                        R{selected.rowIndex + 1} · C{selected.columnIndex + 1}
                        {' · '}
                        {(file.rows[selected.rowIndex]?.[selected.columnIndex] ?? '').slice(0, 200) || '∅'}
                    </span>
                ) : (
                    <span className="statusbar-muted">No cell selected</span>
                )}
            </footer>
        </div>
    );
}

export default App;
