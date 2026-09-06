---
'@typecad/expect': patch
'@typecad/framework-zephyr': patch
---

Fixed: `npx cuttlefish-test` found zero test files when run from a nested suite directory.

`npm exec` resets the spawned command's working directory to the npm *local prefix* — the nearest ancestor with a `package.json`. From a hardware suite dir like `packages/framework-zephyr/hal/esp32s3` (which deliberately has no `package.json` of its own), that lands on the workspace package instead of the project under test, so the CLI's `process.cwd()`-based project root resolved the wrong directory and test discovery came back empty (which previously made a direct `node …/dist/host/cli.js` invocation the only working option). The CLI now resolves the project root through `INIT_CWD` — the directory npm records as the real invocation dir — falling back to `process.cwd()` when it's unset or missing.

The hardware runner (`hal/run.mjs`) repins `INIT_CWD` to the suite dir when spawning the CLI, so `npm run hal` on a board package (which sets `INIT_CWD` to the *board package* dir for the whole process tree) keeps resolving the suite it actually targets.
