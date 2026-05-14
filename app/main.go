package main

import (
	"embed"
	goruntime "runtime"

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

func main() {
	bindings := NewBindings()
	appMenu := buildMenu(bindings)

	err := wails.Run(&options.App{
		Title:                    "CSV Editor",
		Width:                    1280,
		Height:                   800,
		EnableDefaultContextMenu: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 250, G: 250, B: 250, A: 1},
		Menu:             appMenu,
		OnStartup:        bindings.startup,
		OnShutdown:       bindings.shutdown,
		Bind: []interface{}{
			bindings,
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
	fileMenu.AddText("Open...", keys.CmdOrCtrl("o"), func(_ *menu.CallbackData) {
		b.RequestOpenFile()
	})
	fileMenu.AddText("Save", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
		b.RequestSave()
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
