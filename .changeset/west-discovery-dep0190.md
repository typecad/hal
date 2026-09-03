---
'@typecad/framework-zephyr': patch
---

## West discovery: no DEP0190 on Windows

Every `cuttlefish build --compile --upload` printed Node's DEP0190
deprecation warning on Windows:

```
(node:…) [DEP0190] DeprecationWarning: Passing args to a child process
with shell option true can lead to security vulnerabilities…
```

West discovery spawned `where west` (and probed each `west --version`
candidate) with both an args array and `shell: IS_WIN` — the exact
combination DEP0190 flags, since the shell concatenates args unescaped.
The 1.0.0-alpha.12 pass had already dropped the shell on Linux/macOS but
kept it on Windows on the assumption that `where.exe` needs cmd.exe to
resolve. It doesn't: `where` is a plain PE executable that Node resolves
from PATH, and this module already spawns venv `python.exe` launchers
shell-less the same way (as does `westSpawn` for launcher-mode installs).

Both discovery spawns are now shell-less on every platform. Discovery
behavior is unchanged — the cascade still resolves the same installs
(PATH → `$ZEPHYR_BASE` venv → micromamba → well-known → system Python);
a regression test now fails if a shell is ever reintroduced into the
`where`/`which` probe.
