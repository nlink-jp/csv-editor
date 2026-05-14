package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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
}

func (b *Bindings) shutdown(_ context.Context) {
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
