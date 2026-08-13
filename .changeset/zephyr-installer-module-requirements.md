---
"@typecad/zephyr-installer": patch
---

## Install per-module Python requirements (esptool for ESP32, etc.)

After `requirements-base.txt`, the installer now also installs the
**build-relevant** module `requirements.txt` files — HAL `scripts/`/`zephyr/`
dirs (esptool for espressif, vendor flash/script tools for atmel/stm32/silabs/
etc.) and top-level lib codegen (nanopb, zcbor). It deliberately does NOT do a
recursive find of every `requirements.txt`, which would also pull
docs/test/harness/example requirements (mbedtls docs, openthread test harness,
cmsis tests, lvgl docs, tf-m tools) — heavy and conflict-prone.

Without this, board-specific tooling was missing from the env. For ESP32 the
post-link image step ran a stale **system** `esptool` (the env had none) which
rejected Zephyr's invocation:

```
esptool: error: unrecognized arguments: --flash-mode --flash-freq 80m --flash-size 8MB
```

The espressif HAL pins `esptool>=5.0.2` in its own `requirements.txt`; installing
the per-module requirements puts a matching `esptool` (5.x) in the env, where the
activated `Scripts/` shadows the system one. Each module requirements file is
installed warn-and-continue so one bad pin can't abort the whole install.

Board support itself is universal — `west update` fetches every module and the
SDK full bundle ships every cross-toolchain (arm, riscv, xtensa, …) — so rp2040,
samd, nrf, stm32, etc. build with just the base env; only a few modules add
Python tools (esptool), which this step covers.

Mirrored in `install.sh` and `install.ps1`; guarded by a regression test
asserting both target `modules/hal/` (not a recursive find).
