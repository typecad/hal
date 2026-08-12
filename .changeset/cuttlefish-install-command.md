---
"@typecad/cuttlefish": minor
---

## New `cuttlefish install` command

Adds a `cuttlefish install [framework] [--board id] [--dry-run]` subcommand that
installs a `@typecad/framework-*` package into the current project. It asks
which board to target, narrows the framework choices to the ones compatible
with that board (arduino / zephyr / native), detects the package manager
(npm / yarn / pnpm) from the lockfile, and runs the install — or prints the
resolved command with `--dry-run` for CI / scripting. The init wizard's
"no framework found" error now points users at `cuttlefish install` instead of
a manual `npm i`.
