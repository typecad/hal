# @typecad/board-rp2350

Board definition package for Raspberry Pi RP2350 boards in cuttlefish.

## Overview

`@typecad/board-rp2350` exports the pins, aliases, and board metadata the
transpiler needs for board-aware transpilation on the RP2350, built on the
[`@typecad/mcu-rp2350`](../mcu-rp2350) silicon definitions.

## What's inside

- **`src/pins.ts`** — board pin exports and silkscreen aliases
- **`src/analog.ts`** — ADC channel definitions
- **`src/board.ts`** — board metadata (target, MCU, framework wiring)
- **`src/index.ts`** — public exports

## Related packages

- [`@typecad/mcu-rp2350`](../mcu-rp2350) — silicon definitions this board
  builds on
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/board-arduino-uno`](../board-arduino-uno) — example of a
  fully-documented board package

## License

MIT
