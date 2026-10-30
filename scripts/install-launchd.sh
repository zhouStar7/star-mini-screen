#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h:h}"
APP="${1:-$PROJECT_ROOT/build/Star Mini Screen.app}"
if [[ ! -x "$APP/Contents/MacOS/StarMiniScreen" ]]; then
  print -u2 '找不到已构建的应用。请先运行 scripts/build.sh。'; exit 1
fi
APP="${APP:A}"
if [[ "$APP" == *'/Documents/'* || "$APP" == *'/Downloads/'* || "$APP" == *'/Desktop/'* ]]; then
  print -u2 '请先把 Star Mini Screen.app 放入 ~/Applications，再用该应用的绝对路径作为脚本参数。登录启动需要稳定且不受文稿目录权限影响的位置。'
  exit 1
fi
"$APP/Contents/MacOS/StarMiniScreen" --write-launch-agent
PLIST="$HOME/Library/LaunchAgents/local.starminiscreen.agent.plist"
/usr/bin/plutil -lint "$PLIST"
# Bootstrap without kickstart: installation should not interrupt a running dashboard.
/bin/launchctl bootout "gui/$(id -u)/local.starminiscreen.agent" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$(id -u)" "$PLIST"
print '已启用登录自启。窗口位置由 macOS 记忆；可在设置中选择下次打开全屏。'
