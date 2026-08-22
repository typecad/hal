# @typecad/board-blackpill-f411ce

Board definition package for the **WeAct Studio Black Pill V2.0**
(STM32F411CEU6 module — Arm Cortex-M4F). Zephyr RTOS target
(`blackpill_f411ce/stm32f411xe`).

## What's inside

- **`src/index.ts`** — board definition manifest (pins overlay, build target,
  `zephyr` chip data for @typecad/framework-zephyr)
- **`src/pins.ts`** — board aliases (`LED`, `BUTTON`, `A0`–`A9`, bus instances)
- **`src/analog.ts`** — analog reference constants
- **`src/board.ts`** — `Board` namespace (single-import convenience)

## Pin naming

The preferred form is the MCU port notation (`PA5`, `PB8`, `PC13`) — the name
the pin has on a schematic. Pin numbers use port-block numbering:
`PA<bit>` → `bit`, `PB<bit>` → `16 + bit`, `PC<bit>` → `32 + bit`.

## Flashing

The STM32F411 ships with a USB DFU bootloader in ROM: hold **BOOT0**, tap
**NRST**, release — then `west flash` (the board's default runner is
dfu-util). SWD debugging needs an external probe (ST-Link + openocd).

## Related packages

- [`@typecad/mcu-stm32f411`](../../mcus/mcu-stm32f411) — silicon definitions
- [`@typecad/framework-zephyr`](../../packages/framework-zephyr) — Zephyr lowering

## License

MIT
