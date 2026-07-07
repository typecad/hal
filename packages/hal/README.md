# `@typecad/hal`

Hardware abstraction layer for [TypeCAD](https://github.com/justind000/typecode) —
GPIO, I2C, SPI, UART, timers, ADC/DAC, EEPROM, and more, written as regular
TypeScript.

`@typecad/hal` is what firmware code imports to talk to hardware. You write
normal TypeScript (`pin.high()`, `i2c.write(...)`, `Serial0.print(...)`); the
TypeCAD transpiler (`@typecad/cuttlefish`) resolves each HAL call against the
active MCU/board packages and emits the equivalent C++ at build time.

## Install

```bash
npm install @typecad/hal @typecad/cuttlefish
```

You'll also want an MCU package (e.g. `@typecad/mcu-esp32`) and a board package
(e.g. `@typecad/board-esp32-devkit`) to pin and bus definitions for your target.

## Overview

The HAL is built on three compile-time directives that look like ordinary
TypeScript but are intercepted by the transpiler:

- **`emit(text)`** — appends a line of C++ to the output (with parameter/field substitution).
- **`include(header)`** — adds a deduplicated `#include` to the output.
- **`board(path)`** — looks up a board-specific constant (e.g. pin numbers) inside an `emit()` template.

This means there are no runtime fallbacks: if the HAL doesn't `emit()` it, it
doesn't appear in the firmware. See [`HAL-GUIDE.md`](./HAL-GUIDE.md) for how to
add new HAL features.

## What's included

| Area | Exports |
| --- | --- |
| **Digital I/O** | `Pin`, `OutputPin`, `InputPin`, `PinMode`, `HIGH`, `LOW`, `INPUT`, `OUTPUT`, `INPUT_PULLUP` |
| **Pin groups** | `createPinGroup`, `IPinGroup`, `PinCapabilityFlags` |
| **Analog** | `ADC`, `ADCClass`, `DAC`, `DACClass`, `AnalogValue` |
| **I2C** | `I2CBus`, `II2CBus`, `I2CStatus`, `i2cName` |
| **SPI** | `SPIBus`, `ISPIBus`, `SPIStatus`, `SPISettings`, `spiName` |
| **UART / Serial** | `SerialPort`, `IUARTBus`, `UARTStatus`, `serialName` |
| **Timing** | `delay`, `millis`, `micros`, `delayMicroseconds`, `Timing`, `map`, `constrain` |
| **Pulse / Shift** | `pulseIn`, `shiftIn`, `shiftOut` |
| **Interrupts** | `attachInterrupt`, `detachInterrupt`, `noInterrupts`, `interrupts`, `InterruptMode` |
| **Timers** | `HardwareTimer`, `Timer0`, `Timer1`, `Timer2` |
| **Storage** | `EEPROM`, `Preferences` (NVFlash), `FS` |
| **Power / Watchdog** | `Power`, `WDT` (`WDTO_1S`, …) |
| **Math / Random** | `abs`, `min`, `max`, `Num`, `random`, `randomSeed` |
| **Async** | `Async` (cooperative scheduling) |
| **Directives** | `emit`, `include`, `board`, `callback` |

## Example

```ts
import { OutputPin, HIGH, LOW, delay } from '@typecad/hal';

const led = new OutputPin('LED_BUILTIN');

export function setup() {
  led.mode();
}

export function loop() {
  led.write(HIGH);
  delay(500);
  led.write(LOW);
  delay(500);
}
```

For I2C/SPI/UART, instantiate the bus class with the board's pinned instance
(see your `@typecad/board-*` package for available bus names).

## Ecosystem

- [`@typecad/cuttlefish`](https://github.com/justind000/typecode/tree/main/packages/cuttlefish) — the transpiler that resolves HAL calls to C++.
- [`@typecad/ui`](https://github.com/justind000/typecode/tree/main/packages/ui) — HTML/CSS-driven display graphics.
- `@typecad/mcu-*` — silicon pin/port/peripheral definitions.
- `@typecad/board-*` — board-level pin mappings and bus aliases.

## License

MIT
