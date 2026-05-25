# csv-editor

A CSV/TSV viewer & editor GUI for Windows and macOS.

Built with [Wails](https://wails.io) (Go + React/TypeScript). Designed to
replace [TableTool](https://github.com/jakob/TableTool) with a maintained,
ARM64-native alternative that handles Japanese encodings (UTF-8 / Shift_JIS /
CP932), row/column copy operations, and TSV clipboard expansion correctly.

## Features

### File handling
- **Auto-detected encoding** on read. Supports **UTF-8** (BOM optional),
  **Shift_JIS**, **CP932** (Japanese Windows default).
- **CSV and TSV** parsed natively with RFC 4180 quoting.
- **New / Open / Save / Save As** with explicit encoding and line-ending
  (LF / CRLF) selection.
- **Drag & drop** any CSV/TSV file onto the window to open it.
- **Open Recent** submenu (last 10 files, persisted to your OS config dir).
- **New Window** (Cmd+Shift+N) opens an additional csv-editor instance so
  multiple files can be edited side by side.

### Editing
- **Cell editing** with **IME-safe Enter** — Japanese input no longer
  commits cells by mistake on the confirmation key. **Alt+Enter** inserts
  a newline inside the cell (RFC 4180 quoted multi-line fields).
- **Range selection**: mouse drag, Shift+click, Shift+arrow, Shift+Cmd+arrow
  to extend to the edge, Cmd+A to select all.
- **TSV clipboard** that actually works:
  - Copy a range / row / column → tab-separated, Excel-paste compatible.
  - Paste TSV into a **single cell** → automatically expands across cells.
  - Paste with a **shape mismatch** or that would extend the table →
    confirmation dialog (no silent data damage).
- **Undo / Redo** (Cmd+Z / Cmd+Shift+Z / Cmd+Y) across cell edits,
  row/column inserts/deletes/moves, and pastes — every structural change
  collapses to one undo step.
- **Row and column operations** (right-click row number / column header):
  Insert above/below or left/right, Duplicate, Move up/down or left/right
  (Alt+arrow), Delete.
- **Header row** editing — double-click a column header to rename
  (when "Header: On" in the status bar).
- **Cut / Copy / Paste / Clear contents** from the cell context menu.

### Productivity
- **Virtual scrolling** for hundreds of thousands of rows.
- **Find & Replace** (Cmd+F / Cmd+H): incremental search, match-count,
  case-sensitive / whole-cell / regex options, prev/next, Replace one or all.
- **Sort** by column (right-click column header → Sort ascending / descending),
  multi-key when multiple columns are selected. Numeric vs string is auto.
- **Column width**: drag the header's right edge to resize, double-click or
  right-click → Auto-fit to measure all cells and snap to content.
- **Numeric columns** are right-aligned automatically (display only — values
  stay as strings).

### Look & feel
- **Native title bar** showing the open file name.
- **OS dark / light theme** auto-follows the system appearance.
- **OS-native menus and dialogs** (file picker, paste-confirm).
- **Window position and size** are remembered across sessions.

## Keyboard shortcuts

| Action | macOS | Windows |
|---|---|---|
| New / Open / Save / Save As | ⌘N / ⌘O / ⌘S / ⇧⌘S | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| New Window / Close Window | ⇧⌘N / ⌘W | Ctrl+Shift+N / Ctrl+W |
| Find / Find & Replace | ⌘F / ⌘H | Ctrl+F / Ctrl+H |
| Next / Prev match | ⌘G / ⇧⌘G | Ctrl+G / Ctrl+Shift+G (also F3 / Shift+F3) |
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) |
| Cut / Copy / Paste | ⌘X / ⌘C / ⌘V | Ctrl+X / Ctrl+C / Ctrl+V |
| Select all | ⌘A | Ctrl+A |
| Edit selected cell | Enter or F2 | Enter or F2 |
| Insert newline in edit | Alt+Enter | Alt+Enter |
| Move selection | ↑↓←→ / Home / End / PgUp / PgDn | same |
| Extend selection | Shift+arrow / Shift+Cmd+arrow | Shift+arrow / Shift+Ctrl+arrow |
| Move selected rows/columns | Alt+↑↓←→ | Alt+arrow |
| Tab between cells (after edit) | Tab / Shift+Tab | same |

## Not in scope

By design, csv-editor is **not** a spreadsheet — it does not, and will not,
implement:

- Formulas / functions
- Multiple sheets / workbooks
- Charts
- Native xlsx / ods read & write
- Macros / scripting
- Row filtering or frozen panes (see RFP Discussion Log §9 — search + sort
  cover the use cases we hit)
- Per-file column width persistence (in-session only)

If you need any of these, use Excel, Numbers, Google Sheets, or LibreOffice
Calc.

## Requirements

- **macOS 12+** (Apple Silicon recommended; Intel may work but is not
  prioritized — see [RFP](docs/en/csv-editor-rfp.md) §7)
- **Windows 11** (Edge WebView2 ships with the OS; Windows 10 not supported)
- **Building from source**: Go 1.23+, Node.js 20+, [Wails v2](https://wails.io)

**Linux is not supported.** Maintainers do not have a Linux environment to
verify GUI / IME / theme / file-dialog behavior, and the project has no plans
to ship Linux binaries or accept Linux-targeted PRs. If you need a CSV editor
on Linux, consider [LibreOffice Calc](https://www.libreoffice.org/) or
[Modern CSV](https://www.moderncsv.com/).

## Installation

Binaries are distributed via GitHub Releases.

- **macOS**: the `.app` is **Developer ID signed and Apple-notarized**
  (Hardened Runtime + stapled ticket). Unzip and move
  `csv-editor.app` anywhere — it launches without Gatekeeper prompts
  and works offline.
- **Windows**: the `.exe` is currently **unsigned**. SmartScreen shows
  "Windows protected your PC" on first run — click "More info" → "Run
  anyway". Authenticode signing for Windows is not yet in place.

## Building from source

```bash
cd app
make build     # production build → dist/csv-editor.app (macOS) or .exe (Windows)
make dev       # live-reload development
make test      # unit tests
```

## Documentation

- [Changelog](CHANGELOG.md)
- [RFP — full specification](docs/en/csv-editor-rfp.md) ([日本語](docs/ja/csv-editor-rfp.ja.md))

## License

[MIT](LICENSE) © 2026 nlink-jp
