# Third-party notices

The app bundles official Node.js v24.21.0 executables for Darwin arm64 and x64. Downloads and SHA256 values are pinned in `runtime.lock.json` and verified by `scripts/fetch-runtime.py`.

Source: https://nodejs.org/dist/v24.21.0/ . Node.js is distributed under the MIT license with additional third-party notices. The complete official LICENSE from each archive is included beside its bundled executable at `Contents/Resources/runtime/<architecture>/LICENSE`. Those notices are part of the distributed application.

Apple system frameworks are used from macOS and are not redistributed. The optional Feishu CLI is installed and authorized separately by each user; it is not part of the app bundle. All project-specific source is under the repository MIT license.
