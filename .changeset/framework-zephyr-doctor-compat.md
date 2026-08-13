---
"@typecad/framework-zephyr": minor
---

## Zephyr environment doctor + version compat / board-target normalization

- **`cuttlefish doctor` (Zephyr)** — verify the installed Zephyr RTOS is
  reachable and inside the framework's declared compat range, and preview how the
  configured board target resolves for that version. Exits 0 if the environment
  is OK, non-zero with a clear message otherwise. Mirrors framework-arduino's
  doctor shape (dispatched via the framework's `doctor` export).
- **`checkZephyrCompat()`** — compare the installed Zephyr version against
  `manifest.compat.zephyr` so an incompatible Zephyr fails fast with a clear
  message instead of a cryptic west/CMake board error.
- **`resolveBoardTarget()`** — normalize the board target for the installed
  Zephyr version. Zephyr 4.3+ rejects bare multi-core board names
  (`esp32s3_devkitc`) and requires a qualified target
  (`esp32s3_devkitc/esp32s3/procpu`); this rewrites stale configs at build time
  so users don't have to regenerate them after a Zephyr upgrade.
