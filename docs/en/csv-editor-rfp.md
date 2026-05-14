# RFP: csv-editor

> Generated: 2026-05-14
> Status: Draft

## 1. Problem Statement

Existing CSV editing tools — especially **TableTool**, widely used on macOS —
have several fundamental limitations:

1. **Maintenance stopped** — No upstream path to address grievances.
2. **Intel Mac binary only** — Will stop working on the upcoming ARM64-only
   macOS release.
3. **UTF-8 only** — External character encoding conversion is required when
   exchanging CSV files with Excel, which still requires Shift_JIS / CP932 on
   Japanese Windows.
4. **No row/column-level copy operations** — Basic spreadsheet operations
   that should be table stakes are missing.
5. **TSV paste collapses into a single cell** — Pasting tab-separated text
   from the clipboard dumps everything into one cell instead of expanding
   across multiple cells.

`csv-editor` is a CSV/TSV-only GUI editor for both Windows and macOS that
addresses these problems **in a form the author can modify directly**. It is
not a spreadsheet replacement; it aims to be a high-quality CSV/TSV viewer
and editor, nothing more.

### Target Users

Primarily the author (an individual user working with Japanese-language data).
Secondarily, any user frustrated with current CSV/TSV handling. The project
will eventually be published as OSS on GitHub.

## 2. Functional Specification

### Input / Output Encodings

| Operation | Supported | Policy |
|-----------|-----------|--------|
| Read | UTF-8 (BOM optional), Shift_JIS, CP932 | Auto-detect. User can re-specify and reload on detection error |
| Write | UTF-8 (BOM optional), Shift_JIS, CP932 | User-selectable at save time; default configurable |

Other encodings (UTF-16, EUC-JP, etc.) are out of scope for now.

### Line Endings

- **Read**: Auto-detect (mixed CRLF / LF / CR tolerated)
- **Write**: User-selectable per save (CRLF / LF); default configurable

### Scale and Performance

- Target maximum: **hundreds of thousands of rows**
- → **Virtual scrolling is mandatory**. All data lives in memory; only the
  visible range renders.

### CSV / TSV Dialects

- **Delimiter**: Native support for both CSV (`,`) and TSV (`\t`). Auto-switch
  per file in the same window.
- **Quoting**: RFC 4180 compliant (`"..."` for field quoting, `""` for escape).
- **Header row**: User-specified per file.

### Editing Operations

| Category | Behavior |
|----------|----------|
| Cell | IME-safe editing (waits for `compositionend`), Enter to commit, Esc to cancel |
| Row | Insert / delete / duplicate / reorder (drag), multi-row bulk |
| Column | Insert / delete / duplicate / reorder (drag), multi-column bulk |
| History | Undo / Redo (depth ~50) |
| Search | Incremental + regex |
| Replace | Replace all / one-by-one with confirmation |
| Sort | Column-keyed, string/numeric, asc/desc, multi-key |
| Column width | Manual adjust + auto-fit |
| Type inference | Right-alignment for numeric columns (display only, no type coercion) |

### Clipboard (Central to Resolving Pain Points)

| Operation | Behavior |
|-----------|----------|
| Cell-range copy | Write TSV to clipboard (Excel-compatible) |
| Row-selection copy | Write entire rows as TSV (multi-row supported) |
| Column-selection copy | Write entire columns as TSV (multi-column supported) |
| TSV paste into single cell | Split on tab/newline; expand into multiple cells |
| TSV paste into matching-shape selection | Paste as-is |
| TSV paste into mismatched-shape selection | **Show warning dialog for user confirmation** |

### File Operations

- New / Open / Save / Save As (encoding & line-ending selection dialog)
- **One file per window**; multiple files open in multiple windows
- Drag & drop to open
- Recent files history (10 entries)

### Color Theme

- **Automatic OS dark/light mode tracking is mandatory** (macOS Appearance,
  Windows Light/Dark)
- Implemented via CSS custom properties +
  `@media (prefers-color-scheme: dark)`, **built in from Phase 1** —
  retrofitting later requires rewriting the entire stylesheet.
- User override (Auto / Light / Dark) is deferred to a later phase. Phase 1
  ships with OS-following only.

### Configuration Storage

A single JSON file at the OS-standard location:

- macOS: `~/Library/Application Support/csv-editor/config.json`
- Windows: `%APPDATA%\csv-editor\config.json`

Stored items (currently only recent files; other entries are future
extensions):
- Recent files (10 entries)
- (future) Default write encoding / line ending
- (future) Window size & position, font, theme preference

Column widths are session-only (in-memory) for now. Persistence is out of
scope until concrete demand appears (see Discussion Log §9).

### External Dependencies

No external API calls. Only local filesystem reads/writes and configuration
directory writes.

## 3. Design Decisions

### Framework Choice: Wails (Go) + React/TypeScript + TanStack Table

Candidates considered:

| Candidate | Binary Size | Table Performance | IME | Existing nlink Assets |
|-----------|-------------|-------------------|-----|----------------------|
| **Wails (chosen)** | ~few MB | ◎ (TanStack Table virtualization) | △〜○ (requires careful WebView IME handling) | ◎ (Go) |
| Tauri | ~few MB | ◎ | △〜○ | None |
| Flutter Desktop | ~20 MB | ○ | ○ | None |
| Qt + PySide6 | 50 MB+ | ◎ (native QTableView) | ◎ | △ (Python) |
| Electron | 100 MB+ | ○ | ○ | None |

**Deciding factors:**

1. **Go consistency with util-series** — Reuse of existing Go assets and
   know-how from `csv-to-json`, `json-to-table`, `shell-agent-v2`, etc.
2. **Single-executable distribution** — Python (PySide6) requires
   high-overhead deployment; rejected.
3. **Hundreds-of-thousands-row scale via virtualization** — TanStack Table
   makes this tractable.
4. **Modern UI development** — React for flexibility; Apple Silicon native
   builds are standard.

**IME commit behavior** is central to resolving the pain points; careful
handling of `compositionstart` / `compositionend` in the WebView layer is
required.

### Distribution Format

OS-specific **single executable** (macOS `.app`, Windows `.exe`) produced by
the standard Wails build.

### Relationship to Existing nlink-jp Assets

`csv-editor` is **complementary** to util-series CSV-family CLI tools
(`csv-to-json`, `json-to-table`, etc.):
- CLI: pipeline processing, scripting integration
- `csv-editor` (GUI): interactive viewing and editing

### Out of Scope (Explicitly Excluded)

- Formulas / functions (Excel `=SUM()` etc.)
- Multiple sheets / workbook structure
- Chart drawing
- Native xlsx / ods read/write
- Macros / scripting
- Collaborative editing / cloud sync
- **Filter** (row filtering by column predicate — moved out of scope mid Phase 3)
- **Frozen pane** (column pinning — moved out of scope mid Phase 3)

Including any of these would erode the project's positioning as a
**CSV/TSV-dedicated tool**.

## 4. Development Plan

### Phase 1: Core (read-only)

- Wails project scaffold
- File loading (auto encoding detection)
- Virtual-scrolling display
- Encoding override → reload
- Cell selection

Independently reviewable; the result is "able to read" but already useful.

### Phase 2: Editing

- Cell editing (IME-safe)
- Row / column insert / delete / duplicate / reorder
- Clipboard (copy = TSV, paste = TSV split, warn on shape mismatch)
- Undo / Redo
- Header-row setting
- Save (encoding & line-ending selection)

### Phase 3: Productivity

- Search (incremental + regex)
- Replace (all / one-by-one)
- Sort (multi-key)
- Column auto-fit
- Recent files
- Drag & drop

### Phase 4: Release

- macOS / Windows build configuration
- Icon
- README / README.ja
- GitHub Releases distribution
- README guidance on unsigned-binary workarounds (Gatekeeper / SmartScreen)

Each phase is independently reviewable.

### Testing Policy

- **Go layer**: CSV/TSV parser, encoding detection, Undo/Redo stack,
  clipboard conversion — mandatory table-driven unit tests
  (CONVENTIONS.md rule).
- **React layer**: Component tests with Vitest + React Testing Library.
  IME input, virtual scrolling, and TSV paste expansion get particular focus.
- **E2E**: Manual checklist through Phase 4. Automated E2E
  (Playwright, etc.) considered later if needed.

## 5. Required API Scopes / Permissions

No external API calls.

Runtime permissions:
- Filesystem read/write (via OS-standard file pickers)
- Configuration-directory writes (OS app-support directory)

Distribution certificates:
- macOS: Apple Developer Program ($99/year) — **not pursued for now** →
  unsigned distribution
- Windows: Code-signing certificate — **not pursued for now** → unsigned
  distribution
- README documents macOS Gatekeeper / Windows SmartScreen workarounds.

## 6. Series Placement

**Series**: `util-series`

**Rationale**: util-series was originally defined as "Pipe-friendly data
transformation and processing CLIs," but in practice it already contains GUI
applications such as `mail-analyzer-gui`, `markdown-viewer`, and
`quick-translate` — the series has effectively expanded to encompass the
broader "data utility" umbrella. `csv-editor` complements the existing CSV
tooling and fits naturally here.

## 7. External Platform Constraints

### macOS

- WebView: WebKit (OS-bundled)
- Apple Silicon (ARM64) is the primary target. Intel Mac builds may still
  work but are not prioritized — this is precisely the failure mode of
  TableTool that motivated the project.
- Gatekeeper warning will appear due to unsigned distribution. README
  documents the right-click → Open workaround.

### Windows

- WebView: Edge WebView2
- **Windows 11 only** (WebView2 is OS-bundled there)
- Windows 10 would require bundling the WebView2 runtime separately;
  excluded to reduce maintenance overhead.
- SmartScreen warning will appear due to unsigned distribution. README
  documents the "More info → Run anyway" workaround.

### Distribution Channels

- GitHub Releases for now.
- Mac App Store / Microsoft Store listings are deferred future work.

---

## Discussion Log

Key decision points from the planning session (2026-05-14):

### 1. Series Placement Debate

Initially proposed creating a new `desktop-series` / `gui-series` or starting
in `lab-series`, since util-series' CONVENTIONS define it as "Pipe-friendly
CLI." However, on inspection util-series already contains GUI apps
(`mail-analyzer-gui`, `markdown-viewer`, `quick-translate`), so the
definition has effectively expanded. **Decision: place in util-series.**

### 2. Framework Selection

Compared Tauri / Wails / Flutter / Qt+PySide6 / Electron. Deciding factors:

- (a) **Go choice** maintains consistency with util-series
- (b) **Single-executable distribution** is required; Python (PySide6) was
  rejected for deployment overhead
- (c) **TanStack Table virtualization** handles hundreds-of-thousands of rows
- (d) IME commit behavior is a common WebView pitfall but tractable with
  careful `compositionend` handling

→ **Wails (Go) + React/TypeScript + TanStack Table** confirmed.

### 3. Paste Behavior on Shape Mismatch

Three options for pasting clipboard TSV into a multi-cell selection when
shapes don't match:

- (A) Excel-style: ignore selection, paste in clipboard's shape
- (B) Some-spreadsheet-style: clip to selection (excess discarded, deficit
  repeated)
- (C) Show a warning dialog

**Chose (C) to prioritize user-intent confirmation** and minimize accidental
data damage.

### 4. Dropping Windows 10 Support

Edge WebView2 is OS-bundled on Windows 11 but requires separate bundling on
Windows 10. To reduce maintenance overhead on a personal project, support is
limited to Windows 11.

### 5. Distribution Signing Strategy

Avoiding the cost of Apple Developer Program ($99/year) and Windows
code-signing certificates, **the project will distribute unsigned binaries
for now**. README documents the macOS Gatekeeper / Windows SmartScreen
workarounds. To be revisited as the user base grows.

### 6. Testing Policy

Per CONVENTIONS.md's "tests are mandatory with the implementation" rule, the
Go layer requires table-driven unit tests, the React layer uses Vitest+RTL
for component tests, and E2E runs as a manual checklist through Phase 4 with
automation considered as needed.

### 7. Color Theme Made Mandatory (added during Phase 2 scaffold review)

Verification of the scaffold revealed that theming had been omitted from the
plan. Retrofitting themes later would require a wholesale CSS rewrite, so
**Phase 1 will ship with OS-following dark/light support via CSS custom
properties + `prefers-color-scheme`**. User overrides (Auto / Light / Dark)
are deferred to Phase 3 or later.

### 9. Filter and Frozen Pane Dropped (decided mid Phase 3)

Filter (row filtering by column predicate) and Frozen Pane (column pinning)
were listed in §2 of the original RFP. Once Phase 3 had landed find/replace,
sort, column width, drag-and-drop, and recent files, the user decided to
**defer both features indefinitely**.

**Rationale:**
- Search + sort already cover the common "find / order" use cases.
- Hiding rows and freezing columns are read-side ergonomics; they're not
  core to a CSV editor's editing functionality.
- The virtualized table already keeps the header row sticky. Frozen-pane
  value beyond that is mainly "pin the leftmost column" — uncertain
  demand at this stage.

Both items are recorded in §3 Out of Scope. Revisit if real use cases
appear.

By the same reasoning, **column-width persistence** (originally listed in
§2 under stored configuration items) is also deferred. Manual resize and
auto-fit work within a session; per-file persistence stays out of scope
until a concrete need surfaces.

### 8.5 UTF-8-BOM Added to Write Encodings (decided mid Phase 2 chunk B)

The original RFP §2 listed write encodings as **UTF-8 (no BOM) / Shift_JIS /
CP932**. Opening a BOM-prefixed UTF-8 file and trying to Save As triggered
"UTF-8-BOM is not a writable encoding."

Options considered:
- (A) Silently map UTF-8-BOM → UTF-8 on save (strips the BOM)
- (B) Support UTF-8 with BOM on write as well (read = write symmetry)

User chose **(B)**.

**Rationale:**
- Preserves round-trip — open and save returns the same byte form.
- Japanese Excel on Windows prefers UTF-8 with BOM (without it, files are
  often misread as CP932).
- Read and write supported sets become symmetric, keeping the mental model
  simple.

`encoding.Encode(text, UTF8BOM)` prepends EF BB BF before the UTF-8 bytes.
`SupportedReadEncodings` and `SupportedWriteEncodings` now return the same
set.

### 8. Native Title Bar Adopted (decided during Phase 2 scaffold review)

The initial scaffold used a macOS transparent titlebar (`FullSizeContent: true`
+ `TitlebarAppearsTransparent: true`), but this produced (a) a non-draggable
window unless `--wails-draggable: drag` was placed by hand, and (b) double
title rendering (OS-drawn vs React-rendered). For a utility application,
flashy chrome is unwarranted, so the scaffold **switched to the native OS
title bar**. The title bar will show the open file name
(e.g. `data.csv — CSV Editor`), updated dynamically via
`runtime.WindowSetTitle` from Phase 2 onward.
