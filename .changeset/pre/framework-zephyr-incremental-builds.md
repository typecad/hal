---
"@typecad/framework-zephyr": minor
---

## Incremental builds: stop deleting the build dir after every successful build

`cuttlefish build` used to nuke `build/` whenever a previous build existed, so
every build was a full pristine configure + recompile of every Zephyr library
object — minutes for the larger demos (demo-shadcn: ~280 ninja targets, 69s of
parallel compile wall time, redone on every build). The build dir is now reused:
a code-only edit recompiles the changed app translation units and re-links.

The nuke existed to dodge a Zephyr 4.3.99-dev regression
([zephyr#104757](https://github.com/zephyrproject-rtos/zephyr/issues/104757),
fixed upstream 2026-03-03 by the
[#104784](https://github.com/zephyrproject-rtos/zephyr/pull/104784) revert, in
v4.4+): after CMake re-runs from a `.config` change, `.ninja_deps` records an
`offsets.h -> offsets.c.obj -> offsets.h` cycle and every later ninja run fails
with `dependency cycle`. That bug only fires on a Kconfig/config change — never
on a plain source edit — so the build dir is now deleted only when the generated
`prj.conf`/`CMakeLists.txt` content actually changed, and a failed build whose
output carries the `dependency cycle` signature self-heals with one pristine
retry (covering any reconfigure path on pre-fix Zephyr snapshots). Board
switches need no special handling: `west build`'s default `--pristine=auto`
recreates the dir itself when `-b <board>` mismatches the cached board.

Also: the generated `CMakeLists.txt` now lists the emitted sources explicitly
via `target_sources` instead of `file(GLOB … CONFIGURE_DEPENDS …)` — the glob
put a `cmake.verify_globs` step in the ninja graph that spawned CMake to
re-check the glob on every build. The scaffold rewrites `CMakeLists.txt`
(unchanged bytes → no write) whenever the emitted file set changes.
