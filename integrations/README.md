# Local service

Installed apps start this service automatically using the bundled Node.js runtime and a private, dynamically assigned loopback port. No separate terminal is required.

For frontend development, `node integrations/feishu-preview.mjs --open` serves the pages on127.0.0.1:18767. Weather and launchers work locally; real system metrics require the native app. `FOCUS_NATIVE_ORIGIN` can identify its local native API when running a development service.

Managed mode (`--managed --port 0`) emits one JSON readiness line. Its parent owns stdin; EOF shuts the service down. Tokens are generated at startup, are never logged, and all APIs require the token plus Host/Origin checks. The public root document permits top-level navigation from a file/chat link; API cross-site access stays blocked.

Read-only Feishu invocation is fixed to `lark-cli task +get-my-tasks --as user --complete=false --page-limit 20 --format json`. No arbitrary CLI arguments are accepted. Weather uses only `副屏天气`, `副屏天气 城市`, or bundled import name `Apple-Weather`. Commands without input always receive EOF so `shortcuts run` does not wait indefinitely.

Configuration and setup are documented in the root README and [weather guide](weather/README.md). Tests: `node --test integrations/*.test.mjs`.
