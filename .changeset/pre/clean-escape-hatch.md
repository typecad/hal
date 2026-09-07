---
'@typecad/cuttlefish': patch
---

`cuttlefish clean` (also scaffolded as `npm run clean`) — the escape hatch for build states a build cannot self-heal: a build dir wedged by an SDK or Zephyr-tree change, orphaned files from a toolchain upgrade, reclaiming the (hundreds of MB) Zephyr build tree, or CI's clean-slate build. It resolves the output dir exactly like build does (`--out-dir` flag > the config's `output.outDir` against the entry dir — so it follows outDir renames) and removes the whole generated tree; the next build regenerates everything, including the F5 debug profile via the plain-build self-heal. Guard rails: a directory is only removed when it carries the generated-dir marker the transpiler writes (or `--force` is passed), and directories containing the project root, the entry dir, or a cuttlefish.config.ts are refused outright — a misconfigured `outDir` can never take user files with it.
