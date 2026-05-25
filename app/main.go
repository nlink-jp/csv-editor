package main

import (
	"context"
	"embed"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strconv"

	"github.com/nlink-jp/csv-editor/internal/config"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// spawnedPosition is non-nil only when this process was launched by another
// csv-editor via File ▸ New Window. The spawner passes its current
// position + cascade offset on the command line so the child window opens
// next to the parent (not exactly under it).
var spawnedPosition *struct{ X, Y int }

// childInstance is true when this process is a New Window spawn. Used to
// skip saving the window state to config — otherwise repeated New Window
// invocations would cascade and pollute the user's preferred position.
var childInstance bool

// parseSpawnArgs scans os.Args for "--window-position X Y". Called from
// main() before wails.Run so startup hooks can see the result.
func parseSpawnArgs() {
	for i, a := range os.Args {
		if a == "--window-position" && i+2 < len(os.Args) {
			x, errx := strconv.Atoi(os.Args[i+1])
			y, erry := strconv.Atoi(os.Args[i+2])
			if errx == nil && erry == nil {
				spawnedPosition = &struct{ X, Y int }{X: x, Y: y}
				childInstance = true
			}
			return
		}
	}
}

var version = "dev"

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

// menuWrapper implements bindings.applyMenu so rebuildMenu can swap the
// native menu without bindings.go pulling in the wails menu types.
type menuWrapper struct{ m *menu.Menu }

func (w menuWrapper) apply(ctx context.Context) {
	wailsRuntime.MenuSetApplicationMenu(ctx, w.m)
	wailsRuntime.MenuUpdateApplicationMenu(ctx)
}

const (
	defaultWindowWidth  = 1280
	defaultWindowHeight = 800
	minWindowDimension  = 200
)

func main() {
	parseSpawnArgs()

	bindings := NewBindings()
	buildMenuFunc = func(b *Bindings) any {
		return menuWrapper{m: buildMenu(b)}
	}

	// Restore the last-known window size if it looks sensible. Position is
	// applied separately in the startup hook, after the window exists.
	// Child instances inherit size from the saved config too — only the
	// position is offset so the new window doesn't perfectly overlap.
	width := defaultWindowWidth
	height := defaultWindowHeight
	if cfg, err := config.Load(); err == nil && cfg.Window != nil {
		if cfg.Window.Width >= minWindowDimension {
			width = cfg.Window.Width
		}
		if cfg.Window.Height >= minWindowDimension {
			height = cfg.Window.Height
		}
	}

	err := wails.Run(&options.App{
		Title:                    "CSV Editor",
		Width:                    width,
		Height:                   height,
		EnableDefaultContextMenu: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 250, G: 250, B: 250, A: 1},
		Menu:             buildMenu(bindings),
		OnStartup:        bindings.startup,
		OnShutdown:       bindings.shutdown,
		OnBeforeClose:    bindings.saveWindowState,
		Bind: []interface{}{
			bindings,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		// macOS About panel content. Without this, "About CSV Editor"
		// in the application menu opens a panel populated from
		// Info.plist defaults (which still read CFBundleShortVersionString
		// as "1.0.0" because Wails templates that field and we don't
		// override it). Sourcing version from the same `version`
		// ldflag the binary uses keeps the menu, the panel, and any
		// programmatic Version() call in agreement from one input.
		Mac: &mac.Options{
			About: &mac.AboutInfo{
				Title:   "CSV Editor",
				Message: "Version " + version + "\n\nCSV/TSV viewer & editor for macOS and Windows.\n© 2026 nlink-jp",
				Icon:    appIcon,
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

func buildMenu(b *Bindings) *menu.Menu {
	appMenu := menu.NewMenu()

	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.AppMenu())
	}

	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.AddText("New", keys.CmdOrCtrl("n"), func(_ *menu.CallbackData) {
		b.RequestNewFile()
	})
	fileMenu.AddText("New Window", keys.Combo("n", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		b.RequestNewWindow()
	})
	fileMenu.AddText("Open...", keys.CmdOrCtrl("o"), func(_ *menu.CallbackData) {
		b.RequestOpenFile()
	})

	recentMenu := fileMenu.AddSubmenu("Open Recent")
	cfg, _ := config.Load()
	if cfg != nil && len(cfg.RecentFiles) > 0 {
		for _, p := range cfg.RecentFiles {
			path := p // capture by value for the closure
			recentMenu.AddText(filepath.Base(path), nil, func(_ *menu.CallbackData) {
				wailsRuntime.EventsEmit(b.ctx, "file:open-path", path)
			})
		}
		recentMenu.AddSeparator()
		recentMenu.AddText("Clear Recent Files", nil, func(_ *menu.CallbackData) {
			_ = b.ClearRecentFiles()
		})
	} else {
		emptyItem := recentMenu.AddText("(none)", nil, nil)
		emptyItem.Disabled = true
	}

	fileMenu.AddSeparator()
	fileMenu.AddText("Save", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
		b.RequestSave()
	})
	fileMenu.AddText("Save As...", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		b.RequestSaveAs()
	})

	// Close Window (Cmd+W on macOS, Ctrl+W on Win/Linux). Wails v2 is
	// single-window per process, so closing the window quits the app —
	// OnBeforeClose still fires, which persists window state before exit.
	fileMenu.AddSeparator()
	fileMenu.AddText("Close Window", keys.CmdOrCtrl("w"), func(_ *menu.CallbackData) {
		wailsRuntime.Quit(b.ctx)
	})

	if goruntime.GOOS != "darwin" {
		fileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			wailsRuntime.Quit(b.ctx)
		})
	}

	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.EditMenu())
		// WindowMenu provides Minimize / Zoom / Bring All to Front —
		// users expect these on macOS, and their absence is more visible
		// once the AppMenu's About panel actually works.
		appMenu.Append(menu.WindowMenu())
	}

	return appMenu
}
