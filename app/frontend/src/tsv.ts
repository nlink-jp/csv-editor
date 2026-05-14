// TSV serialization for clipboard interop. Excel and most spreadsheet apps
// expect tab-separated values with RFC-4180-style quoting: fields containing
// tab, newline, or double-quote are wrapped in double quotes; double quotes
// inside are escaped by doubling.

const QUOTE_NEEDED = /[\t\n\r"]/;

export function encodeTSV(rows: string[][]): string {
    if (rows.length === 0) return '';
    // Each row is terminated (not separated) by '\n', matching the
    // RFC 4180 / Go encoding/csv convention. This preserves trailing empty
    // rows on round-trip (Array.join would drop them by emitting only
    // N-1 separators for N elements).
    return (
        rows
            .map((row) =>
                row
                    .map((cell) =>
                        QUOTE_NEEDED.test(cell)
                            ? '"' + cell.replace(/"/g, '""') + '"'
                            : cell,
                    )
                    .join('\t'),
            )
            .join('\n') + '\n'
    );
}

// decodeTSV parses TSV text into a 2-D array. Honors quoted fields with
// embedded tabs, newlines (\n / \r\n), and "" escapes. A trailing line
// break does not produce an extra empty row.
export function decodeTSV(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    const pushField = () => {
        row.push(field);
        field = '';
    };
    const pushRow = () => {
        rows.push(row);
        row = [];
    };

    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }
        if (ch === '"' && field === '') {
            inQuotes = true;
            i++;
            continue;
        }
        if (ch === '\t') {
            pushField();
            i++;
            continue;
        }
        if (ch === '\r') {
            pushField();
            pushRow();
            // Eat \r\n as one line ending.
            if (text[i + 1] === '\n') i += 2;
            else i++;
            continue;
        }
        if (ch === '\n') {
            pushField();
            pushRow();
            i++;
            continue;
        }
        field += ch;
        i++;
    }

    // Flush any trailing partial row. A trailing line break leaves field=''
    // and an empty row in progress — skip that case.
    if (field !== '' || row.length > 0) {
        pushField();
        pushRow();
    }
    return rows;
}
