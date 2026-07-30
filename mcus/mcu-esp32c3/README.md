# @typecad/mcu-esp32c3

MCU definition package for the **ESP32-C3** (single-core 32-bit RISC-V @ 160 MHz, Wi-Fi 4 + BLE 5). Provides datasheet-level pin definitions, hardware peripheral descriptions, and HAL instances used by the TypeCAD transpiler and board packages.

## Purpose

MCU packages are the silicon layer — they define what pins exist on the chip and what peripherals are built into the silicon, independent of any board or framework. Board packages (e.g. [`@typecad/board-esp32c3`](../board-esp32c3)) import from here and add board-specific aliases.

## What's inside

- **`src/pins.ts`** — One `Pin.fromPort()` export per GPIO: `GPIO0`–`GPIO21`
- **`src/peripherals.ts`** — Hardware peripheral descriptions (I2C, SPI, UART, ADC, timers, PWM) and auto-generated HAL instances (`I2C0`, `SPI0`, `UART0`, `ADC`)
- **`src/mcu.ts`** — `MCU_PERIPHERALS` manifest consumed by board packages

## ESP32-C3 peripheral summary

| Peripheral | Count | Notes |
|---|---|---|
| **UART** | 2 | USART0–1 |
| **I2C** | 1 | I2C0 (GPIO matrix) |
| **SPI** | 3 | SPI0–2 (SPI0/1 for flash, SPI2 general-purpose) |
| **ADC** | 2 | ADC1 (5 channels), ADC2 (1 channel), 12-bit |
| **Timers** | 4 | 52-bit general-purpose timers |
| **PWM (LEDC)** | 6 channels | 4 low-speed + 2 high-speed |

## How board packages use this

```typescript
// In @typecad/board-esp32c3
export * from '@typecad/mcu-esp32c3';   // silicon pins + peripherals
export * from '@typecad/hal';           // HAL utilities (delay, Pin, etc.)
```

## Related packages

- [`@typecad/board-esp32c3`](../board-esp32c3) — board package using this MCU
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/mcu-atmega328p`](../mcu-atmega328p) — example of a fully-documented MCU package

## License

MIT
