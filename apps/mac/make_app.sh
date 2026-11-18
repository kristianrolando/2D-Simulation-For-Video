#!/bin/bash
# Build "Sim Studio.app" in the project root: double-click to start the studio and open it in the browser,
# with an icon in the macOS menu bar. Run it again after moving the project folder (the app remembers where
# the project is) or after editing menubar.swift / icon.py. It only writes inside the project folder, and
# never stops the studio server: it only closes an old copy of the menu bar icon.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/Sim Studio.app"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
command -v swiftc >/dev/null 2>&1 || { echo "swiftc tidak ada. Pasang Command Line Tools: xcode-select --install" >&2; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || echo "PERINGATAN: node tidak ditemukan di PATH sekarang; app akan memberi pesan saat dibuka. Pasang Node.js 23.6+ lalu jalankan skrip ini lagi." >&2

# close an old menu bar icon first (only that process; the server and its renders are not touched)
if /usr/bin/pgrep -f "Sim Studio.app/Contents/MacOS/sim-studio" >/dev/null 2>&1; then
  /usr/bin/osascript -e 'tell application id "local.sim-studio" to quit' >/dev/null 2>&1 || true
  sleep 1; /usr/bin/pkill -f "Sim Studio.app/Contents/MacOS/sim-studio" >/dev/null 2>&1 || true
fi
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# icon: icon.py (standard library only) -> png -> iconset -> icns
python3 "$ROOT/apps/mac/icon.py" "$TMP/icon.png"
mkdir "$TMP/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Sim Studio</string>
  <key>CFBundleDisplayName</key><string>Sim Studio</string>
  <key>CFBundleIdentifier</key><string>local.sim-studio</string>
  <key>CFBundleExecutable</key><string>sim-studio</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# project location + the PATH node was found with (an app opened from Finder gets a bare PATH)
NODEDIR="$([ -n "$NODE" ] && dirname "$NODE")"
printf 'ROOT=%s\nPATH=%s\n' "$ROOT" "${NODEDIR:+$NODEDIR:}$PATH" > "$APP/Contents/Resources/location.txt"

swiftc -O -target "$(uname -m)-apple-macos13.0" "$ROOT/apps/mac/menubar.swift" -o "$APP/Contents/MacOS/sim-studio"
chmod +x "$APP/Contents/MacOS/sim-studio"
codesign --force --sign - "$APP" 2>/dev/null || true   # ad-hoc signature is enough
touch "$APP"
echo "Dibuat: $APP"
