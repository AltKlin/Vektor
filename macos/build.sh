#!/bin/zsh
# Builds Vektor.app (native WKWebView, universal Apple Silicon + Intel) in ~/Applications,
# or in the $VEKTOR_APP_DIR folder if set. Requirements: Xcode Command Line Tools.
set -e
cd "$(dirname "$0")"
python3 ../build.py
APP="${VEKTOR_APP_DIR:-$HOME/Applications}/Vektor.app"
rm -rf build && mkdir -p build/AppIcon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s icon1024.png --out build/AppIcon.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) icon1024.png --out build/AppIcon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns build/AppIcon.iconset -o build/AppIcon.icns
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target $arch-apple-macos13.0 main.swift selftest.swift -o build/Vektor-$arch -framework Cocoa -framework WebKit
done
lipo -create build/Vektor-arm64 build/Vektor-x86_64 -output build/Vektor
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/"
cp build/Vektor "$APP/Contents/MacOS/"
cp ../dist/vektor.html build/AppIcon.icns "$APP/Contents/Resources/"
codesign --force --deep -s - "$APP"
echo "OK -> $APP"
