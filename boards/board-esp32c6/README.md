# @typecad/board-esp32c6

ESP32-C6 board definition package for TypeCAD.

## Overview

`@typecad/board-esp32c6` provides typed pins, peripherals, and board metadata for boards built on the ESP32-C6 (single-core 32-bit RISC-V @ 160 MHz, Wi-Fi 6 + BLE 5.3 + Thread/Zigbee). It re-exports silicon-level pin definitions from [`@typecad/mcu-esp32c6`](../mcu-esp32c6) and HAL utilities from [`@typecad/hal`](../hal).

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
board: '@typecad/board-esp32c6',
```

## What's inside

- **GPIO pins**: `GPIO0`–`GPIO27` (silicon pins from `@typecad/mcu-esp32c6`)
- **Peripheral instances**: `I2C0`, `SPI0`, `UART0`, `ADC`
- **HAL utilities** (re-exported from `@typecad/hal`): `delay`, `millis`, `Pin`, `I2CBus`, `SPIBus`, etc.
- **Board metadata**: `BoardDefinition` manifest with PWM/analog/interrupt pin capabilities and memory specs

Direct imports from `@typecad/board-esp32c6` are also supported when you want explicit board package references.

## Related packages

- [`@typecad/mcu-esp32c6`](../mcu-esp32c6) — silicon-level pin definitions for the ESP32-C6 chip
- [`@typecad/hal`](../hal) — hardware abstraction layer (GPIO, I2C, SPI, UART)

## License

MIT
