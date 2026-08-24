---
"@typecad/cuttlefish": minor
---

## Scaffolded projects no longer look like npm packages in VS Code

The scaffolded `package.json` is build tooling for an embedded project, but
VS Code's built-in npm support treated it as a web project: an NPM Scripts
explorer view, auto-detected npm tasks, and Debug codelenses over every
script. `cuttlefish create` now writes three workspace settings that hide
that surface (`npm.autoDetect: off`, `npm.exclude`, and
`debug.javascript.codelens.npmScripts: never`) while `npm install` /
`npm run compile` keep working from the terminal. The write merges into any
existing `.vscode/settings.json` (e.g. the Zephyr debug writer's
cortex-debug paths), and dev workspaces such as the monorepo itself are
unaffected — the setting is only applied to scaffolded end-user projects.
