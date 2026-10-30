#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h:h}"
TEST_TEMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TEMP"' EXIT
/usr/bin/xcrun swiftc -swift-version 5 "$PROJECT_ROOT/Sources/State.swift" "$PROJECT_ROOT/Sources/MeetingSelection.swift" "$PROJECT_ROOT/tests/StateTests.swift" -o "$TEST_TEMP/state-tests"
"$TEST_TEMP/state-tests"
if command -v python3 >/dev/null; then
  python3 "$PROJECT_ROOT/tests/test_integration.py"
else
  print -u2 '原生状态测试通过。完整 HTTP 集成测试额外需要 Python 3（仅测试需要）。'
  exit 1
fi
