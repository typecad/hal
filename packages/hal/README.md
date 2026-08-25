# `@typecad/hal`

Hardware abstraction layer for [TypeCAD](https://cuttlefish.typecad.net) —
GPIO, I2C, SPI, UART, timers, ADC/DAC, WiFi/HTTP, and more, written as
regular TypeScript.

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
| **Networking** | `WiFi`, `WiFiClass`, `WiFiStatus`, `WiFiEncryption`, `Http`, `HttpClass`, `HttpRequest`, `HttpMethod` |
| **Timing** | `delay`, `millis`, `micros`, `delayMicroseconds`, `Timing`, `map`, `constrain` |
| **Pulse / Shift** | `pulseIn`, `shiftIn`, `shiftOut` |
| **Interrupts** | `attachInterrupt`, `detachInterrupt`, `noInterrupts`, `interrupts`, `InterruptMode` |
| **Timers** | `HardwareTimer`, `Timer0`, `Timer1`, `Timer2` |
| **Storage** | `Preferences` (NVS/ZMS/EEPROM-backed by target), `FS` |
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

The [`tests/`](./tests/) directory is the HAL hardware suite — the on-metal
proof that the HAL works. It runs via
[`@typecad/expect`](https://cuttlefish.typecad.net)
(`describe()` / `.it()` / `.expect()` / `done()`) over serial or USB CDC, and
is organized so one shared suite covers every board:

- **`tests/common/`** — board-agnostic groups, one file per subsystem:
  timing, math, random, pulse, shift, interrupts, UART, I2C, ADC, WDT,
  Preferences, async, and constants. They use bus singletons, `A0`, and
  ambient globals only.
- **`tests/board/`** — the board-level groups (GPIO, PWM/tone, SPI, LED).
  These import **role names** from the `@typecad/test-pins` virtual module
  (`GPIO_OUT`, `PWM_PIN`, `PWM_MAX_FREQ`, …); each board package's
  `test-pins.json` declares which of its pins fill each role, and the runner
  substitutes them before transpiling. A file skipped because a board lacks
  a role carries `// @typecad-requires-roles …`.
- **`tests/network/`** — on-hardware HTTP/MQTT/BLE client suites against a
  local host server (`npm run test:http` starts it; see
  [`tests/network/README.md`](./tests/network/README.md)).
- **`tests/wired/`** — opt-in loopback tier (jumper `gpioOut` → `gpioIn`);
  not part of the default runs. See the file header for wiring.

Each board has a config in [`boards/`](./boards/) selecting target, MCU,
framework, and console. Run the suite for a board from its board package:

```bash
npm run hal --workspace @typecad/board-arduino-uno
```

or directly with a config (add `--port COMx` to override the configured one):

```bash
npm exec --workspace @typecad/hal -- cuttlefish-test --config boards/blackpill.config.ts
```

**Port tracking is by USB identity, not COM numbers.** Every board package's
`test-pins.json` carries a `usb: { vid, pid }` block (Zephyr CDC boards use
per-board PIDs under the Zephyr test VID; bridge boards use the bridge
chip's ID), and each config's `test.usb` matches it — so a nightly test box
with several boards plugged in finds each board's console without tracking
COM/tty numbers, and re-finds it after every flash when the CDC port
re-enumerates under a new number. `--discover` prints the attached-port
table and marks the config's match.

Board-agnostic groups import through `@typecad/board` (the configured board
package) and ambient globals declared in `cuttlefish-env.d.ts`, never from a
concrete `@typecad/board-*` name, so the transpiler resolves each call
against the active MCU/board packages.

### Board parity and documented hardware limits

The suite aims for parity: every board runs every group its silicon can
support. Gaps are expressed as data (a missing `test-pins.json` role skips
the groups that need it) or a `@typecad-skip-target` directive, never as a
per-board test copy. The only remaining skips are hard hardware limits:

- **`08-uart` on AVR** (`@typecad-skip-target avr`): the ATmega328P has one
  hardware UART and it IS the `[TC:...]` protocol channel the runner reads —
  exercising it disrupts the protocol, and there is no second UART or USB
  console to move either side to. Every other target runs the group (the
  Picos synthesize a uart1 pinctrl group, the ESP32s declare the
  non-console controllers, the Black Pill's USB CDC console frees usart1).
- **`11-led` on the ESP32-C3/C6/S3 dev boards**: the onboard "LED" is a
  WS2812 addressable RGB — not a plain GPIO LED — so those board packages
  export no `led` role and the group skips. (The Black Pill, Uno, ESP32
  DevKitC, XIAO, and both Picos run it.)

Everything else — gpio, pwm/tone (incl. the PWM fact cross-checks), spi,
i2c, adc (both the pin-based and channel-numbered forms), uart, timing,
math, random, pulse, shift, interrupts, wdt, preferences, async, and the
constants group — compiles for all eight board configs (`cuttlefish-test
--dry-run`) and runs on metal via `npm run test:hw` / `npm run hal`.

Known single-channel constraint: the Picos' only DT-pinned PWM pad is GP25
(the onboard LED), so `pwm`/`pwmAlt` roles both point there and the pwm and
tone groups exercise it sequentially. Other pads would need per-pin pinctrl
synthesis beyond GP25's board-pinned group.

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
