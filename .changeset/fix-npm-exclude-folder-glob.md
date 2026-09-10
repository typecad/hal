---
"@typecad/cuttlefish": patch
---

fix(create): hide the bundled VS Code extension manifests from the NPM Scripts view. `npm.exclude` must be a folder glob — VS Code minimatch's the package.json's PARENT DIRECTORY against the pattern, so the old `**/.vscode/extensions/**/package.json` value never matched and the typecad-ui/typecad-debug manifests leaked into the pane alongside the project's own scripts. Existing projects: change the value to `**/.vscode/extensions/**` by hand (settings are written at create time only).
