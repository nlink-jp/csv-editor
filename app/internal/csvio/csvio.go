// Package csvio parses CSV and TSV text into a Table structure and renders
// a Table back to CSV/TSV. RFC 4180 quoting is honored via the standard
// encoding/csv package.
package csvio

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"strings"
)

// LineEnding identifies the EOL bytes used in a text file.
type LineEnding string

const (
	CRLF LineEnding = "CRLF"
	LF   LineEnding = "LF"
	CR   LineEnding = "CR"
)

// DetectLineEnding returns the line ending used in text, scanning at most
// the first 8 KiB. Returns LF when text contains no line ending.
func DetectLineEnding(text string) LineEnding {
	head := text
	if len(head) > 8192 {
		head = head[:8192]
	}
	for i := 0; i < len(head); i++ {
		if head[i] == '\r' {
			if i+1 < len(head) && head[i+1] == '\n' {
				return CRLF
			}
			return CR
		}
		if head[i] == '\n' {
			return LF
		}
	}
	return LF
}

// Table is a parsed CSV/TSV document.
// Header is nil when ParseOptions.HasHeader was false.
type Table struct {
	Header []string
	Rows   [][]string
}

// ParseOptions controls Parse behavior.
type ParseOptions struct {
	// Delimiter is the field separator. Defaults to ',' if zero.
	Delimiter rune
	// HasHeader treats the first row as the header.
	HasHeader bool
}

// Parse decodes CSV/TSV text into a Table.
// CR-only line endings are normalized to LF before parsing (a side effect:
// literal CR characters inside quoted fields are also translated).
func Parse(text string, opts ParseOptions) (*Table, error) {
	if opts.Delimiter == 0 {
		opts.Delimiter = ','
	}

	if !strings.Contains(text, "\n") && strings.Contains(text, "\r") {
		text = strings.ReplaceAll(text, "\r", "\n")
	}

	r := csv.NewReader(strings.NewReader(text))
	r.Comma = opts.Delimiter
	r.LazyQuotes = true
	r.FieldsPerRecord = -1

	records, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("csv parse: %w", err)
	}

	table := &Table{}
	if opts.HasHeader && len(records) > 0 {
		table.Header = records[0]
		if len(records) > 1 {
			table.Rows = records[1:]
		}
	} else {
		table.Rows = records
	}

	return table, nil
}

// MaxColumns returns the widest row's column count (0 for an empty Table).
// Used by the UI to allocate enough column slots when rows have varying widths.
func (t *Table) MaxColumns() int {
	max := len(t.Header)
	for _, row := range t.Rows {
		if len(row) > max {
			max = len(row)
		}
	}
	return max
}

// EncodeOptions controls Encode behavior.
type EncodeOptions struct {
	Delimiter  rune
	LineEnding LineEnding
	HasHeader  bool
}

// Encode renders a Table to CSV/TSV text. The encoding/csv writer always
// emits a trailing line ending after each record, including the last.
// LineEnding CR (old Mac) is mapped to LF on write — modern tools don't
// emit CR-only files.
func Encode(table *Table, opts EncodeOptions) (string, error) {
	if opts.Delimiter == 0 {
		opts.Delimiter = ','
	}

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	w.Comma = opts.Delimiter
	w.UseCRLF = opts.LineEnding == CRLF

	if opts.HasHeader && len(table.Header) > 0 {
		if err := w.Write(table.Header); err != nil {
			return "", fmt.Errorf("write header: %w", err)
		}
	}
	if err := w.WriteAll(table.Rows); err != nil {
		return "", fmt.Errorf("write rows: %w", err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}

	return buf.String(), nil
}
