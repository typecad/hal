---
'@typecad/cuttlefish': patch
---

Fix `typecad-hal create` skipping its dependency-install step on Windows.
The final `spawnSync('<pm>', ['install'])` launched the package manager
directly, but on Windows npm/pnpm/yarn are `.cmd` shims that spawnSync
cannot exec (ENOENT), so every scaffolded project shipped without
`node_modules` — the only trace was a one-line "Could not install
dependencies automatically" warning, after which the Vitest VS Code
extension flagged the scaffolded `vitest.config.ts` with "vitest not
found" and the user had to run `npm install` by hand. The install now
routes through `cmd.exe /d /s /c` on Windows, matching the pattern already
used by `library install` and the typecad-pcb create flow.
