# Changelog

All notable changes to **csv-editor** are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Window position and size are now persisted to the config file
  (`window.x`, `window.y`, `window.width`, `window.height`) and restored
  on next launch. Saved via Wails' `OnBeforeClose` hook; size is applied
  from `config.json` at app startup, position is applied after the
  window exists. Sub-200px dimensions are rejected (fallback to default).

## [0.1.0] - 2026-05-14

Initial release — Phase 1 through Phase 3 of the RFP feature set, ready
for daily use as a CSV/TSV editor on macOS (Apple Silicon) and Windows 11.

### Added

#### File I/O
- Open files via dialog, drag & drop onto the window, or the **File ▸ Open
  Recent** submenu (last 10 files, persisted to the OS-standard app
  support directory).
- Auto-detect encoding on read: UTF-8 (BOM optional), Shift_JIS, CP932.
- Save / Save As with explicit encoding and line-ending (LF / CRLF)
  choice. Save As writes through the OS-native save dialog and updates
  the window title.
- New file: blank 5×3 scaffold with Untitled name; first save promotes
  through Save As.

#### Display
- Virtual scrolling renders only the visible window of the table; handles
  hundreds of thousands of rows without sluggishness.
- Native title bar reflects the current filename.
- OS dark/light theme is honored via `prefers-color-scheme` and CSS
  custom properties.
- Numeric columns are right-aligned automatically (display only; values
  remain stored as strings).
- Per-column manual width via drag of the header's right edge, plus
  auto-fit on double-click or via the column context menu.

#### Editing
- IME-safe cell editing — Enter that confirms a Japanese composition no
  longer commits the cell.
- Range selection via drag, Shift+click, Shift+arrow, Shift+Cmd+arrow,
  and Cmd+A.
- Cut / Copy / Paste / Clear contents from the keyboard or context menu.
- TSV clipboard interop: copy produces tab-separated text; paste into a
  single cell auto-expands across multiple cells; paste with a shape
  mismatch or that would extend the table prompts an OS-native
  confirmation dialog.
- Row operations: insert above/below, duplicate, move up/down (Alt+↑↓
  or right-click menu), delete.
- Column operations: insert left/right, duplicate, move left/right
  (Alt+←→ or right-click menu), delete.
- Rename column headers by double-clicking the header (with Header: On).
- Undo / Redo (⌘Z / ⇧⌘Z / ⌘Y) covers cell edits, structural row/column
  changes, pastes, and header renames — paste extension restores the
  pre-extended table shape correctly.

#### Productivity
- Find / Replace (⌘F / ⌘H) with case-sensitive, whole-cell, and regex
  toggles. Match-count display and ⌘G / F3 next/prev navigation. Replace
  one or all (Replace All is a single undo step).
- Column sort via right-click header → ascending / descending. Multi-key
  sort when multiple columns are selected; numeric vs locale-string
  comparison is auto-detected per column. Empty cells always sort to the
  end (Excel convention).
- Window-level Cmd+F / Cmd+H / Cmd+G shortcuts work regardless of which
  pane has focus.

### Not implemented (intentionally — see [RFP Discussion Log](docs/en/csv-editor-rfp.md))
- xlsx / ods native read & write
- Formulas, charts, multiple sheets, macros
- Row filtering, frozen panes
- Per-file column width persistence
- Cloud sync / collaborative editing

### Known constraints
- Distributed unsigned for now; macOS Gatekeeper and Windows SmartScreen
  workarounds are documented in [README.md](README.md).
- Windows 11 only (Edge WebView2 ships with the OS; Windows 10 would
  require bundling the runtime separately).
- Apple Silicon prioritized; Intel macOS may work but is not actively
  validated.

[Unreleased]: https://github.com/nlink-jp/csv-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nlink-jp/csv-editor/releases/tag/v0.1.0
