#!/bin/zsh -l
set -euo pipefail
PROJECT_ROOT="${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print -u2 '需要 Node.js 18 或更新版本来运行副屏页面。'
  exit 1
fi
if ! command -v lark-cli >/dev/null 2>&1 && [[ -z "${FOCUS_FEISHU_CLI:-}" ]]; then
  print -u2 '未找到 lark-cli；工作模式暂时无法同步飞书待办，日常模式仍可使用。'
fi
exec node "$PROJECT_ROOT/integrations/feishu-preview.mjs" --open
