// Package encoding provides character encoding detection and decoding for
// the CSV/TSV input range supported by csv-editor: UTF-8 (BOM optional),
// Shift_JIS, and CP932.
//
// Detection strategy (kept deliberately simple for v1):
//  1. UTF-8 BOM present → UTF8BOM
//  2. Bytes are valid UTF-8 → UTF8
//  3. Otherwise → CP932 (Excel's default on Japanese Windows)
//
// Shift_JIS proper and CP932 share a decoder in this implementation;
// japanese.ShiftJIS in golang.org/x/text uses CP932-compatible mappings.
// Users may still pick "Shift_JIS" explicitly on write when their downstream
// tool insists on the strict label.
package encoding

import (
	"bytes"
	"fmt"
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/transform"
)

// Encoding identifies a character encoding supported by csv-editor.
type Encoding string

const (
	UTF8     Encoding = "UTF-8"
	UTF8BOM  Encoding = "UTF-8-BOM"
	ShiftJIS Encoding = "Shift_JIS"
	CP932    Encoding = "CP932"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// AllReadable returns the encodings supported for read.
func AllReadable() []Encoding {
	return []Encoding{UTF8, UTF8BOM, ShiftJIS, CP932}
}

// AllWritable returns the encodings supported for write (UTF-8 BOM omitted
// per RFP; UTF-8 means "no BOM" on output).
func AllWritable() []Encoding {
	return []Encoding{UTF8, ShiftJIS, CP932}
}

// Detect returns the most likely encoding for data.
func Detect(data []byte) Encoding {
	if bytes.HasPrefix(data, utf8BOM) {
		return UTF8BOM
	}
	if utf8.Valid(data) {
		return UTF8
	}
	return CP932
}

// Decode converts data from enc to a UTF-8 string.
func Decode(data []byte, enc Encoding) (string, error) {
	switch enc {
	case UTF8:
		return string(data), nil
	case UTF8BOM:
		return string(bytes.TrimPrefix(data, utf8BOM)), nil
	case ShiftJIS, CP932:
		decoded, _, err := transform.Bytes(japanese.ShiftJIS.NewDecoder(), data)
		if err != nil {
			return "", fmt.Errorf("%s decode: %w", enc, err)
		}
		return string(decoded), nil
	default:
		return "", fmt.Errorf("unsupported encoding: %s", enc)
	}
}

// Encode converts a UTF-8 string to bytes in enc.
// UTF-8 output is always emitted without a BOM (per RFP §2 write spec).
func Encode(s string, enc Encoding) ([]byte, error) {
	switch enc {
	case UTF8:
		return []byte(s), nil
	case ShiftJIS, CP932:
		encoded, _, err := transform.Bytes(japanese.ShiftJIS.NewEncoder(), []byte(s))
		if err != nil {
			return nil, fmt.Errorf("%s encode: %w", enc, err)
		}
		return encoded, nil
	case UTF8BOM:
		return nil, fmt.Errorf("UTF-8-BOM is not a writable encoding; use UTF-8")
	default:
		return nil, fmt.Errorf("unsupported encoding: %s", enc)
	}
}
