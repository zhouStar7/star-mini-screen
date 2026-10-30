#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h:h}"
APP="$PROJECT_ROOT/build/Star Mini Screen.app"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
DIST="$PROJECT_ROOT/dist"
STAGE="$PROJECT_ROOT/.cache/dmg-stage"
mkdir -p "$DIST"
rm -rf "$STAGE"
mkdir -p "$STAGE"
/usr/bin/codesign --verify --deep --strict "$APP"
/usr/bin/ditto "$APP" "$STAGE/Star Mini Screen.app"
/bin/ln -s /Applications "$STAGE/Applications"
cp "$PROJECT_ROOT/LICENSE" "$STAGE/LICENSE.txt"
cat > "$STAGE/安装说明.txt" <<'TXT'
将 Star Mini Screen.app 拖到 Applications，然后从应用程序打开。
无需安装 Node.js。天气和飞书仍需使用者自己的系统授权／登录。
当前包为临时签名，尚未 Apple Developer ID 签名和公证。
首次被拦截时，核对来源后到系统设置 → 隐私与安全性 → 仍要打开。
不要关闭系统安全保护。
TXT
/usr/bin/hdiutil create -ov -volname 'Star Mini Screen' -fs HFS+ -format UDZO -srcfolder "$STAGE" "$DIST/Star-Mini-Screen-$VERSION-universal.dmg"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$DIST/Star-Mini-Screen-$VERSION-universal.zip"
(cd "$DIST" && /usr/bin/shasum -a 256 "Star-Mini-Screen-$VERSION-universal.dmg" "Star-Mini-Screen-$VERSION-universal.zip" > SHA256SUMS.txt)
print "安装包：$DIST"
