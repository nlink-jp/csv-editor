package encoding

import (
	"bytes"
	"testing"
)

// CP932 bytes for "こんにちは,世界" (greeting + comma + "world").
// 0x82 0xb1 = こ, 0x82 0xf1 = ん, 0x82 0xc9 = に, 0x82 0xbf = ち, 0x82 0xcd = は
// 0x2c     = ',', 0x90 0xa2 = 世, 0x8a 0x45 = 界
var cp932Greeting = []byte{
	0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd,
	0x2c,
	0x90, 0xa2, 0x8a, 0x45,
}

const utf8Greeting = "こんにちは,世界"

func TestDetect(t *testing.T) {
	tests := []struct {
		name string
		in   []byte
		want Encoding
	}{
		{"empty", []byte{}, UTF8},
		{"ascii only", []byte("hello,world"), UTF8},
		{"utf8 without bom", []byte(utf8Greeting), UTF8},
		{"utf8 with bom", append([]byte{0xEF, 0xBB, 0xBF}, []byte(utf8Greeting)...), UTF8BOM},
		{"cp932 japanese", cp932Greeting, CP932},
		{"single high byte", []byte{0x82}, CP932},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Detect(tt.in); got != tt.want {
				t.Errorf("Detect = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestDecode(t *testing.T) {
	tests := []struct {
		name    string
		in      []byte
		enc     Encoding
		want    string
		wantErr bool
	}{
		{"utf8 ascii", []byte("hello"), UTF8, "hello", false},
		{"utf8 japanese", []byte(utf8Greeting), UTF8, utf8Greeting, false},
		{"utf8 bom is stripped", append([]byte{0xEF, 0xBB, 0xBF}, []byte(utf8Greeting)...), UTF8BOM, utf8Greeting, false},
		{"shift_jis japanese", cp932Greeting, ShiftJIS, utf8Greeting, false},
		{"cp932 japanese", cp932Greeting, CP932, utf8Greeting, false},
		{"empty input", []byte{}, UTF8, "", false},
		{"unsupported encoding", []byte("hi"), Encoding("EUC-JP"), "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode(tt.in, tt.enc)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Decode succeeded; want error")
				}
				return
			}
			if err != nil {
				t.Errorf("Decode error: %v", err)
				return
			}
			if got != tt.want {
				t.Errorf("Decode = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEncode(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		enc     Encoding
		want    []byte
		wantErr bool
	}{
		{"utf8 ascii", "hello", UTF8, []byte("hello"), false},
		{"utf8 japanese (no bom)", utf8Greeting, UTF8, []byte(utf8Greeting), false},
		{"shift_jis japanese", utf8Greeting, ShiftJIS, cp932Greeting, false},
		{"cp932 japanese", utf8Greeting, CP932, cp932Greeting, false},
		{"utf8 bom is not writable", "hi", UTF8BOM, nil, true},
		{"unsupported encoding", "hi", Encoding("EUC-JP"), nil, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Encode(tt.in, tt.enc)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Encode succeeded; want error")
				}
				return
			}
			if err != nil {
				t.Errorf("Encode error: %v", err)
				return
			}
			if !bytes.Equal(got, tt.want) {
				t.Errorf("Encode = %x, want %x", got, tt.want)
			}
		})
	}
}

func TestRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		s    string
		enc  Encoding
	}{
		{"utf8 ascii", "Hello, World", UTF8},
		{"utf8 japanese", "日本語テスト,カンマ込み", UTF8},
		{"shift_jis japanese", "日本語テスト,カンマ込み", ShiftJIS},
		{"cp932 japanese", "日本語テスト,カンマ込み", CP932},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			encoded, err := Encode(tt.s, tt.enc)
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			decoded, err := Decode(encoded, tt.enc)
			if err != nil {
				t.Fatalf("Decode: %v", err)
			}
			if decoded != tt.s {
				t.Errorf("round trip = %q, want %q", decoded, tt.s)
			}
		})
	}
}
