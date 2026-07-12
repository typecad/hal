# @typecad/expect

Hardware test runner for [TypeCAD](../../README.md). Write vitest-style assertions in TypeScript; the framework compiles them to firmware, uploads to your board, reads the results over serial, and reports pass/fail in one command.

```
 cuttlefish-test v0.1.0

 ✓ A0 analog read (2 tests)
   ✓ reads a value in valid ADC range
   ✓ reads less than mid-scale when grounded

 ✓ A1 analog read (2 tests)
   ✓ returns a non-negative value
   ✓ is within 10-bit ADC range


 Tests   4 passed (4)
 Board   @typecad/board-arduino-uno @ COM4
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
  - [cuttlefish.config.ts](#cuttlefishconfigts)
- [Architecture](#architecture)
  - [Pipeline](#pipeline)
  - [Serial protocol](#serial-protocol)
  - [AST preprocessor](#ast-preprocessor)
- [Limitations](#limitations)

---

## How it works

1. **Preprocess** — an AST transform rewrites the fluent test syntax into `Serial.print()` calls.
2. **Transpile** — Cuttlefish converts the rewritten TypeScript to a C++ Arduino sketch.
3. **Compile** — `arduino-cli compile` builds the sketch for the target board.
4. **Upload** — `arduino-cli upload` flashes the firmware over serial.
5. **Capture** — the host reads structured protocol lines from the serial port.
6. **Evaluate** — assertion math runs on the host; the firmware only sends raw values.
7. **Report** — results are printed in vitest-style output.

---

## Installation

```bash
npm install --save-dev @typecad/expect @typecad/cuttlefish
```

`@typecad/expect` ships the `cuttlefish-test` CLI. It pairs with [`@typecad/cuttlefish`](https://github.com/justind000/typecode/tree/main/packages/cuttlefish), which transpiles your TypeScript test files to C++ for upload to hardware.

**Prerequisites:**

- [`arduino-cli`](https://arduino.github.io/arduino-cli/) installed and on `PATH`
- The target board core installed (`arduino-cli core install arduino:avr` for Uno)
- A USB serial port available

---

## Writing tests

Test files follow a fluent chaining style. Expectations can use direct values or zero-argument functions/IIFEs that return the value to assert.

```typescript
// examples/my-sensor.test.ts
import { describe, done } from '@typecad/expect';
import { A0 } from '@typecad/board';

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

Captures a hardware value to be asserted. The argument must be a TypeCAD hardware expression (e.g. `A0.readAnalog()`, `pin.read()`) or a zero-argument function returning one. The preprocessor hoists hardware expressions so they are evaluated exactly once.

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
npx cuttlefish-test examples/my-sensor.test.ts

# Run all test files matched by config include patterns
npx cuttlefish-test

# Override the port at run-time
npx cuttlefish-test --port /dev/ttyACM0 examples/my-sensor.test.ts
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
| `--build-target <fqbn>` | | from config | Framework-specific build target / FQBN override |
| `--baud <rate>` | | `115200` | Serial baud rate |
| `--timeout <ms>` | `-t` | `30000` | Serial read timeout in milliseconds |
| `--include <glob>` | `-i` | from config | Test file glob pattern (repeatable) |
| `--exclude <glob>` | `-x` | from config | Test file glob pattern to skip (repeatable) |
| `--verbose` | `-v` | `false` | Show raw serial output and per-assertion detail |
| `--help` | `-h` | | Print help and exit |

### cuttlefish.config.ts

Add a `test` section to your project's `cuttlefish.config.ts` to avoid passing flags every time:

```typescript
// cuttlefish.config.ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  target: 'avr',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-arduino',
  frameworkData: {
    buildTarget: 'arduino:avr:uno',
  },

  test: {
    port: 'COM4',           // serial port of the connected board
    baudRate: 115200,        // must match Serial.begin() in firmware
    timeout: 30000,          // ms to wait for SUITE_END before giving up
    include: [               // glob patterns for test discovery
      'examples/**/*.test.ts',
      'tests/hardware/**/*.test.ts',
    ],
    exclude: [               // optional glob patterns to skip after discovery
      'tests/hardware/avr-only/**/*.test.ts',
    ],
  },
};

export default config;
```

All `test` fields are optional and can be overridden by CLI flags.

### Target-specific skips

Use a file-level comment when a test is valid only for some MCUs or framework targets. The runner checks these comments before preprocessing, compiling, or uploading.

```typescript
// @typecad-skip-target esp32: ESP32 does not expose the AVR watchdog API.
```

The inverse form skips every target except the listed ones:

```typescript
// @typecad-only-target avr,megaavr: uses AVR watchdog registers.
```

Targets are matched against `target`, the FQBN parts from `frameworkData.buildTarget` such as `esp32` in `esp32:esp32:esp32`, the full FQBN, and the board package name.

Skipped files are reported in the same style as Vitest:

```text
 ↓ tests/32-wdt.test.ts (skipped)

 Tests       1 skipped (1)
 Test Files  1 skipped (1)
 PASS All tests passed
```

Run with `--verbose` to print the skip reason from the directive.

### Uno showcase validation example

Use the stock-Uno showcase in [examples/23-transpiler-showcase.ts](../../examples/23-transpiler-showcase.ts) for manual serial confirmation, then run the companion hardware test in [examples/24-uno-validation.test.ts](../../examples/24-uno-validation.test.ts) for automated checks.

Example flow:

```bash
# 1. Compile and upload the serial-output showcase
npx cuttlefish src/23-transpiler-showcase.ts --compile --upload --port COM4

# 2. Run the on-hardware expect test against the connected Uno
npx cuttlefish-test examples/24-uno-validation.test.ts --port COM4
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
         │  Cuttlefish transpiler
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

The Cuttlefish transpiler cannot evaluate hardware calls (like `A0.readAnalog()`) when they are nested inside non-TypeCAD function calls — they lose their structured IR and become plain text. The preprocessor solves this before transpilation:

1. Removes the `import { describe, done } from '@typecad/expect'` statement.
2. Emits a `Serial.begin(...)` + `[TC:SUITE_START]` preamble once.
3. Walks the fluent chain `describe(...).it(...).expect(expr).matcher(args)`.
4. **Hoists** hardware expressions out of `.expect()` into a `const __tc_vN: number = expr;` declaration at the surrounding statement level.
5. Replaces the `.expect(...).matcher(...)` chain with the appropriate `Serial.print("[TC:EXPECT:...]")` calls.
6. Rewrites `done()` to `Serial.println("[TC:SUITE_END]") + while(true){delay(1000)}`.

The result is valid TypeCAD TypeScript with no nested hardware calls, ready for the standard transpiler.

---

## Limitations

- **No vitest-style callback suites** — groups and cases are defined by fluent chaining, not by `describe("name", () => { ... })`.
- **No async tests** — all timing is implicit (the board executes sequentially, the host waits on serial output).
- **Sequential execution only** — all describes in a file run once, in order, inside `setup()`. There is no `beforeEach`/`afterEach`.
- **One file per upload** — each test file produces one sketch and one upload cycle. Multiple test files run as separate upload+execute passes.
- **Number types only for hardware values** — TypeCAD maps numeric hardware readings to `int`/`float`. String expectations are for software string variables, not raw hardware reads.
