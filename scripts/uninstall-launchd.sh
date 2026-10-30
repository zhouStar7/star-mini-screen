#!/bin/zsh
set -euo pipefail
/bin/launchctl bootout "gui/$(id -u)/local.starminiscreen.agent" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/local.starminiscreen.agent.plist"
print '已关闭登录自启。任务与计时数据仍保留。'
