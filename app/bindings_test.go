package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadFileBoundedAcceptsAtLimit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "ok.csv")
	payload := []byte("hello")
	if err := os.WriteFile(p, payload, 0o600); err != nil {
		t.Fatalf("setup: %v", err)
	}

	data, err := readFileBounded(p, int64(len(payload)))
	if err != nil {
		t.Fatalf("unexpected error at limit: %v", err)
	}
	if string(data) != string(payload) {
		t.Fatalf("payload mismatch: got %q want %q", data, payload)
	}
}

func TestReadFileBoundedRejectsOversize(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.csv")
	if err := os.WriteFile(p, []byte("123456"), 0o600); err != nil {
		t.Fatalf("setup: %v", err)
	}

	_, err := readFileBounded(p, 5)
	if err == nil {
		t.Fatal("expected error for oversize file, got nil")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Fatalf("expected 'too large' error, got %v", err)
	}
}

func TestReadFileBoundedRejectsDirectory(t *testing.T) {
	_, err := readFileBounded(t.TempDir(), 5)
	if err == nil {
		t.Fatal("expected error for directory, got nil")
	}
	if !strings.Contains(err.Error(), "is a directory") {
		t.Fatalf("expected 'is a directory' error, got %v", err)
	}
}

func TestReadFileBoundedMissingFile(t *testing.T) {
	_, err := readFileBounded(filepath.Join(t.TempDir(), "nope.csv"), 5)
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
	if !strings.Contains(err.Error(), "open") {
		t.Fatalf("expected 'open' error wrapping, got %v", err)
	}
}
