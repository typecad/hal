# @typecad/mcu-nrf52840

MCU definition package for the **Nordic nRF52840** (Arm Cortex-M4F). Provides
datasheet-level pin definitions, hardware peripheral descriptions, and HAL
instances used by the cuttlefish transpiler and board packages.

## Purpose

MCU packages are the silicon layer — they define what pins exist on the chip
and what peripherals are built into the silicon, independent of any board or
framework. Board packages (e.g.
[`@typecad/board-xiao-nrf52840`](../board-xiao-nrf52840)) import from here and
add board-specific aliases.

## What's inside

- **`src/pins.ts`** — one `Pin.fromPort()` export per pad, using the datasheet
  `P0.xx` / `P1.xx` port notation (`P0_02`, `P1_11`, …)
- **`src/peripherals.ts`** — hardware peripheral descriptions and
  auto-generated HAL instances
- **`src/index.ts`** — public exports

## Related packages

- [`@typecad/board-xiao-nrf52840`](../board-xiao-nrf52840) — board package
  using this MCU
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/mcu-esp32`](../mcu-esp32) — example of a fully-documented MCU
  package

## License

MIT
