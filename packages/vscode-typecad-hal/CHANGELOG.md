# Changelog

The extension is versioned by hand (published via vsce, not the changesets
flow — it is not an npm workspace member). Entries move under a version
heading when a build is cut.

## 0.4.0

### Multiroot interop with typeCAD/pcb (was `.changeset/vscode-hal-multiroot-interop.md`)

The extension learns to share a workspace with typeCAD/pcb instead of fighting it:

- The project root is resolved by content, never `workspaceFolders[0]`: the first workspace folder whose directory chain carries `typecad-hal.config.ts` wins (mirroring the engine's own walk-up config lookup), falling back to the first folder. Combined multi-root projects (hw/ + fw/) previously rooted on whichever folder happened to be first — the engine then couldn't see the fw-side config and the extension sat on a permanent "cuttlefish not found" alert.
- The root re-resolves when the workspace shape changes; config/facts watchers are workspace-scoped instead of pinned to the startup root.
- Activation is `workspaceContains:**/typecad-hal.config.ts` only (no `onLanguage:typescript`): the extension — and its status chip — stays out of non-typeCAD TypeScript workspaces. Palette commands still activate it implicitly.
- The status chip sits at priority 99, just right of typeCAD/pcb's (101), so the two keep a stable order instead of jostling with the same icon.
- Hovers, fact chips, and code lenses stop at the resolved root — hw/ files are the typeCAD/pcb extension's hover domain, and both used to stack on one identifier.
- Flash & Monitor / Run on Hardware run in a `typeCAD/hal` terminal pinned to the resolved root's cwd (was `TypeCAD`, defaulting to `workspaceFolders[0]`, where npx couldn't see the project's typecad-hal). Declaration generation execs with the same cwd.
- Diagnostics carry `source: typeCAD/hal` in the Problems panel (collection renamed from `typecad-intel`; command ids keep their historical prefixes).

### Diagnostics + trace panel cores (was `.changeset/vscode-diagnostics-trace-cores.md`)

The monorepo-tested halves of the editor's report and trace surfaces:

- **diagnostics-core.ts** maps `typecad-hal --diagnostics` artifacts to editor problems: peripheral conflicts anchor at their TypeScript source span (a double-claimed pin becomes a clickable jump-to-source — the one thing the CLI cannot do), build diagnostics at the entry file. A label-prefixed summary line resolves to the labeled construct's real line, not the label's own position. The module is vscode-free (pure data-in/data-out), tested in the monorepo like trace-core.
- **The report panel renders diagnostics.md itself**: the markdown report `--diagnostics` writes — tables, mermaid diagrams — is rendered in the webview instead of handing off to an external viewer; tree-shaking stays a report fact, never a problem.
- **mermaid is bundled locally** (`media/mermaid.min.js`): report diagrams render offline, with no CDN fetch from inside the webview.
- **trace-core.ts** is the trace panel's pure half — capture parsing, timeline math, and the dependency-free canvas webview page over a `trace.json` capture — kept in lockstep with cuttlefish's `src/trace/view.ts` (the same timeline math and canvas page).

These cores activate through the multiroot rework above: the Diagnostics commands generate the report through the shared typeCAD/hal terminal and map each fresh artifact into the Problems panel; the Trace commands capture, view, report, and insert the `zephyr.trace` record into the config.
