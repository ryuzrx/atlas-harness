#!/bin/bash
# Builds "Atlas.app" and installs it to ~/Applications (no admin rights needed).
# Requires: Xcode command line tools (swiftc, python3 >= 3.9), and Node 22 for the UI build
# (installs a portable Node into .tools/node when npm is not available).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build"
APP="$OUT/Atlas.app"
DEST="${ATLAS_INSTALL_DIR:-$HOME/Applications}"
NODE_DIR="$ROOT/.tools/node"

# Node is only needed to compile the UI. Prefer a project-local runtime; if
# neither that nor a system npm exists, fetch a portable Node 22 so the build
# does not require Homebrew or an administrator install.
if [ ! -x "$NODE_DIR/bin/npm" ] && ! command -v npm >/dev/null 2>&1; then
  echo "==> Node/npm not found; installing a portable Node 22 into .tools/node"
  case "$(uname -m)" in
    arm64) NODE_ARCH="arm64" ;;
    x86_64) NODE_ARCH="x64" ;;
    *) echo "Unsupported Mac architecture: $(uname -m)"; exit 1 ;;
  esac
  NODE_TMP="$(mktemp -d)"
  trap 'rm -rf "$NODE_TMP"' EXIT
  NODE_BASE="https://nodejs.org/dist/latest-v22.x"
  curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$NODE_TMP/SHASUMS256.txt"
  NODE_FILE="$(awk -v suffix="darwin-$NODE_ARCH.tar.gz" 'index($2, suffix) { print $2; exit }' "$NODE_TMP/SHASUMS256.txt")"
  [ -n "$NODE_FILE" ] || { echo "No Node 22 build found for darwin-$NODE_ARCH"; exit 1; }
  curl -fsSL "$NODE_BASE/$NODE_FILE" -o "$NODE_TMP/$NODE_FILE"
  (cd "$NODE_TMP" && grep -F "  $NODE_FILE" SHASUMS256.txt | shasum -a 256 -c -)
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$NODE_TMP/$NODE_FILE" -C "$NODE_DIR" --strip-components=1
fi

export PATH="$NODE_DIR/bin:$PATH"

echo "==> Building UI"
(cd "$ROOT/apps/desktop" && { [ -d node_modules ] || npm ci; } && npm run build >/dev/null)

echo "==> Assembling bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/apps/macos/Info.plist" "$APP/Contents/Info.plist"
swiftc -O -target "$(uname -m)-apple-macosx13.0" -o "$APP/Contents/MacOS/Atlas" "$ROOT/apps/macos/main.swift" "$ROOT/apps/macos/companion.swift"
cp -R "$ROOT/apps/desktop/dist" "$APP/Contents/Resources/ui"
mkdir -p "$APP/Contents/Resources/backend"
rsync -a --exclude '__pycache__' "$ROOT/backend/atlas" "$APP/Contents/Resources/backend/"

echo "==> Icon"
ICONSET="$OUT/AppIcon.iconset"
rm -rf "$ICONSET"
swiftc -O -target "$(uname -m)-apple-macosx13.0" -o "$OUT/make_icon" "$ROOT/apps/macos/make_icon.swift"
"$OUT/make_icon" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> Python packages (vendored into the bundle; runs on the system python3)"
/usr/bin/python3 -m pip install -q --disable-pip-version-check --no-compile --target "$APP/Contents/Resources/pylib" -r "$ROOT/backend/requirements.txt"
find "$APP/Contents/Resources/pylib" -name '__pycache__' -prune -exec rm -rf {} +
/usr/bin/python3 -c "import sys; sys.path[:0]=['$APP/Contents/Resources/pylib','$APP/Contents/Resources/backend']; import atlas.api; print('   backend imports OK on', sys.version.split()[0])"

echo "==> Signing (ad-hoc)"
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "   (ad-hoc signing skipped)"

echo "==> Installing to $DEST"
mkdir -p "$DEST"
rm -rf "$DEST/ATLAS Harness.app" "$DEST/Atlas.app"  # also drop the old name
cp -R "$APP" "$DEST/"
du -sh "$DEST/Atlas.app"
echo "Done: $DEST/Atlas.app"
