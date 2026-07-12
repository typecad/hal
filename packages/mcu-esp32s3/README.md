# @typecad/mcu-esp32s3

MCU definition package for the **ESP32-S3** (dual-core Xtensa LX7 @ 240 MHz, Wi-Fi 4 + BLE 5, native USB-OTG). Provides datasheet-level pin definitions, hardware peripheral descriptions, and HAL instances used by the TypeCAD transpiler and board packages.

## Purpose

MCU packages are the silicon layer — they define what pins exist on the chip and what peripherals are built into the silicon, independent of any board or framework. Board packages (e.g. [`@typecad/board-esp32s3`](../board-esp32s3)) import from here and add board-specific aliases.

## What's inside

- **`src/pins.ts`** — One `Pin.fromPort()` export per GPIO: `GPIO0`–`GPIO48`
- **`src/peripherals.ts`** — Hardware peripheral descriptions (I2C, SPI, UART, ADC, timers, PWM) and auto-generated HAL instances (`I2C0`, `SPI0`, `UART0`, `ADC`)
- **`src/mcu.ts`** — `MCU_PERIPHERALS` manifest consumed by board packages

## ESP32-S3 peripheral summary

| Peripheral | Count | Notes |
|---|---|---|
| **UART** | 3 | USART0–2 |
| **I2C** | 2 | I2C0–1 (GPIO matrix) |
| **SPI** | 4 | SPI0–3 |
| **ADC** | 2 | ADC1 (10 channels), ADC2 (10 channels), 12-bit |
| **Timers** | 4 | 64-bit general-purpose timers |
| **PWM (LEDC)** | 8 channels | 4 high-speed + 4 low-speed |
| **USB-OTG** | 1 | Native USB 2.0 full-speed PHY |

## How board packages use this

```typescript
// In @typecad/board-esp32s3
export * from '@typecad/mcu-esp32s3';   // silicon pins + peripherals
export * from '@typecad/hal';           // HAL utilities (delay, Pin, etc.)
```

## Related packages

- [`@typecad/board-esp32s3`](../board-esp32s3) — board package using this MCU
- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/mcu-atmega328p`](../mcu-atmega328p) — example of a fully-documented MCU package

## License

MIT
