#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h:h}"
APP="$PROJECT_ROOT/build/Star Mini Screen.app"
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  print -u2 '需要 Apple Command Line Tools。请先运行 xcode-select --install，安装完成后重试。'
  exit 1
fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$PROJECT_ROOT/Info.plist" "$APP/Contents/Info.plist"
rm -rf "$APP/Contents/Resources/web"
cp -R "$PROJECT_ROOT/web" "$APP/Contents/Resources/web"
python3 "$PROJECT_ROOT/scripts/build-dashboard.py"
python3 "$PROJECT_ROOT/scripts/fetch-runtime.py"
mkdir -p "$APP/Contents/Resources/dashboard/design-demos" "$APP/Contents/Resources/dashboard/integrations/weather" "$APP/Contents/Resources/runtime"
cp "$PROJECT_ROOT"/design-demos/*.html "$APP/Contents/Resources/dashboard/design-demos/"
for module in "$PROJECT_ROOT"/integrations/*.mjs; do
  [[ "$module" == *.test.mjs ]] || cp "$module" "$APP/Contents/Resources/dashboard/integrations/"
done
cp "$PROJECT_ROOT"/integrations/weather/Apple-Weather.* "$APP/Contents/Resources/dashboard/integrations/weather/"
cp -R "$PROJECT_ROOT/.cache/runtime/arm64" "$PROJECT_ROOT/.cache/runtime/x64" "$APP/Contents/Resources/runtime/"
for runtime in "$APP/Contents/Resources/runtime/arm64/node" "$APP/Contents/Resources/runtime/x64/node"; do
  /usr/bin/codesign --force --sign - --preserve-metadata=entitlements "$runtime"
done
/usr/bin/xcrun swift "$PROJECT_ROOT/scripts/make-icon.swift" "$PROJECT_ROOT/.cache/icons"
python3 - "$PROJECT_ROOT" <<'PYICON'
from pathlib import Path
import shutil,sys
root=Path(sys.argv[1]); iconset=root/'.cache/AppIcon.iconset';iconset.mkdir(exist_ok=True)
for base in [16,32,128,256,512]:
 for factor in [1,2]:shutil.copy2(root/f'.cache/icons/{base*factor}.png',iconset/f'icon_{base}x{base}{"@2x" if factor==2 else ""}.png')
PYICON
/usr/bin/iconutil -c icns "$PROJECT_ROOT/.cache/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
ARCH="${FOCUS_BUILD_ARCH:-$(uname -m)}"
if [[ "$ARCH" != arm64 && "$ARCH" != x86_64 && "$ARCH" != universal ]]; then
  print -u2 'FOCUS_BUILD_ARCH 仅支持 arm64、x86_64 或 universal。'; exit 1
fi
compile() {
  /usr/bin/xcrun swiftc -swift-version 5 -O -file-prefix-map "$PROJECT_ROOT"=. -target "$1-apple-macosx14.0" \
    -framework AppKit -framework WebKit -framework EventKit -framework Network -framework Security \
    "$PROJECT_ROOT"/Sources/*.swift -o "$2"
}
if [[ "$ARCH" == universal ]]; then
  BUILD_TEMP="$(mktemp -d)"
  trap 'rm -rf "$BUILD_TEMP"' EXIT
  compile arm64 "$BUILD_TEMP/arm64"
  compile x86_64 "$BUILD_TEMP/x86_64"
  /usr/bin/lipo -create "$BUILD_TEMP/arm64" "$BUILD_TEMP/x86_64" -output "$APP/Contents/MacOS/StarMiniScreen"
else
  compile "$ARCH" "$APP/Contents/MacOS/StarMiniScreen"
fi
/usr/bin/codesign --force --sign - "$APP" >/dev/null
/usr/bin/codesign --verify --deep --strict "$APP"
print "构建完成：$APP"
