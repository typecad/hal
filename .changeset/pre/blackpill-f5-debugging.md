---
"@typecad/framework-zephyr": minor
---

## F5 debugging for the STM32 Black Pill

`blackpill_f411ce*` targets now select native GDB debugging (`debugMode`
previously granted it only to ESP32-S3 boards, so `cuttlefish create`
silently skipped the F5 launch config and VS Code asked for a debug profile
instead). The Black Pill's ST-Link probe method ships in its board package —
openocd runner over SWD with the `reset_config none` quirk for the unwired
SRST line — and the generated artifacts now use it: a cortex-debug attach
config, a build+flash preLaunch task, and a probe-method-driven
`.cuttlefish/openocd.cfg`.

The SDK GDB resolver is also architecture-aware now: ARM boards resolve
`arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb` from the Zephyr SDK (from the
build's CMakeCache or the discovered SDK roots) instead of the hardcoded
ESP32-S3 Xtensa path, so the starter `launch.json` carries a working
`gdbPath` on first open. `npm run sync:typecad-ui` additionally regenerates
debug artifacts for the monorepo's demos, healing hand-assembled ones that
never went through `cuttlefish create`.
