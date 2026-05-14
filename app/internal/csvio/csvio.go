// Package csvio parses CSV and TSV text into a Table structure.
// RFC 4180 quoting is honored via the standard encoding/csv package.
package csvio

import (
	"encoding/csv"
	"fmt"
	"strings"
)

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
