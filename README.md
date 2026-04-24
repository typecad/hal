<h1 align="center">TypeCode</h1>

<p align="center">
  <strong>Write firmware in TypeScript. Ship it as C++.</strong>
</p>

<p align="center">
  Type-safe, board-aware embedded development that catches hardware bugs<br>
  before you flash — not after a 30-second upload cycle.
</p>

---

## Why TypeCode?

Embedded firmware development has a feedback loop problem. You write C++, flash it to a board, and *then* discover you passed the wrong pin, forgot to initialize a bus, or used a pin that's already claimed by I2C. Every mistake costs a compile-flash-test cycle.

TypeCode moves those checks into your editor. You write TypeScript against typed hardware abstractions that know which pins support PWM, which pins are shared with SPI, and whether your I2C bus was initialized before you tried to read from it. If something's wrong, you see the red squiggle immediately — not a blank serial monitor thirty seconds later.

```typescript
import { LED, delay } from '@typecode';

const led = LED.asOutput();

while (true) {
  led.toggle();
  delay(1000);
}
```

That's a complete Arduino sketch. `LED.asOutput()` configures the pin mode and returns a type-narrowed handle. The transpiler emits `pinMode(13, OUTPUT)` and `digitalWrite(13, !digitalRead(13))` — no extra variables, no overhead.

## Catch hardware mistakes in your editor

Every pin has a narrow type that reflects what it can actually do on your board.

```typescript
import { D4, D9, A0 } from '@typecode';

D4.pwm(50);    // Error: D4 does not support PWM on Arduino Uno
D9.pwm(50);    // OK — D9 is a PWM pin

A0.high();     // Error: A0 is analog-only
A0.readAnalog(); // OK
```

The transpiler also detects conflicts between peripherals and GPIO:

```typescript
import { I2C0, A4 } from '@typecode';

I2C0.begin();
A4.output(HIGH); // Warning: A4 is claimed by I2C0
```

These are not linter hints. They're type errors and transpiler diagnostics rooted in your board's actual pinmux.

## Peripherals with state

Calling `.device()` on an uninitialized bus is a compile-time error.

```typescript
import { I2C0 } from '@typecode';

I2C0.device(0x76).readByte(0xFA); // Error: I2C0 has not been initialized
```

```typescript
import { I2C0 } from '@typecode';

I2C0.begin();
const who = I2C0.device(0x76).readByte(0xFA); // OK
```

SPI and UART follow the same pattern — the type system tracks initialization state so you can't forget `.begin()`.

## One command to flash

```bash
npx typecode sketch.ts --compile --upload --monitor --port COM4
```

Transpile, compile, upload, and open a serial monitor in a single invocation. Or use the individual flags — `--compile` only, `--compile --upload` only — whatever fits your workflow.

## Supported boards

| Board | Package | Architecture |
|---|---|---|
| Arduino Uno | `@typecode/board-arduino-uno` | AVR |
| Arduino Nano 33 IoT | `@typecode/board-arduino-nano33iot` | SAMD |
| ESP32 DevKit | `@typecode/board-esp32-devkit` | ESP32 |

Additional architectures are scaffolded and ready for board definitions: ESP32-S2, ESP32-S3, ESP32-C3, RP2040, STM32, nRF52.

## Configure once

```typescript
// typecode.config.ts
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board:  '@typecode/board-arduino-uno',
  fqbn:   'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

The transpiler auto-generates `typecode-env.d.ts` so your editor resolves the `@typecode` virtual import with full IntelliSense — no `tsconfig.json` changes needed.

## Zero-cost abstractions

TypeScript constructs that have no C++ equivalent are erased or inlined at transpile time:

- GPIO aliases (`const led = LED.asOutput()`) produce no C++ variables
- `Ref<T>` phantom types emit C++ `const`
- `Owned<T>` / `MutRef<T>` types are fully erased
- Enums, classes with private fields, destructuring, template literals, typed arrays — all lowered to valid C++ for an ATmega328P with 2KB RAM

## Rust-inspired bus ownership

```typescript
import { I2C0 } from '@typecode';

const bus = I2C0.take(); // exclusive claim

bus.device(0x76).readByte(0xFA);

bus.release(); // return to pool
```

On single-threaded Arduino, `take`/`release` are emitted as comments. On multi-threaded platforms like ESP32, they map to mutex acquisition. In both cases the transpiler validates correct usage — double-take and use-without-own are errors.

## Test on real hardware

```typescript
import { describe, it, expect } from '@typecode/expect';
import { A0 } from '@typecode';

describe('Analog input').it('reads within valid range', () => {
  expect(A0.readAnalog()).toBeWithinRange(0, 1023);
});
```

These tests run on the actual microcontroller over serial. The host-side runner reports pass/fail from real pin states and sensor readings — not mocks.

## Simulate without hardware

The in-memory simulator lets you develop and test firmware logic in Node.js before touching a board:

```typescript
import { createSimBoard } from '@typecode/simulator';

const board = createSimBoard();
// Mock I2C devices, inject serial data, verify bus traffic
```

Register simulated I2C/SPI devices, inject data, and assert on operation logs — all without a physical board connected.

## Debug in VS Code

Set breakpoints in your `.ts` source files. The transpiler injects serial instrumentation that reports variable values and lets you step through execution — directly from your TypeScript code.

## Source maps for embedded

C++ compiler errors map back to your TypeScript source:

```bash
npx typecode map-error out/sketch/sketch.ino.tscppmap.json --line 42 --column 5
```

You see the TypeScript file, line, and column — not the generated C++.

## Dead code elimination

Tree-shaking is on by default. Only code reachable from your entry points (`setup`/`loop` for Arduino, `main` for generic) makes it into the output. The transpiler reports what was removed.

---

## Quick start

```bash
npm install typecode @typecode/board-arduino-uno
```

Create `typecode.config.ts`:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board:  '@typecode/board-arduino-uno',
  fqbn:   'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

Write your sketch:

```typescript
import { LED, delay } from '@typecode';

const led = LED.asOutput();

while (true) {
  led.toggle();
  delay(1000);
}
```

Build and flash:

```bash
npx typecode sketch.ts --compile --upload --port COM4
```

---

## CLI reference

```bash
typecode <input.ts> [options]
typecode gen-libdefs <input.ts>
typecode map-error <mapFile> [options]
```

### Transpile options

| Flag | Default | Description |
|---|---|---|
| `--emit cpp\|split` | `split` | Output format; Arduino target always emits `.ino` |
| `--target arduino\|generic` | `generic` | Auto-set to `arduino` when `--compile`, `--upload`, or `--monitor` is used |
| `--outDir <path>` | input directory | Output directory for generated files |
| `--emit-maps true\|false` | `true` | Write `.tscppmap.json` source map sidecars |
| `--fqbn <package:arch:board>` | *(from config)* | FQBN override; required for `--compile` when no config exists |

### Build chain (each flag requires the previous)

| Flag | Requires | Description |
|---|---|---|
| `--compile` | `fqbn` | Run `arduino-cli compile` after transpilation |
| `--upload` | `--compile`, `--port` | Upload compiled sketch to the board |
| `--monitor` | `--port` | Open serial monitor after upload |
| `--port <port>` | — | Serial port, e.g. `COM4` or `/dev/ttyACM0` |
| `--baud <rate>` | — | Baud rate for `--monitor` (default: `9600`) |

### Tree-shaking options

| Flag | Description |
|---|---|
| `--no-tree-shake` | Disable dead code elimination |
| `--keep-unused-enums` | Keep all enums even if unreferenced |
| `--keep-unused-classes` | Keep all classes even if uninstantiated |
| `--keep-unused-types` | Keep all type aliases even if unused |
| `--keep-unused-variables` | Keep all top-level variables even if unreferenced |
| `--no-report-unused` | Suppress diagnostics for removed code |
| `--entry-point <name>` | Add a custom entry point (repeatable) |
