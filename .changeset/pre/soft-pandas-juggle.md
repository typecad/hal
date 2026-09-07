---
'@typecad/framework-zephyr': patch
---

zephyr: the deterministic openocd probe session now runs on Linux too. Its binary discovery previously checked only the Zephyr-SDK layout (`<sdk>/hosttools/openocd/bin`), so setups where openocd comes from `$OPENOCD` or PATH (a micromamba-env openocd is the common Linux case — the same binary west's own runner spawns) silently skipped the session and dropped every flash to the racy `west flash` fallback. Resolution now mirrors west: `$OPENOCD` → SDK-hosted (with its script search dirs) → PATH. Additionally, a failed openocd flash whose output carries a known target-ignored-SWD signature ("unable to connect to the target" — the DPIDR read never succeeded — or "timed out while waiting for target halted" / "Not halted") now prints a recovery pointer: power-cycle the board, replug the probe, or skip SWD entirely with `--probe dfu`. Those signatures usually mean marginal wiring, a low-power/locked core, or a wedged probe — not a toolchain bug.
