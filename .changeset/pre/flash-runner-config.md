---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

## Flash runner configuration: `zephyr.runnerArgs` + SDK openocd on PATH

The upload method is now fully config-driven:

- **`zephyr.runnerArgs`** (new) passes extra flags verbatim to `west flash`
  after the runner — anything the chosen runner's parser accepts. The
  common case is documented on the website: flashing a Black Pill over an
  ST-Link with `runner: 'openocd'` and
  `runnerArgs: ['--cmd-pre-init=reset_config none']` (most ST-Link setups
  leave the SRST line unwired; without the override openocd's `reset init`
  times out waiting for the target to halt). Threaded through the Zod
  schema, the config loader (which previously dropped unknown `zephyr`
  keys), and `buildFlashArgs`.
- **SDK openocd is on the flash PATH.** The west discovery reads the
  installer-written `TYPECAD_ZEPHYR_SDK_INSTALL_DIR` and prepends the SDK's
  `hosttools/openocd/bin` to the spawned west's PATH (honoring
  `$ZEPHYR_SDK_INSTALL_DIR` when an env is activated), so `openocd` SWD
  flashing works with no global install.

Verified on hardware: compile → openocd → ST-Link → flash → reset-to-run
against a Black Pill V2.0.
