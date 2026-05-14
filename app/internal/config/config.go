// Package config persists user-level settings (recent files, etc.) to the
// OS-standard application support directory:
//
//	macOS:   ~/Library/Application Support/csv-editor/config.json
//	Windows: %APPDATA%\csv-editor\config.json
//	Linux:   ~/.config/csv-editor/config.json
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

const appDirName = "csv-editor"
const fileName = "config.json"
const maxRecentFiles = 10

type Config struct {
	RecentFiles []string     `json:"recentFiles"`
	Window      *WindowState `json:"window,omitempty"`
}

// WindowState is the last-known position and size of the main window.
// Restored on next launch so the user's preferred frame survives sessions.
type WindowState struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func dirPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, appDirName), nil
}

// Path returns the absolute path to the config file. Useful for tests.
func Path() (string, error) {
	d, err := dirPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, fileName), nil
}

// Load reads the config from disk. A missing file is not an error: an empty
// Config is returned so callers can use the result unconditionally.
func Load() (*Config, error) {
	p, err := Path()
	if err != nil {
		return &Config{}, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &Config{}, nil
		}
		return &Config{}, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		// Malformed config — start fresh rather than crashing.
		return &Config{}, nil
	}
	return &c, nil
}

// Save atomically replaces the config file. Parent directories are created
// as needed.
func Save(c *Config) error {
	d, err := dirPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(d, 0o755); err != nil {
		return err
	}
	p := filepath.Join(d, fileName)
	tmp := p + ".tmp"
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// AddRecent inserts path at the front, removes any earlier duplicate, and
// caps the list at maxRecentFiles entries.
func (c *Config) AddRecent(path string) {
	if path == "" {
		return
	}
	filtered := make([]string, 0, len(c.RecentFiles)+1)
	filtered = append(filtered, path)
	for _, p := range c.RecentFiles {
		if p == path {
			continue
		}
		filtered = append(filtered, p)
		if len(filtered) >= maxRecentFiles {
			break
		}
	}
	c.RecentFiles = filtered
}
