# @typecad/board-esp32-devkit

ESP32 DevKit (WROOM-32) board definition package for TypeCAD.

## Overview

`@typecad/board-esp32-devkit` provides typed pins, peripherals, and board metadata for the standard ESP32 DevKit module (ESP32-WROOM-32 dual-core Xtensa LX6 @ 240 MHz, Wi-Fi + BLE). It re-exports the silicon-level pin definitions from [`@typecad/mcu-esp32`](../mcu-esp32) and the HAL utilities from [`@typecad/hal`](../hal) so a single import gives you everything.

## Quick start

```ts
import { GPIO2, delay } from '@typecad/board';

const led = GPIO2.asOutput(false);

while (true) {
  led.toggle();
  delay(1000);
}
```

Reference this board in `cuttlefish.config.ts`:

```ts
board: '@typecad/board-esp32-devkit',
```

## What's inside

- **GPIO pins**: `GPIO0`–`GPIO39` (silicon pins from `@typecad/mcu-esp32`)
- **Peripheral instances**: `I2C0`, `SPI0`, `UART0`, `ADC`
- **HAL utilities** (re-exported from `@typecad/hal`): `delay`, `millis`, `Pin`, `I2CBus`, `SPIBus`, etc.
- **Board metadata**: `BoardDefinition` manifest with PWM/analog/interrupt pin capabilities and memory specs

Direct imports from `@typecad/board-esp32-devkit` are also supported when you want explicit board package references.

## Related packages

- [`@typecad/mcu-esp32`](../mcu-esp32) — silicon-level pin definitions for the ESP32 chip
- [`@typecad/hal`](../hal) — hardware abstraction layer (GPIO, I2C, SPI, UART)

## License

MIT
