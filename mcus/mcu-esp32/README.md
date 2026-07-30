# @typecad/mcu-esp32

MCU definition package for the **ESP32** (ESP32-WROOM-32, dual-core Xtensa LX6 @ 240 MHz). Provides datasheet-level pin definitions, hardware peripheral descriptions, and HAL instances used by the TypeCAD transpiler and board packages.

## Purpose

MCU packages are the silicon layer — they define what pins exist on the chip and what peripherals are built into the silicon, independent of any board or framework. Board packages (e.g. [`@typecad/board-esp32-devkit`](../board-esp32-devkit)) import from here and add board-specific aliases.

## What's inside

- **`src/pins.ts`** — One `Pin.fromPort()` export per GPIO: `GPIO0`–`GPIO39`
- **`src/peripherals.ts`** — Hardware peripheral descriptions (I2C, SPI, UART, ADC, timers, PWM) and auto-generated HAL instances (`I2C0`, `SPI0`, `UART0`, `ADC`)
- **`src/mcu.ts`** — `MCU_PERIPHERALS` manifest consumed by board packages

## ESP32 peripheral summary

| Peripheral | Count | Notes |
|---|---|---|
| **UART** | 3 | USART0–2 |
| **I2C** | 2 | I2C0–1 (GPIO matrix — flexible pin mapping) |
| **SPI** | 4 | SPI0–3 (SPI0/1 used for flash, SPI2/3 for general-purpose) |
| **ADC** | 2 | ADC1 (8 channels), ADC2 (10 channels), 12-bit |
| **Timers** | 4 | 64-bit general-purpose timers |
| **PWM (LEDC)** | 16 channels | 8 high-speed + 8 low-speed |
| **Touch sensors** | 10 | Capacitive touch on specific GPIOs |

## How board packages use this

```typescript
// In @typecad/board-esp32-devkit
export * from '@typecad/mcu-esp32';     // silicon pins + peripherals
export * from '@typecad/hal';           // HAL utilities (delay, Pin, etc.)
```

## Related packages

- [`@typecad/board-esp32-devkit`](../board-esp32-devkit) — board package using this MCU
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/mcu-atmega328p`](../mcu-atmega328p) — example of a fully-documented MCU package

## License

MIT
