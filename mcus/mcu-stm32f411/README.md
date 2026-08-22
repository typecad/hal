# @typecad/mcu-stm32f411

MCU definition package for the **STMicroelectronics STM32F411** (Arm Cortex-M4F,
as used in the WeAct Black Pill V2.0 / STM32F411CEU6 module). Provides
datasheet-level pin definitions, hardware peripheral descriptions, and HAL
instances used by the cuttlefish transpiler and board packages.

## Purpose

MCU packages are the silicon layer — they define what pins exist on the chip
and what peripherals are built into the silicon, independent of any board or
framework. Board packages (e.g.
[`@typecad/board-blackpill-f411ce`](../board-blackpill-f411ce)) import from
here and add board-specific aliases.

## Pin numbering

Pins use port-block numbering matching the per-port Zephyr `gpioa`/`gpiob`/
`gpioc` controller split: `PA<bit>` → `bit`, `PB<bit>` → `16 + bit`,
`PC<bit>` → `32 + bit`. The bonded pin list matches the F411C 48-pin package
(PA0–PA15, PB0–PB10, PB12–PB15, PC13–PC15 — PB11 is not bonded; PH0/PH1 are
the oscillator pads).

## What's inside

- **`src/pins.ts`** — one `Pin.fromPort()` export per pad (`PA0`, `PB8`, `PC13`, …)
- **`src/peripherals.ts`** — hardware peripheral descriptions and
  auto-generated HAL instances
- **`src/index.ts`** — public exports

## Related packages

- [`@typecad/board-blackpill-f411ce`](../board-blackpill-f411ce) — board package using this MCU
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/mcu-rp2040`](../mcu-rp2040) — another fully-documented MCU package

## License

MIT
