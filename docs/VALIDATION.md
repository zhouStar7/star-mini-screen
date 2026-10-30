# Release validation — v1.1.0

Date: 2026-10-30. Actual execution on Apple Silicon macOS; Intel is cross-compiled and packaged, not tested on physical Intel hardware.

Passed locally:

- Universal Swift application build for arm64 and x86_64; both official Node runtime archive SHA256 values verified before extraction; complete runtime licenses included.
- Strict recursive code-signature integrity check (ad-hoc signature; not Apple notarization).
- 12 Node tests covering task normalization and read-only bounds, authentication/Host/Origin policy, atomic private config, shortcut name restrictions, stdin EOF, failed-weather retries and native-window dispatch.
- Native state tests and four HTTP integration tests, including persistence, timer restart, calendar denial and invalid-origin/token handling.
- Three primary themes, both modes, 1024×600 / 1280×800 / 375×812 browser checks. Native system metrics were returned and rendered; fixture weather and disabled Feishu reading prevent private task data in screenshots.
- Standalone application launch with a restricted PATH containing no external Node. The child executable came from the application bundle; native WKWebView loaded the dashboard and the service returned actual memory/disk data.
- App termination also terminated its managed service; no orphan listener remained.
- DMG mounted read-only, application copied out to a different directory, signature checked and the standalone launch/metrics/shutdown test repeated successfully.
- Git source audit excluded local filesystem paths, personal config, credentials, development runtime archives and built binaries.

GitHub-hosted CI was unavailable during this release's validation. The workflow remains in the repository for future runs. The above results were performed locally and do not imply a successful hosted CI run.

Not verified: first-time Gatekeeper approval on another Mac, first-time user location/calendar prompts, physical Intel hardware, every supported macOS version, or Apple notarization. Weather and Feishu authorization are per-user optional setup and are never distributed with the release.
