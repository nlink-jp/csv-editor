APP     := csv-editor
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -X 'main.version=$(VERSION)'

# macOS Developer ID signing / notarization (see nlink-jp/.github
# CONVENTIONS.md §Code Signing → Wails / GUI apps). Defaults match
# any Developer ID Application cert in the keychain and the
# org-standard notary profile. Builds without these fall back to
# whatever signature `wails build` emitted (typically ad-hoc) with
# a one-line warning from the scripts.
CODESIGN_IDENTITY ?= Developer ID Application
NOTARY_PROFILE    ?= nlink-jp-notary
ENTITLEMENTS      ?= ../scripts/entitlements.plist

CODESIGN_SCRIPT := ../scripts/codesign-darwin-app.sh
NOTARIZE_SCRIPT := ../scripts/notarize-darwin-app.sh

# Homebrew tap generation (see ../scripts/release-brew.mk). After `make package`,
# `make brew` generates this cask from the built darwin-arm64 zip into the local
# nlink-jp/homebrew-tap checkout. The zip is named after $(APP), not a $(BINARY).
BREW_KIND      := cask
BREW_DESC      := Viewer and editor for CSV and TSV files
BREW_NAME      := $(APP)
BREW_APP       := $(APP).app
BREW_BUNDLE_ID := com.wails.csv-editor
GEN_BREW       := ../scripts/gen-brew.sh
include ../scripts/release-brew.mk

.PHONY: build build-darwin-arm64 build-windows-amd64 \
        build-all package dev test clean

## build: host-platform build + sign + dist copy.
##
## Convenience target for dev / manual use. For release artifacts use
## `make package`, which drives all three platforms (darwin/arm64,
## darwin/amd64, windows/amd64) and produces arch-suffixed zips.
build:
	wails build -ldflags "$(LDFLAGS)"
	@if [ -d build/bin/$(APP).app ]; then \
		$(CODESIGN_SCRIPT) build/bin/$(APP).app "$(CODESIGN_IDENTITY)" "$(ENTITLEMENTS)"; \
	fi
	mkdir -p dist
	# macOS preserves extended attributes (incl. code-sign
	# resources) via ditto, not cp -r. With cp -r the signature is
	# stripped and the launched binary aborts at startup with
	# "SIGKILL (Code Signature Invalid)" until manually re-signed.
	@if [ -d build/bin/$(APP).app ]; then \
		rm -rf dist/$(APP).app; \
		ditto build/bin/$(APP).app dist/$(APP).app; \
	fi
	@if [ -f build/bin/$(APP).exe ]; then \
		cp build/bin/$(APP).exe dist/; \
	fi

## build-darwin-arm64: cross-build for Apple Silicon, sign, stash in dist/.
## Each per-arch target wipes build/bin first so a stale .app from a prior
## platform build can't accidentally be re-signed and re-packaged.
build-darwin-arm64:
	rm -rf build/bin
	wails build -ldflags "$(LDFLAGS)" -platform darwin/arm64
	$(CODESIGN_SCRIPT) build/bin/$(APP).app "$(CODESIGN_IDENTITY)" "$(ENTITLEMENTS)"
	mkdir -p dist
	rm -rf dist/$(APP)-darwin-arm64.app
	ditto build/bin/$(APP).app dist/$(APP)-darwin-arm64.app

## build-windows-amd64: cross-build .exe for Windows x86_64. Unsigned —
## Authenticode signing for Windows is not yet in place.
build-windows-amd64:
	rm -rf build/bin
	wails build -ldflags "$(LDFLAGS)" -platform windows/amd64
	mkdir -p dist
	cp build/bin/$(APP).exe dist/$(APP)-windows-amd64.exe

## build-all: produce both release-platform artifacts back-to-back.
## Each output lands in dist/ with an arch suffix.
build-all: build-darwin-arm64 build-windows-amd64

## package: notarize each darwin .app (in-place stapling) then zip
## all release artifacts with version+arch-suffixed names matching the
## org Release Archive Standard (csv-editor-vX.Y.Z-<platform>-<arch>.zip,
## see nlink-jp/.github CONVENTIONS.md). The bundle / binary is renamed
## to its canonical name ($(APP).app / $(APP).exe) inside each zip so the
## user-visible name stays consistent regardless of arch. The darwin
## archive ships the self-contained .app; the Windows archive bundles the
## canonical .exe alongside README.md + LICENSE per the standard.
package: build-all
	$(NOTARIZE_SCRIPT) dist/$(APP)-darwin-arm64.app "$(NOTARY_PROFILE)"
	@cd dist && for arch in arm64; do \
		rm -rf _stage && mkdir _stage && \
		ditto $(APP)-darwin-$$arch.app _stage/$(APP).app && \
		(cd _stage && /usr/bin/ditto -c -k --keepParent $(APP).app ../$(APP)-$(VERSION)-darwin-$$arch.zip) && \
		rm -rf _stage; \
	done
	@cd dist && rm -rf _stage && mkdir _stage && \
		cp $(APP)-windows-amd64.exe _stage/$(APP).exe && \
		cp ../../README.md ../../LICENSE _stage/ && \
		(cd _stage && zip -q ../$(APP)-$(VERSION)-windows-amd64.zip $(APP).exe README.md LICENSE) && \
		rm -rf _stage
	@ls -la dist/*.zip

dev:
	wails dev

test:
	go test ./...

clean:
	rm -rf build/bin dist
