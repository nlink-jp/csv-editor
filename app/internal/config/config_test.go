package config

import (
	"encoding/json"
	"reflect"
	"testing"
)

func jsonMarshal(c *Config) ([]byte, error) {
	return json.Marshal(c)
}

func jsonUnmarshal(data []byte) (*Config, error) {
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func TestConfigRoundTripWithWindow(t *testing.T) {
	// Verify the WindowState struct round-trips through JSON without
	// losing fields — guards against accidental tag/typing changes.
	in := &Config{
		RecentFiles: []string{"/a", "/b"},
		Window:      &WindowState{X: 100, Y: 200, Width: 1280, Height: 800},
	}
	data, err := jsonMarshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	out, err := jsonUnmarshal(data)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(out, in) {
		t.Errorf("round trip: got %+v / %+v, want %+v / %+v",
			out, out.Window, in, in.Window)
	}
}

func TestConfigBackwardCompatNoWindow(t *testing.T) {
	// Older config files (pre-window state) must still load with a nil
	// Window so the startup hook leaves the default frame in place.
	data := []byte(`{"recentFiles":["/a"]}`)
	out, err := jsonUnmarshal(data)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Window != nil {
		t.Errorf("expected Window to be nil for legacy config, got %+v", out.Window)
	}
	if !reflect.DeepEqual(out.RecentFiles, []string{"/a"}) {
		t.Errorf("RecentFiles = %v, want [/a]", out.RecentFiles)
	}
}

func TestAddRecent(t *testing.T) {
	tests := []struct {
		name    string
		initial []string
		add     string
		want    []string
	}{
		{"empty", nil, "/a", []string{"/a"}},
		{"prepend new", []string{"/b", "/c"}, "/a", []string{"/a", "/b", "/c"}},
		{
			"move existing to front",
			[]string{"/a", "/b", "/c"},
			"/c",
			[]string{"/c", "/a", "/b"},
		},
		{
			"caps at 10",
			[]string{"/0", "/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/9"},
			"/x",
			[]string{"/x", "/0", "/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8"},
		},
		{"empty path is no-op", []string{"/a"}, "", []string{"/a"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Config{RecentFiles: append([]string(nil), tt.initial...)}
			c.AddRecent(tt.add)
			if !reflect.DeepEqual(c.RecentFiles, tt.want) {
				t.Errorf("AddRecent = %v, want %v", c.RecentFiles, tt.want)
			}
		})
	}
}
