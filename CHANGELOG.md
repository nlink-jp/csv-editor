# Changelog

All notable changes to **csv-editor** are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-05-25

### Changed

- **File loads are now bounded to 500 MB.** Open / drag-drop / Open Recent
  refuse files larger than that with `file too large: <path> exceeds
  524288000 byte limit` instead of attempting to read the whole file into
  memory. csv-editor's stated target is hundreds of thousands of rows
  (~100 MB worst case for typical column counts), so the cap sits well
  above legitimate use while protecting the app from OOM on an accidental
  multi-gigabyte open. Implemented via `io.LimitReader` so a file that
  grows between `Stat` and `Read` still cannot blow the read buffer.

### Fixed

- **`File ▸ New Window` no longer leaks zombie child processes.**
  `RequestNewWindow` now reaps the spawned process via `cmd.Wait` in a
  goroutine and returns early on `cmd.Start` failure, preventing a defunct
  entry per new-window invocation from accumulating in the parent process
  table on Windows. On macOS the wait completes essentially immediately
  because the spawn goes through `open(1)`.

### Security

- **Saved CSV files are created with `0600` permissions** (owner read/write
  only), down from `0644`. CSV files often contain PII; the previous mode
  left files world-readable on disk even with the default macOS umask, which
  could expose rows when saving into shared, cloud-synced, or backed-up
  directories. Existing files keep their current permissions on overwrite.

### Documentation

- README (en/ja) and CLAUDE.md now declare Linux explicitly out of scope.
  Drive-by Linux porting PRs will be declined; users on Linux should use
  LibreOffice Calc or Modern CSV. See the closed PR #1 thread for the
  rationale.

### Acknowledgments

The three runtime changes above were originally surfaced by @SweetSophia
in PR #1 (closed without merge). The code was rewritten from scratch with
freshened helper signatures, tests, and rationale before landing.

## [0.1.3] - 2026-05-23

### Changed

- **macOS builds are Developer ID signed and Apple-notarized.**
  Replaces Wails's default ad-hoc signature with a full Apple
  Developer ID Application signature on the `.app` bundle, with
  Hardened Runtime + Apple secure timestamp + minimal WebKit JIT
  entitlements. `make package` submits the bundle to Apple's
  notary service and staples the ticket onto the `.app`, so
  offline first-launch works without a Gatekeeper verification
  dialog. End users on macOS no longer need the right-click → Open
  workaround documented in v0.1.2's README. Local users who install
  `csv-editor.app` under Dropbox / iCloud / OneDrive-synced paths
  are no longer killed by macOS's ad-hoc + provenance distrust
  policy. Pipeline adopts the org-wide convention in
  `nlink-jp/.github` CONVENTIONS.md §Code Signing → Wails / GUI
  apps. Windows `.exe` remains unsigned — Authenticode signing TBD.
- **macOS distribution format**: `make package` produces
  `csv-editor-vX.Y.Z-darwin.zip` (signed + notarized + stapled
  `.app` packaged via `ditto`); previous releases shipped an
  un-signed `.app` directly inside `dist/`.

No behaviour change to the editor itself — feature-wise this is
identical to v0.1.2.

## [0.1.2] - 2026-05-14

### Added
- Cells with embedded newlines (quoted multi-line CSV fields) are now
  visible and editable. The single-line cell view shows newlines as a
  muted `↵` glyph; the editor uses a `<textarea>` so Alt+Enter inserts a
  literal newline while Enter still commits (Shift+Enter / Tab / Esc
  unchanged). RFC 4180 quoting on save was already correct — only the
  UI was missing.
- **File ▸ New Window** (Cmd+Shift+N on macOS, Ctrl+Shift+N elsewhere)
  spawns a fresh csv-editor process so multiple files can be edited
  side by side. Wails v2 is single-window per process; on macOS the
  spawn uses `open -n -a` to register a distinct LaunchServices
  instance. The child window is offset +30,+30 from the parent
  (macOS-style cascade) via a `--window-position` argument so the new
  window doesn't perfectly overlap. Child instances skip the
  OnBeforeClose state save to keep the user's primary frame intact.
- **File ▸ Close Window** (Cmd+W / Ctrl+W) wired to the standard
  shortcut. Since Wails v2 runs one window per process, this also exits
  the app — OnBeforeClose still fires so window state is persisted.

### Fixed
- `File ▸ New` no longer inherits the previous file's per-column widths.
  `handleNew` now resets the columnWidths map alongside the existing
  selection / editing / error resets.

## [0.1.1] - 2026-05-14

### Added
- Window position and size are now persisted to the config file
  (`window.x`, `window.y`, `window.width`, `window.height`) and restored
  on next launch. Saved via Wails' `OnBeforeClose` hook; size is applied
  from `config.json` at app startup, position is applied after the
  window exists. Sub-200px dimensions are rejected (fallback to default).

### Changed
- Removed a Wails template-default `// replace github.com/wailsapp/wails/v2
  => /Users/magi/...` comment line from `app/go.mod` that leaked a local
  module path (caught by `check-org.sh`). The build resolves Wails via
  the normal module cache.

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

[Unreleased]: https://github.com/nlink-jp/csv-editor/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/nlink-jp/csv-editor/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/nlink-jp/csv-editor/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nlink-jp/csv-editor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nlink-jp/csv-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nlink-jp/csv-editor/releases/tag/v0.1.0
