package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nlink-jp/csv-editor/internal/config"
	"github.com/nlink-jp/csv-editor/internal/csvio"
	"github.com/nlink-jp/csv-editor/internal/encoding"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Bindings is the thin Wails binding layer.
// Business logic will be delegated to internal/ packages as features land.
type Bindings struct {
	ctx context.Context
}

func NewBindings() *Bindings {
	return &Bindings{}
}

func (b *Bindings) startup(ctx context.Context) {
	b.ctx = ctx
	// Register the file-drop callback now that we have a context. Wails
	// v2 wires this up via the runtime package rather than App options.
	wailsRuntime.OnFileDrop(ctx, func(x, y int, paths []string) {
		b.handleFileDrop(ctx, x, y, paths)
	})

	// Restore the saved window position. Size is already applied via App
	// options before the window exists; position has no equivalent option
	// so it is set after creation. A 0,0 fallback is left alone — the OS
	// will pick a sensible spot on the active screen.
	if cfg, err := config.Load(); err == nil && cfg.Window != nil {
		if cfg.Window.X != 0 || cfg.Window.Y != 0 {
			wailsRuntime.WindowSetPosition(ctx, cfg.Window.X, cfg.Window.Y)
		}
	}
}

func (b *Bindings) shutdown(_ context.Context) {
}

// saveWindowState persists the current window frame so the next launch
// restores it. Wired as Wails' OnBeforeClose callback. Returns false so
// the close proceeds normally.
func (b *Bindings) saveWindowState(ctx context.Context) (prevent bool) {
	w, h := wailsRuntime.WindowGetSize(ctx)
	x, y := wailsRuntime.WindowGetPosition(ctx)
	cfg, err := config.Load()
	if err != nil || cfg == nil {
		cfg = &config.Config{}
	}
	cfg.Window = &config.WindowState{X: x, Y: y, Width: w, Height: h}
	_ = config.Save(cfg)
	return false
}

// Version returns the build version (set via -ldflags at build time).
func (b *Bindings) Version() string {
	return version
}

// FileLoadResult is the payload returned to the frontend after a successful
// file load. Field tags are lowerCamelCase per Wails / JS convention.
type FileLoadResult struct {
	Path             string     `json:"path"`
	Filename         string     `json:"filename"`
	DetectedEncoding string     `json:"detectedEncoding"`
	UsedEncoding     string     `json:"usedEncoding"`
	Delimiter        string     `json:"delimiter"`
	LineEnding       string     `json:"lineEnding"`
	HasHeader        bool       `json:"hasHeader"`
	Header           []string   `json:"header"`
	Rows             [][]string `json:"rows"`
	MaxColumns       int        `json:"maxColumns"`
}

// SupportedReadEncodings exposes the encoding labels the dropdown can show.
func (b *Bindings) SupportedReadEncodings() []string {
	encs := encoding.AllReadable()
	out := make([]string, len(encs))
	for i, e := range encs {
		out[i] = string(e)
	}
	return out
}

// SupportedWriteEncodings exposes the encoding labels supported on save.
func (b *Bindings) SupportedWriteEncodings() []string {
	encs := encoding.AllWritable()
	out := make([]string, len(encs))
	for i, e := range encs {
		out[i] = string(e)
	}
	return out
}

// OpenFileDialog shows the OS file picker and returns the chosen path, or ""
// if the user cancelled.
func (b *Bindings) OpenFileDialog() (string, error) {
	path, err := wailsRuntime.OpenFileDialog(b.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Open CSV/TSV file",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "CSV/TSV (*.csv, *.tsv, *.txt)", Pattern: "*.csv;*.tsv;*.txt"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// SaveFileDialog shows the OS save dialog and returns the chosen path, or ""
// if the user cancelled.
func (b *Bindings) SaveFileDialog(defaultName string) (string, error) {
	path, err := wailsRuntime.SaveFileDialog(b.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save CSV/TSV as",
		DefaultFilename: defaultName,
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "CSV (*.csv)", Pattern: "*.csv"},
			{DisplayName: "TSV (*.tsv)", Pattern: "*.tsv"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// LoadFile reads path, decodes with encodingHint (or auto-detects when empty),
// parses as CSV or TSV based on delimiterHint or filename, and returns the
// parsed table. The window title is also updated to "<filename> — CSV Editor".
func (b *Bindings) LoadFile(path, encodingHint, delimiterHint string, hasHeader bool) (*FileLoadResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	detected := encoding.Detect(data)
	used := detected
	if encodingHint != "" {
		used = encoding.Encoding(encodingHint)
	}

	text, err := encoding.Decode(data, used)
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", used, err)
	}

	lineEnding := csvio.DetectLineEnding(text)

	delimiter := ','
	switch delimiterHint {
	case "\t":
		delimiter = '\t'
	case ",":
		delimiter = ','
	case "":
		if strings.HasSuffix(strings.ToLower(path), ".tsv") {
			delimiter = '\t'
		}
	}

	table, err := csvio.Parse(text, csvio.ParseOptions{
		Delimiter: delimiter,
		HasHeader: hasHeader,
	})
	if err != nil {
		return nil, err
	}

	filename := filepath.Base(path)
	wailsRuntime.WindowSetTitle(b.ctx, filename+" — CSV Editor")

	// Track this open in the recent files list and refresh the native menu.
	if cfg, err := config.Load(); err == nil {
		cfg.AddRecent(path)
		if saveErr := config.Save(cfg); saveErr == nil {
			b.rebuildMenu()
		}
	}

	return &FileLoadResult{
		Path:             path,
		Filename:         filename,
		DetectedEncoding: string(detected),
		UsedEncoding:     string(used),
		Delimiter:        string(delimiter),
		LineEnding:       string(lineEnding),
		HasHeader:        hasHeader,
		Header:           table.Header,
		Rows:             table.Rows,
		MaxColumns:       table.MaxColumns(),
	}, nil
}

// SaveFile encodes the table back to path with the given encoding, line
// ending, and delimiter. UTF-8-BOM is rejected (write encoding is "UTF-8" no
// BOM per RFP §2). Returns an error on failure; nil on success.
func (b *Bindings) SaveFile(path, encodingName, lineEnding, delimiter string, hasHeader bool, header []string, rows [][]string) error {
	delim := ','
	if delimiter == "\t" {
		delim = '\t'
	}

	le := csvio.LineEnding(lineEnding)
	if le != csvio.CRLF && le != csvio.LF && le != csvio.CR {
		le = csvio.LF
	}

	table := &csvio.Table{
		Header: header,
		Rows:   rows,
	}

	text, err := csvio.Encode(table, csvio.EncodeOptions{
		Delimiter:  delim,
		LineEnding: le,
		HasHeader:  hasHeader,
	})
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}

	data, err := encoding.Encode(text, encoding.Encoding(encodingName))
	if err != nil {
		return fmt.Errorf("transcode to %s: %w", encodingName, err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}

	wailsRuntime.WindowSetTitle(b.ctx, filepath.Base(path)+" — CSV Editor")
	return nil
}

// RequestOpenFile is invoked from the native menu. It runs the full flow
// (dialog → load) and notifies the frontend via the "file:loaded" event.
// On dialog cancel it emits nothing. On error it emits "file:error".
func (b *Bindings) RequestOpenFile() {
	path, err := b.OpenFileDialog()
	if err != nil {
		wailsRuntime.EventsEmit(b.ctx, "file:error", err.Error())
		return
	}
	if path == "" {
		return
	}
	result, err := b.LoadFile(path, "", "", true)
	if err != nil {
		wailsRuntime.EventsEmit(b.ctx, "file:error", err.Error())
		return
	}
	wailsRuntime.EventsEmit(b.ctx, "file:loaded", result)
}

// RequestSave is invoked from the native File ▸ Save menu. It emits a
// "menu:save" event for the frontend to handle (frontend owns the row state).
func (b *Bindings) RequestSave() {
	wailsRuntime.EventsEmit(b.ctx, "menu:save")
}

// RequestSaveAs is invoked from File ▸ Save As menu. Emits "menu:saveAs"
// for the frontend to drive the dialog + save flow.
func (b *Bindings) RequestSaveAs() {
	wailsRuntime.EventsEmit(b.ctx, "menu:saveAs")
}

// RecentFiles returns the current recent-files list (most recent first).
func (b *Bindings) RecentFiles() []string {
	cfg, err := config.Load()
	if err != nil || cfg == nil {
		return []string{}
	}
	return cfg.RecentFiles
}

// ClearRecentFiles empties the recent list and refreshes the menu.
func (b *Bindings) ClearRecentFiles() error {
	cfg, err := config.Load()
	if err != nil {
		cfg = &config.Config{}
	}
	cfg.RecentFiles = nil
	if err := config.Save(cfg); err != nil {
		return err
	}
	b.rebuildMenu()
	return nil
}

// handleFileDrop is invoked by Wails when files are dropped on the window.
// It emits the first path through "file:open-path" so the frontend can run
// its usual dirty-check / LoadFile flow.
func (b *Bindings) handleFileDrop(_ context.Context, _, _ int, paths []string) {
	if len(paths) == 0 {
		return
	}
	wailsRuntime.EventsEmit(b.ctx, "file:open-path", paths[0])
}

// rebuildMenu / buildMenu live in main.go's buildMenu helper, but are exposed
// through Bindings so callbacks (LoadFile, ClearRecentFiles) can refresh the
// native menu in place. The actual menu construction is in main.go.
var buildMenuFunc func(b *Bindings) any

func (b *Bindings) rebuildMenu() {
	if buildMenuFunc == nil || b.ctx == nil {
		return
	}
	m := buildMenuFunc(b)
	if m == nil {
		return
	}
	// Type assertion happens in main.go; we hold a generic any here so
	// bindings.go doesn't have to import wails/pkg/menu.
	if menu, ok := m.(applyMenu); ok {
		menu.apply(b.ctx)
	}
}

// applyMenu lets main.go inject the *menu.Menu update without pulling the
// menu package into bindings.go.
type applyMenu interface {
	apply(ctx context.Context)
}

// RequestNewFile is invoked from File ▸ New menu. The frontend listens
// for "menu:new" so it can confirm discarding unsaved changes first.
func (b *Bindings) RequestNewFile() {
	wailsRuntime.EventsEmit(b.ctx, "menu:new")
}

// NewFile returns a blank in-memory file scaffold (Untitled, 5×3) and
// updates the window title. Called by the frontend after the user has
// confirmed any unsaved-changes prompt.
func (b *Bindings) NewFile() *FileLoadResult {
	wailsRuntime.WindowSetTitle(b.ctx, "Untitled — CSV Editor")
	rows := make([][]string, 5)
	for i := range rows {
		rows[i] = []string{"", "", ""}
	}
	return &FileLoadResult{
		Path:             "",
		Filename:         "Untitled.csv",
		DetectedEncoding: string(encoding.UTF8),
		UsedEncoding:     string(encoding.UTF8),
		Delimiter:        ",",
		LineEnding:       string(csvio.LF),
		HasHeader:        false,
		Header:           []string{},
		Rows:             rows,
		MaxColumns:       3,
	}
}

// ConfirmDialog shows a Yes/No OS-native dialog. Returns true for Yes.
func (b *Bindings) ConfirmDialog(title, message string) (bool, error) {
	result, err := wailsRuntime.MessageDialog(b.ctx, wailsRuntime.MessageDialogOptions{
		Type:          wailsRuntime.QuestionDialog,
		Title:         title,
		Message:       message,
		DefaultButton: "No",
		CancelButton:  "No",
		Buttons:       []string{"Yes", "No"},
	})
	if err != nil {
		return false, err
	}
	return result == "Yes", nil
}
