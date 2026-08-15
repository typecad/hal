# @typecad/mcu-rp2350

MCU definition package for the **Raspberry Pi RP2350** (dual Arm Cortex-M33).
Provides datasheet-level pin definitions, hardware peripheral descriptions,
and HAL instances used by the cuttlefish transpiler and board packages.

## Purpose

MCU packages are the silicon layer — they define what pins exist on the chip
and what peripherals are built into the silicon, independent of any board or
framework. Board packages (e.g. [`@typecad/board-rp2350`](../board-rp2350))
import from here and add board-specific aliases.

## What's inside

- **`src/pins.ts`** — one `Pin.fromPort()` export per pad (`GPIO0`, `GPIO1`, …)
- **`src/peripherals.ts`** — hardware peripheral descriptions and
  auto-generated HAL instances
- **`src/index.ts`** — public exports

## Related packages

- [`@typecad/board-rp2350`](../board-rp2350) — board package using this MCU
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/mcu-esp32`](../mcu-esp32) — example of a fully-documented MCU
  package

## License

MIT
