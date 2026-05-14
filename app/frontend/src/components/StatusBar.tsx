import type { main } from '../../wailsjs/go/models';
import type { SelectedCell } from './VirtualTable';

interface StatusBarProps {
    file: main.FileLoadResult | null;
    rows: string[][];
    selected: SelectedCell | null;
    dirty: boolean;
    supportedEncodings: string[];
    onEncodingChange: (encoding: string) => void;
    onHasHeaderToggle: (hasHeader: boolean) => void;
}

export function StatusBar({
    file,
    rows,
    selected,
    dirty,
    supportedEncodings,
    onEncodingChange,
    onHasHeaderToggle,
}: StatusBarProps) {
    return (
        <footer className="statusbar">
            <div className="statusbar-left">
                {file && selected ? (
                    <span>
                        R{selected.rowIndex + 1} · C{selected.columnIndex + 1}
                        {' · '}
                        {(rows[selected.rowIndex]?.[selected.columnIndex] ?? '').slice(0, 200) || '∅'}
                    </span>
                ) : (
                    <span className="statusbar-muted">
                        {file ? 'No cell selected' : 'No file open — use File ▸ Open…'}
                    </span>
                )}
            </div>
            <div className="statusbar-right">
                {file && (
                    <>
                        {dirty && (
                            <span className="statusbar-item statusbar-dirty" title="Unsaved changes">
                                ●
                            </span>
                        )}
                        <span className="statusbar-item statusbar-muted">
                            {file.delimiter === '\t' ? 'TSV' : 'CSV'} · {file.lineEnding} · {rows.length.toLocaleString()} rows
                        </span>
                        <button
                            className="statusbar-item statusbar-toggle"
                            title="Toggle whether the first row is a header"
                            onClick={() => onHasHeaderToggle(!file.hasHeader)}
                        >
                            Header: <strong>{file.hasHeader ? 'On' : 'Off'}</strong>
                        </button>
                        <label className="statusbar-item statusbar-select-wrap" title="Encoding">
                            <select
                                className="statusbar-select"
                                value={file.usedEncoding}
                                onChange={(e) => onEncodingChange(e.target.value)}
                            >
                                {supportedEncodings.map((enc) => (
                                    <option key={enc} value={enc}>
                                        {enc}
                                        {enc === file.detectedEncoding ? ' (detected)' : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </>
                )}
            </div>
        </footer>
    );
}
