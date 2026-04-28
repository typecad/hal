# @typehal/expect

Hardware test runner for [TypeHAL](../../README.md). Write vitest-style assertions in TypeScript; the framework compiles them to firmware, uploads to your board, reads the results over serial, and reports pass/fail — all in one command.

```
 typehal-test v0.1.0

 ✓ A0 analog read (2 tests)
   ✓ reads a value in valid ADC range
   ✓ reads less than mid-scale when grounded

 ✓ A1 analog read (2 tests)
   ✓ returns a non-negative value
   ✓ is within 10-bit ADC range


 Tests   4 passed (4)
 Board   @typehal/board-arduino-uno @ COM4
 Time    18.97s

 PASS  All tests passed
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Writing tests](#writing-tests)
  - [describe / it](#describe--it)
  - [expect](#expect)
  - [done](#done)
  - [Numeric matchers](#numeric-matchers)
  - [String matchers](#string-matchers)
- [Running tests](#running-tests)
  - [CLI flags](#cli-flags)
  - [typehal.config.ts](#typehalconfigts)
- [Architecture](#architecture)
  - [Pipeline](#pipeline)
  - [Serial protocol](#serial-protocol)
  - [AST preprocessor](#ast-preprocessor)
- [Limitations](#limitations)

---

## How it works

1. **Preprocess** — an AST transform rewrites the fluent test syntax into `Serial.print()` calls.
2. **Transpile** — the typehal compiler converts the rewritten TypeScript to a C++ Arduino sketch.
3. **Compile** — `arduino-cli compile` builds the sketch for the target board.
4. **Upload** — `arduino-cli upload` flashes the firmware over serial.
5. **Capture** — the host reads structured protocol lines from the serial port.
6. **Evaluate** — assertion math runs on the host; the firmware only sends raw values.
7. **Report** — results are printed in vitest-style output.

---

## Installation

`@typehal/expect` is included in the TypeHAL monorepo. No separate install step is needed within the workspace.

**Prerequisites:**

- [`arduino-cli`](https://arduino.github.io/arduino-cli/) installed and on `PATH`
- The target board core installed (`arduino-cli core install arduino:avr` for Uno)
- A USB serial port available

---

## Writing tests

Test files follow a fluent chaining style. Unlike vitest, there are no callback functions — the TypeHAL transpiler does not support inline arrow function arguments.

```typescript
// examples/my-sensor.test.ts
import { describe, done } from '@typehal/expect';
import { A0 } from '@typehal';

describe("A0 analog read")
  .it("reads a value in valid ADC range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("reads less than mid-scale when grounded")
    .expect(A0.readAnalog()).toBeLessThan(512);

done();
```

### describe / it

`describe(name: string): Suite`

Opens a named test group. Returns a `Suite` that you chain `.it()` calls onto.

`suite.it(name: string): Suite`

Opens a named test case within the current group. Returns the same `Suite` for further chaining.

### expect

`suite.expect(value: number): Expectation`

Captures a hardware value to be asserted. The argument must be a TypeHAL hardware expression (e.g. `A0.readAnalog()`, `pin.read()`). The preprocessor hoists it to a local variable so it is evaluated exactly once.

`suite.expectString(value: string): StringExpectation`

Same as `expect`, for string-producing expressions.

### done

`done(): void`

Must be the **last statement** in every test file. Emits the `[TC:SUITE_END]` sentinel over serial and puts the firmware into an idle loop so the host runner knows collection is complete.

---

### Numeric matchers

All numeric matchers return the parent `Suite`, so you can continue the chain with `.it()`.

| Matcher | Passes when |
|---|---|
| `.toBe(n)` | `actual === n` |
| `.toBeGreaterThan(n)` | `actual > n` |
| `.toBeGreaterThanOrEqual(n)` | `actual >= n` |
| `.toBeLessThan(n)` | `actual < n` |
| `.toBeLessThanOrEqual(n)` | `actual <= n` |
| `.toBeCloseTo(n, precision)` | `\|actual − n\| < 10^(−precision)` |
| `.toBeWithinRange(min, max)` | `actual >= min && actual <= max` |
| `.toBeTruthy()` | `actual !== 0` |
| `.toBeFalsy()` | `actual === 0` |
| `.toNotBe(n)` | `actual !== n` |

### String matchers

| Matcher | Passes when |
|---|---|
| `.toBe(s)` | `actual === s` |
| `.toContain(sub)` | `actual` contains `sub` |
| `.toHaveLength(n)` | `actual.length === n` |
| `.toNotBe(s)` | `actual !== s` |

---

## Running tests

### CLI

```bash
# Run a specific file
node packages/expect/dist/host/cli.js examples/my-sensor.test.ts

# Run all test files matched by config include patterns
node packages/expect/dist/host/cli.js

# Override the port at run-time
node packages/expect/dist/host/cli.js --port /dev/ttyACM0 examples/my-sensor.test.ts
```

Or via the npm script defined in the root `package.json`:

```bash
npm run test:hw
npm run test:hw -- --port COM4
```

### CLI flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--port <port>` | `-p` | from config | Serial port (e.g. `COM4`, `/dev/ttyACM0`) |
| `--board <pkg>` | `-b` | from config | Board package name override |
| `--fqbn <fqbn>` | | from config | Fully Qualified Board Name override |
| `--baud <rate>` | | `115200` | Serial baud rate |
| `--timeout <ms>` | `-t` | `30000` | Serial read timeout in milliseconds |
| `--include <glob>` | `-i` | from config | Test file glob pattern (repeatable) |
| `--verbose` | `-v` | `false` | Show raw serial output and per-assertion detail |
| `--help` | `-h` | | Print help and exit |

### typehal.config.ts

Add a `test` section to your project's `typehal.config.ts` to avoid passing flags every time:

```typescript
// typehal.config.ts
import { defineConfig } from '@typehal/core';

export default defineConfig({
  board: '@typehal/board-arduino-uno',

  test: {
    port: 'COM4',           // serial port of the connected board
    baudRate: 115200,        // must match Serial.begin() in firmware
    timeout: 30000,          // ms to wait for SUITE_END before giving up
    include: [               // glob patterns for test discovery
      'examples/**/*.test.ts',
      'tests/hardware/**/*.test.ts',
    ],
  },
});
```

All `test` fields are optional and can be overridden by CLI flags.

### Uno showcase validation example

Use the stock-Uno showcase in [examples/23-transpiler-showcase.ts](../../examples/23-transpiler-showcase.ts) for manual serial confirmation, then run the companion hardware test in [examples/24-uno-validation.test.ts](../../examples/24-uno-validation.test.ts) for automated checks.

Example flow:

```bash
# 1. Compile and upload the serial-output showcase via the demo workspace
cd demo
npm run compile

# 2. Run the on-hardware expect test against the connected Uno
cd ..
npm run test:hw -- examples/24-uno-validation.test.ts --port COM4
```

This hybrid workflow is the recommended way to confirm that simple variables, arithmetic, arrays, enums, functions, GPIO, and analog input are behaving correctly on real Uno hardware.

---

## Architecture

### Pipeline

```
┌─────────────────┐
│  test file .ts  │  (user-authored TypeScript)
└────────┬────────┘
         │  AST preprocessor  (host, Node.js)
         ▼
┌─────────────────┐
│ rewritten .ts   │  (Serial.print calls, hoisted hardware vars)
└────────┬────────┘
         │  typehal transpiler
         ▼
┌─────────────────┐
│  .ino sketch    │  (Arduino C++)
└────────┬────────┘
         │  arduino-cli compile + upload
         ▼
┌─────────────────┐
│  running board  │
└────────┬────────┘
         │  serial port  (structured text lines)
         ▼
┌─────────────────┐
│  host parser    │  Node.js — builds result tree
└────────┬────────┘
         │  evaluator
         ▼
┌─────────────────┐
│  pass / fail    │  printed by reporter
└─────────────────┘
```

### Serial protocol

The firmware emits structured lines that the host runner filters from any other debug output:

```
[TC:SUITE_START]
[TC:DESCRIBE:A0 analog read]
[TC:IT:reads a value in valid ADC range]
[TC:EXPECT:toBeWithinRange:0,1023:487]
[TC:IT:reads less than mid-scale when grounded]
[TC:EXPECT:toBeLessThan:512:487]
[TC:SUITE_END]
```

All lines not beginning with `[TC:` are ignored, so `Serial.print()` debug statements in imported board libraries do not interfere with results.

**Assertion line format:** `[TC:EXPECT:<matcher>:<expected>:<actual>]`

- `expected` — the value(s) from the test source (e.g. `0,1023` for a range)
- `actual` — the raw value read from hardware

Assertion math (pass/fail, formatting) is computed entirely on the host, not in firmware.

### AST preprocessor

The TypeHAL transpiler cannot evaluate hardware calls (like `A0.readAnalog()`) when they are nested inside non-typehal function calls — they lose their structured IR and become plain text. The preprocessor solves this before transpilation:

1. Removes the `import { describe, done } from '@typehal/expect'` statement.
2. Emits a `Serial.initialize(...)` + `[TC:SUITE_START]` preamble once.
3. Walks the fluent chain `describe(...).it(...).expect(expr).matcher(args)`.
4. **Hoists** hardware expressions out of `.expect()` into a `const __tc_vN: number = expr;` declaration at the surrounding statement level.
5. Replaces the `.expect(...).matcher(...)` chain with the appropriate `Serial.print("[TC:EXPECT:...]")` calls.
6. Rewrites `done()` to `Serial.println("[TC:SUITE_END]") + while(true){delay(1000)}`.

The result is valid TypeHAL TypeScript with no nested hardware calls, ready for the standard transpiler.

---

## Limitations

- **No arrow function callbacks** — the TypeHAL transpiler does not support inline arrow functions as arguments. Groups and cases are defined by fluent chaining, not by `describe("name", () => { ... })`.
- **No async tests** — all timing is implicit (the board executes sequentially, the host waits on serial output).
- **Sequential execution only** — all describes in a file run once, in order, inside `setup()`. There is no `beforeEach`/`afterEach`.
- **One file per upload** — each test file produces one sketch and one upload cycle. Multiple test files run as separate upload+execute passes.
- **Number types only for hardware values** — the TypeHAL type system maps all numeric hardware readings to `int`/`float`. String expectations are for software string variables, not raw hardware reads.
