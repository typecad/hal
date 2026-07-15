# `@typecad/hal`

Hardware abstraction layer for [TypeCAD](https://cuttlefish.typecad.net) —
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

## Hardware tests

The [`tests/`](./tests/) directory contains a hardware test suite that
exercises every AVR-compilable HAL subsystem against real Arduino Uno hardware,
using [`@typecad/expect`](https://cuttlefish.typecad.net)
(`describe()` / `.it()` / `.expect()` / `done()`) over serial. Each file covers
one subsystem: GPIO, timing, math, random, pulse, shift, interrupts, UART,
I2C, SPI, ADC, EEPROM, WDT, Preferences, async, and constants.

ESP32-only subsystems (DAC, `FS`, `Power`, `HardwareTimer`) are intentionally
omitted — they require an ESP32 target.

Run on a connected Uno:

```bash
npm exec --workspace @typecad/hal -- cuttlefish-test
```

The suite is configured by [`cuttlefish.config.ts`](./cuttlefish.config.ts).
Like the [`@typecad/framework-arduino`](https://cuttlefish.typecad.net)
tests, it imports through `@typecad/board` (the board package) and ambient globals
declared in `cuttlefish-env.d.ts`, never directly from `@typecad/board`, so the
transpiler resolves each call against the active MCU/board packages.

### Skipped on AVR

One file is skipped on AVR by a `@typecad-skip-target` directive, for a
genuine hardware reason (not a transpiler limitation):

- **`08-uart`** — the Uno has a single hardware UART, which the test runner
  itself uses as the `[TC:...]` protocol channel. Any `UART0` call disrupts
  that channel. Runs on multi-UART targets (ESP32).

The async test (`15-async`) **runs on AVR**: on heap-less targets the
transpiler emits a fixed-capacity, allocation-free static timer/task runtime
(`async-runtime-static.ts`) in place of the full `Promise<T>` runtime used on
ESP32, so `Async.sleep`/`yield`/`sleepUntil`/`currentTask` link and run on the
ATmega328P.

ESP32-only subsystems (DAC, `FS`, `Power`, `HardwareTimer`) are omitted
entirely — they require an ESP32 target.

## Ecosystem

- [`@typecad/cuttlefish`](https://cuttlefish.typecad.net) — the transpiler that resolves HAL calls to C++.
- [`@typecad/ui`](https://cuttlefish.typecad.net) — HTML/CSS-driven display graphics.
- `@typecad/mcu-*` — silicon pin/port/peripheral definitions.
- `@typecad/board-*` — board-level pin mappings and bus aliases.

## License

MIT
