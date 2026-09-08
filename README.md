# `@typecad/hal`

**Write firmware in TypeScript. Ship it as C++.**

`@typecad/hal` is typeCAD's firmware toolkit: a hardware API you author
against in ordinary TypeScript, and a build toolchain that turns that
TypeScript into efficient C++ for real microcontrollers — Zephyr RTOS boards
and desktop native targets.

## Why

Embedded development has a feedback-loop problem. You write C++, flash it to
a board, and only then discover you used the wrong pin, forgot to set up a
bus, or claimed a pin twice. Every mistake costs a compile-flash-test cycle,
and the serial monitor is where errors go to be found late.

typeCAD/hal moves those checks into your editor:

- **Every pin has a narrow type that reflects what it can actually do on
  your board.** Try PWM on a pin with no PWM route and you get a red
  squiggle immediately — not a silent no-op on hardware.
- **Peripherals carry their setup in construction.** There is no `begin()`
  to forget: building a bus device configures it, and the board wiring is
  generated from your code.
- **It reads like TypeScript because it is.** Classes, enums, threads,
  destructuring — all lowered to clean C++ with zero-cost abstractions.

## Quick start

Requires Node.js 22+. One command scaffolds a project wired to your board:

```bash
npx @typecad/hal create my-firmware
```

Pick your board (or plug one in and let it find it), then:

```bash
cd my-firmware
npm run compile    # TypeScript → C++ → firmware image
npm run upload     # flash it to the board
```

The first embedded project also sets up the Zephyr SDK toolchain — the CLI
checks for it and gives you the one command to install it.

Your starter program is already blinking:

```ts
import { LED } from '@typecad/hal';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(500);
}
```

## What you get

- **The full peripheral vocabulary, typed and board-aware** — GPIO, PWM,
  ADC/DAC, I2C, SPI, UART, USB, watchdogs, threads, timers, persistent
  storage, and sensors.
- **1,300+ boards out of the box** — the ESP32 family, RP2040/RP2350
  (Pico), STM32, nRF52, SAMD, and the rest of the Zephyr board catalog,
  each with datasheet-named pins (`PB5`, `GPIO4`, `P0.28`) and friendly
  aliases (`LED`, `BUTTON`).
- **Wi-Fi, HTTP, MQTT, and BLE** as ordinary TypeScript objects.
- **Tests that run on the actual board** — write `describe` / `it` /
  `expect` tests in `tests/`, run `npm run test:hw`, and watch vitest-style
  results reported live over the serial console. No mocks.
- **A simulator** for iterating on firmware logic with no hardware
  attached (`npm run simulate`).

## Displays, too

Pair it with [`@typecad/ui`](https://www.npmjs.com/package/@typecad/ui) to
build hardware interfaces in HTML and CSS — compiled to C++ that renders
directly on SPI TFT and OLED displays.

## Learn more

- [typecad.dev](https://typecad.dev) — documentation and guides
- [GitHub](https://github.com/justind000/typecode) — source, demos, and the
  project's own on-metal test suite
- `typecad-hal --help` — every command

## License

Apache-2.0
