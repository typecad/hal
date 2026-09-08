---
'@typecad/cuttlefish': minor
'@typecad/hal': minor
'@typecad/framework-zephyr': minor
---

The user-visible rename: `cuttlefish` → `typecad-hal` everywhere a user
looks. Generated C++ (`CUTTLEFISH_*` macros, the `cuttlefish,` devicetree
compatible, `cuttlefish-gfx`, user-facts markers) keeps the engine codename
by design; the `@typecad/cuttlefish` engine package keeps its name (it
appears only in lockfiles now).

- The single binary is `typecad-hal`, hosted on `@typecad/hal`
  (`npx @typecad/hal create`); the engine ships no bins. Hardware tests run
  via `typecad-hal test`.
- Project artifacts rename cleanly: `typecad-hal.config.ts`,
  `typecad-hal-env.d.ts`, `typecad-hal.facts.json`, `.typecad-hal/`,
  `typecad-hal.library.json`, `TYPECAD_HAL_*` env vars. Configs import
  `TypecadConfig` from `@typecad/hal/config`; the `@typecad/board` legacy
  alias is removed.
- CLI banner/help, editor task labels + problem-matcher owners, the debug
  extension's activation trigger, the library npm marker keyword
  (`typecad-hal-library`), the SDL window title, USB descriptors, and
  sidecar tool ids all drop the codename. The machine-local board catalog
  migrates from `.cuttlefish/` by copy (no rebuild race).
- West builds spawned through a PATH/venv west now pin
  `ZEPHYR_SDK_INSTALL_DIR` to the installer's SDK — Zephyr's CMake can no
  longer latch onto a stray older SDK in `$HOME` and fail at configure time
  (found on hardware: ST-Link + blackpill, SDK 1.0.1 pinned vs a stray
  0.17.4).
