#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h}"
APP="$PROJECT_ROOT/build/Star Mini Screen.app"
ARCH="$(uname -m)"
if [[ ! -x "$APP/Contents/MacOS/StarMiniScreen" ]] || ! /usr/bin/lipo -verify_arch "$ARCH" "$APP/Contents/MacOS/StarMiniScreen" >/dev/null 2>&1; then
  "$PROJECT_ROOT/scripts/build.sh"
fi
/usr/bin/open "$APP"
