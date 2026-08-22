# TypeCAD UI (.ui) Syntax

Syntax highlighting and editor support for cuttlefish `.ui` single-file
components. A `.ui` file interleaves three streams — TypeScript in `<script>`,
CSS in `<style>`, and Svelte-style markup (`on:click={handler}`,
`{expression}` interpolations) — and the grammar highlights all three by
embedding VS Code's builtin TypeScript, CSS, and HTML grammars.

Beyond the grammar, the extension statically contributes:

- **Snippets** for the `.ui` idioms (`screen`, `button`, `bind`, `signal`,
  `canvas`, `list`, …) — type the prefix and Tab.
- **Markdown injection** so ` ```ui ` fenced blocks highlight in docs.
- **File icons** for `.ui` files, shown when the active icon theme has no
  mapping (VS Code's default Seti theme has none).
- **Word/indentation rules** so `{expr}` and `on:click` select as one word and
  Enter indents inside tags and braces.

This is a grammar-only extension: no activation events, no code, no
dependencies beyond static contributions. It never runs anything.

## Why it lives here

`cuttlefish create` copies this folder into each new project's
`.vscode/extensions/typecad-ui/`. VS Code (1.89+, trusted workspaces) detects
workspace-bundled extensions and installs them scoped to that workspace — the
project carries its own highlighting with no marketplace install. The
scaffold also writes `.vscode/extensions.json` with a `forceInstall` entry so
current VS Code builds install it without a prompt once that feature ships.

## Attribution

The TextMate grammar and language configuration are adapted from the Svelte
team's work in [sveltejs/language-tools]
(https://github.com/sveltejs/language-tools) (`svelte-vscode/syntaxes/
svelte.tmLanguage.src.yaml` and `svelte-vscode/language-configuration.json`),
MIT licensed — see LICENSE. Adaptations: scopes renamed from `source.svelte`
to `source.typecad-ui`, Svelte built-in element patterns (`<svelte:*>`)
removed, folding markers adjusted for `<screen>` roots. The `.ui` format is a
Svelte-syntax subset, so the grammar is otherwise kept structurally identical
to stay close to upstream.

## Manual install (existing projects)

Copy this folder to `<project>/.vscode/extensions/typecad-ui/` and reload the
VS Code window. Commit it so collaborators get highlighting too.

## Regenerating the icon

`icon.png` is rendered by `scripts/render-typecad-ui-icon.mjs` at the repo
root (dependency-free SDF rasterizer). Re-run it after changing the design or
dimensions in that script.
