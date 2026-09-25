---
'@typecad/cuttlefish': patch
---

The bundled VS Code extension ships its offline mermaid bundle again. The staged copy under `assets/editor-extensions/typecad-hal/media/` is gitignored by design (the tracked source of record is `packages/vscode-typecad-hal/media/`), and npm's `files` whitelist packs it whenever it exists on disk — but registry publishes run from a fresh CI checkout where the ignored copy doesn't exist, so every `typecad-hal create` from the registry vendored an extension whose Diagnostics report panel couldn't render diagrams offline. The release workflow's publish command (`scripts/publish.mjs`) now runs `sync:typecad-ui` before `changeset publish`: the staged asset — mermaid included — is materialized from tracked source in CI, and any drift the sync leaves under the asset tree fails the release instead of shipping a stale extension. The duplicate `publish.yml` workflow (which raced release.yml's own publish on every merge) is gone.
