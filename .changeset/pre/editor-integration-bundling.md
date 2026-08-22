---
"@typecad/cuttlefish": minor
---

## Workspace editor tooling bundled into every project

`cuttlefish create` now scaffolds a zero-install VS Code setup into each new
project's `.vscode/`, so `.ui` files work on first open with no marketplace
installs to manage:

- **typecad-ui** — a grammar-only extension for `.ui` single-file components
  (TextMate grammar adapted from Svelte's, MIT-attributed): full highlighting
  of the TS `<script>`, CSS `<style>`, and markup streams including
  `on:click={...}` directives and `{expr}` interpolations, snippets for the
  common idioms (`screen`, `button`, `bind`, `signal`, `canvas`, `list`),
  explorer file icons (used when the active icon theme has no `.ui` mapping —
  the default Seti theme has none), word/indentation rules, and a markdown
  injection grammar so ` ```ui ` fenced blocks highlight in docs.
- **TypeCAD Debug** — the built breakpoint-debugging extension is bundled too,
  so F5 breakpoint commands work with zero install.
- **extensions.json** — carries `forceInstall` entries for both extensions;
  current VS Code builds prompt once on first open, and builds with the
  forceInstall feature (microsoft/vscode#299830) install silently.
- **tasks.json** — a `cuttlefish: watch build` task runs the project's
  `npm run dev` with `NO_COLOR=1` and parses the transpiler and ESLint gate
  diagnostic lines into Problems-panel squiggles, synced to the watch loop's
  pass boundaries. Written only when the project has a `dev` script, and
  merged by label so framework debug tasks and user edits survive.
- **.editorconfig** — consistent formatting across editors.

For existing projects and the monorepo itself, `npm run sync:typecad-ui`
refreshes every vendored copy (repo root + all demos) from
`packages/cuttlefish/assets/editor-extensions/`, which ships with the npm
package. The extension icon is regenerable via
`node scripts/render-typecad-ui-icon.mjs` (dependency-free SDF rasterizer).
