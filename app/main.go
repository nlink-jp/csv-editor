package main

import (
	"context"
	"embed"
	"path/filepath"
	goruntime "runtime"

	"github.com/nlink-jp/csv-editor/internal/config"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var version = "dev"

//go:embed all:frontend/dist
var assets embed.FS

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
	bindings := NewBindings()
	buildMenuFunc = func(b *Bindings) any {
		return menuWrapper{m: buildMenu(b)}
	}

	// Restore the last-known window size if it looks sensible. Position is
	// applied separately in the startup hook, after the window exists.
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

	if goruntime.GOOS != "darwin" {
		fileMenu.AddSeparator()
		fileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			wailsRuntime.Quit(b.ctx)
		})
	}

	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.EditMenu())
	}

	return appMenu
}
