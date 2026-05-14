import type { main } from '../../wailsjs/go/models';

interface ToolbarProps {
    file: main.FileLoadResult | null;
    supportedEncodings: string[];
    onOpen: () => void;
    onEncodingChange: (encoding: string) => void;
    onHasHeaderToggle: (hasHeader: boolean) => void;
}

export function Toolbar({
    file,
    supportedEncodings,
    onOpen,
    onEncodingChange,
    onHasHeaderToggle,
}: ToolbarProps) {
    return (
        <div className="toolbar">
            <button className="toolbar-button" onClick={onOpen}>
                Open…
            </button>
            <div className="toolbar-divider" />
            <label className="toolbar-field">
                <span className="toolbar-label">Encoding</span>
                <select
                    value={file?.usedEncoding ?? ''}
                    disabled={!file}
                    onChange={(e) => onEncodingChange(e.target.value)}
                >
                    {!file && <option value="">—</option>}
                    {supportedEncodings.map((enc) => (
                        <option key={enc} value={enc}>
                            {enc}
                            {file && enc === file.detectedEncoding ? ' (detected)' : ''}
                        </option>
                    ))}
                </select>
            </label>
            <label className="toolbar-field">
                <input
                    type="checkbox"
                    disabled={!file}
                    checked={file?.hasHeader ?? false}
                    onChange={(e) => onHasHeaderToggle(e.target.checked)}
                />
                <span className="toolbar-label">Has header</span>
            </label>
            <div className="toolbar-spacer" />
            {file && (
                <span className="toolbar-meta">
                    {file.filename} · {file.delimiter === '\t' ? 'TSV' : 'CSV'} ·{' '}
                    {file.rows.length.toLocaleString()} rows
                </span>
            )}
        </div>
    );
}
