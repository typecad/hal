# @typecad/board-rp2040

Board definition package for Raspberry Pi RP2040 boards in cuttlefish.

## Overview

`@typecad/board-rp2040` exports the pins, aliases, and board metadata the
transpiler needs for board-aware transpilation on the RP2040, built on the
[`@typecad/mcu-rp2040`](../mcu-rp2040) silicon definitions.

## What's inside

- **`src/pins.ts`** — board pin exports and silkscreen aliases
- **`src/analog.ts`** — ADC channel definitions
- **`src/board.ts`** — board metadata (target, MCU, framework wiring)
- **`src/index.ts`** — public exports

## Related packages

- [`@typecad/mcu-rp2040`](../mcu-rp2040) — silicon definitions this board
  builds on
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/board-arduino-uno`](../board-arduino-uno) — example of a
  fully-documented board package

## License

MIT
