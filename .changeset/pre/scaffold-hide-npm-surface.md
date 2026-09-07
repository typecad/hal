---
"@typecad/cuttlefish": minor
---

## VS Code: the NPM Scripts pane works on the project's scripts; only the bundled extensions stay hidden

`cuttlefish create` bundles two grammar-only editor extensions (`.ui` highlighting + TypeCAD Debug) into `.vscode/extensions/`, each with its own `package.json`. VS Code's npm support picked those up as extra npm packages in the project — and an earlier version of this feature answered that by writing `npm.autoDetect: off`, which blanks the NPM Scripts pane entirely ("the setting npm.autoDetect is off" — no way to run build/upload from the Explorer).

The scaffold now writes settings that keep the pane working on the project's own scripts while hiding only the extension internals:

- `npm.autoDetect: on` — explicit, so it also heals settings.json files written by the older scaffold (`off`);
- `npm.exclude: **/.vscode/extensions/**/package.json` — the extensions' manifests no longer register as npm packages, and the project's root `package.json` stays fully visible to npm tooling;
- `files.exclude` / `search.exclude` for `.vscode/extensions` — internal scaffolding, hidden from the Explorer and search;
- `debug.javascript.codelens.npmScripts: never` — no "Debug" codelenses over script entries (the package.json is build tooling, not a web app).

`npm install` / `npm run compile` keep working from the terminal. The write merges into any existing `.vscode/settings.json` (e.g. the Zephyr debug writer's cortex-debug paths; nested `files.exclude` maps merge key-by-key instead of clobbering), and dev workspaces such as the monorepo itself are unaffected — the settings are only applied to scaffolded end-user projects.
