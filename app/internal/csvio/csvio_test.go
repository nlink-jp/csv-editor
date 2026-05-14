package csvio

import (
	"fmt"
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

func TestDetectLineEnding(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want LineEnding
	}{
		{"crlf", "a,b\r\n1,2\r\n", CRLF},
		{"lf", "a,b\n1,2\n", LF},
		{"cr only", "a,b\r1,2\r", CR},
		{"no line ending", "a,b", LF},
		{"empty", "", LF},
		{"crlf then lf mixed", "a\r\nb\nc", CRLF},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DetectLineEnding(tt.in); got != tt.want {
				t.Errorf("DetectLineEnding = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestEncode(t *testing.T) {
	tests := []struct {
		name  string
		table *Table
		opts  EncodeOptions
		want  string
	}{
		{
			name:  "simple csv lf",
			table: &Table{Rows: [][]string{{"a", "b"}, {"1", "2"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF},
			want:  "a,b\n1,2\n",
		},
		{
			name:  "simple csv crlf",
			table: &Table{Rows: [][]string{{"a", "b"}, {"1", "2"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: CRLF},
			want:  "a,b\r\n1,2\r\n",
		},
		{
			name:  "tsv",
			table: &Table{Rows: [][]string{{"a", "b"}, {"1", "2"}}},
			opts:  EncodeOptions{Delimiter: '\t', LineEnding: LF},
			want:  "a\tb\n1\t2\n",
		},
		{
			name:  "header included",
			table: &Table{Header: []string{"name", "age"}, Rows: [][]string{{"Alice", "30"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF, HasHeader: true},
			want:  "name,age\nAlice,30\n",
		},
		{
			name:  "header skipped when hasHeader false",
			table: &Table{Header: []string{"name", "age"}, Rows: [][]string{{"Alice", "30"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF, HasHeader: false},
			want:  "Alice,30\n",
		},
		{
			name:  "embedded comma is quoted",
			table: &Table{Rows: [][]string{{"hello, world", "x"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF},
			want:  "\"hello, world\",x\n",
		},
		{
			name:  "embedded quote is escaped",
			table: &Table{Rows: [][]string{{`she said "hi"`, "y"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF},
			want:  "\"she said \"\"hi\"\"\",y\n",
		},
		{
			name:  "japanese content",
			table: &Table{Header: []string{"名前", "年齢"}, Rows: [][]string{{"田中", "30"}}},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF, HasHeader: true},
			want:  "名前,年齢\n田中,30\n",
		},
		{
			name:  "empty table",
			table: &Table{},
			opts:  EncodeOptions{Delimiter: ',', LineEnding: LF},
			want:  "",
		},
		{
			name:  "default delimiter is comma",
			table: &Table{Rows: [][]string{{"a", "b"}}},
			opts:  EncodeOptions{LineEnding: LF},
			want:  "a,b\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Encode(tt.table, tt.opts)
			if err != nil {
				t.Fatalf("Encode error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Encode = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseEncodeRoundTrip(t *testing.T) {
	// Writer omits unnecessary quotes, so we compare normalized output
	// (parse the encoded output and verify the table matches).
	inputs := []string{
		"a,b,c\n1,2,3\n",
		"name,note\nAlice,\"hello, world\"\n",
		"a,b\n\"line 1\nline 2\",x\n",
	}

	for i, in := range inputs {
		t.Run(fmt.Sprintf("case-%d", i), func(t *testing.T) {
			parsed, err := Parse(in, ParseOptions{Delimiter: ',', HasHeader: false})
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			out, err := Encode(parsed, EncodeOptions{Delimiter: ',', LineEnding: LF, HasHeader: false})
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			if out != in {
				t.Errorf("round trip = %q, want %q", out, in)
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
