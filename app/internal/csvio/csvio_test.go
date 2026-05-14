package csvio

import (
	"reflect"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		opts       ParseOptions
		wantHeader []string
		wantRows   [][]string
	}{
		{
			name:       "simple csv no header",
			input:      "a,b,c\n1,2,3\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: false},
			wantHeader: nil,
			wantRows:   [][]string{{"a", "b", "c"}, {"1", "2", "3"}},
		},
		{
			name:       "simple csv with header",
			input:      "name,age\nAlice,30\nBob,25\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"name", "age"},
			wantRows:   [][]string{{"Alice", "30"}, {"Bob", "25"}},
		},
		{
			name:       "tsv",
			input:      "a\tb\n1\t2\n",
			opts:       ParseOptions{Delimiter: '\t', HasHeader: false},
			wantHeader: nil,
			wantRows:   [][]string{{"a", "b"}, {"1", "2"}},
		},
		{
			name:       "quoted field with embedded comma",
			input:      `name,note` + "\n" + `Alice,"hello, world"` + "\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"name", "note"},
			wantRows:   [][]string{{"Alice", "hello, world"}},
		},
		{
			name:       "quoted field with embedded newline",
			input:      "a,b\n" + `"line 1` + "\n" + `line 2","x"` + "\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"a", "b"},
			wantRows:   [][]string{{"line 1\nline 2", "x"}},
		},
		{
			name:       "escaped quotes",
			input:      `a,b` + "\n" + `"she said ""hi""",y` + "\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"a", "b"},
			wantRows:   [][]string{{`she said "hi"`, "y"}},
		},
		{
			name:       "crlf line endings",
			input:      "a,b\r\n1,2\r\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"a", "b"},
			wantRows:   [][]string{{"1", "2"}},
		},
		{
			name:       "cr-only line endings",
			input:      "a,b\r1,2\r3,4\r",
			opts:       ParseOptions{Delimiter: ',', HasHeader: false},
			wantHeader: nil,
			wantRows:   [][]string{{"a", "b"}, {"1", "2"}, {"3", "4"}},
		},
		{
			name:       "variable column counts",
			input:      "a,b,c\n1,2\n3,4,5,6\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: false},
			wantHeader: nil,
			wantRows:   [][]string{{"a", "b", "c"}, {"1", "2"}, {"3", "4", "5", "6"}},
		},
		{
			name:       "empty input",
			input:      "",
			opts:       ParseOptions{Delimiter: ',', HasHeader: false},
			wantHeader: nil,
			wantRows:   nil,
		},
		{
			name:       "header only no data",
			input:      "a,b,c\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"a", "b", "c"},
			wantRows:   nil,
		},
		{
			name:       "empty cells",
			input:      "a,,c\n,,\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: false},
			wantHeader: nil,
			wantRows:   [][]string{{"a", "", "c"}, {"", "", ""}},
		},
		{
			name:       "japanese content",
			input:      "名前,年齢\n田中,30\n",
			opts:       ParseOptions{Delimiter: ',', HasHeader: true},
			wantHeader: []string{"名前", "年齢"},
			wantRows:   [][]string{{"田中", "30"}},
		},
		{
			name:       "default delimiter is comma when zero",
			input:      "a,b\n",
			opts:       ParseOptions{HasHeader: false},
			wantHeader: nil,
			wantRows:   [][]string{{"a", "b"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input, tt.opts)
			if err != nil {
				t.Fatalf("Parse error: %v", err)
			}
			if !reflect.DeepEqual(got.Header, tt.wantHeader) {
				t.Errorf("Header = %v, want %v", got.Header, tt.wantHeader)
			}
			if !reflect.DeepEqual(got.Rows, tt.wantRows) {
				t.Errorf("Rows = %v, want %v", got.Rows, tt.wantRows)
			}
		})
	}
}

func TestMaxColumns(t *testing.T) {
	tests := []struct {
		name  string
		table *Table
		want  int
	}{
		{"empty", &Table{}, 0},
		{"header only", &Table{Header: []string{"a", "b", "c"}}, 3},
		{"rows only", &Table{Rows: [][]string{{"a", "b"}, {"c"}}}, 2},
		{"header narrower than rows", &Table{Header: []string{"a"}, Rows: [][]string{{"a", "b", "c"}}}, 3},
		{"header wider than rows", &Table{Header: []string{"a", "b", "c"}, Rows: [][]string{{"a"}}}, 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.table.MaxColumns(); got != tt.want {
				t.Errorf("MaxColumns = %d, want %d", got, tt.want)
			}
		})
	}
}
