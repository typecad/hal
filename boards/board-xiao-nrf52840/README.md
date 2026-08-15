# @typecad/board-xiao-nrf52840

Board definition package for the Seeed Studio XIAO nRF52840 in cuttlefish.

## Overview

`@typecad/board-xiao-nrf52840` exports the pins, aliases, and board metadata
the transpiler needs for board-aware transpilation on the XIAO nRF52840,
built on the [`@typecad/mcu-nrf52840`](../mcu-nrf52840) silicon definitions.

## What's inside

- **`src/pins.ts`** — board pin exports and silkscreen aliases (`D0`–`D10`,
  `LED`, bus convenience names)
- **`src/analog.ts`** — ADC channel definitions
- **`src/board.ts`** — board metadata (target, MCU, framework wiring)
- **`src/index.ts`** — public exports

## Related packages

- [`@typecad/mcu-nrf52840`](../mcu-nrf52840) — silicon definitions this board
  builds on
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/board-arduino-uno`](../board-arduino-uno) — example of a
  fully-documented board package

## License

MIT
