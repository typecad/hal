# Expect Documentation

Hardware test runner for TypeCode. Write vitest-style assertions in TypeScript; the framework compiles them to firmware, uploads to your board, reads the results over serial, and reports pass/fail — all in one command.

```
 typecode-test v0.1.0

 ✓ A0 analog read (2 tests)
   ✓ reads a value in valid ADC range
   ✓ reads less than mid-scale when grounded

 ✓ A1 analog read (2 tests)
   ✓ returns a non-negative value
   ✓ is within 10-bit ADC range


 Tests   4 passed (4)
 Board   @typecode/board-arduino-uno @ COM4
 Time    18.97s

 PASS  All tests passed
```

## Documents

- [Writing Tests](./writing-tests.md) - Test syntax and matchers
- [CLI Reference](./cli-reference.md) - Command-line options

## How it works

1. **Preprocess** — an AST transform rewrites the fluent test syntax into `Serial.print()` calls.
2. **Transpile** — the typecode compiler converts the rewritten TypeScript to a C++ Arduino sketch.
3. **Compile** — `arduino-cli compile` builds the sketch for the target board.
4. **Upload** — `arduino-cli upload` flashes the firmware over serial.
5. **Capture** — the host reads structured protocol lines from the serial port.
6. **Evaluate** — assertion math runs on the host; the firmware only sends raw values.
7. **Report** — results are printed in vitest-style output.

## Installation

`@typecode/expect` is included in the TypeCode monorepo. No separate install step is needed within the workspace.

**Prerequisites:**

- [`arduino-cli`](https://arduino.github.io/arduino-cli/) installed and on `PATH`
- The target board core installed (`arduino-cli core install arduino:avr` for Uno)
- A USB serial port available

## Quick Start

```typescript
// examples/my-sensor.test.ts
import { describe, done } from '@typecode/expect';
import { A0 } from '@typecode';

describe("A0 analog read")
  .it("reads a value in valid ADC range")
    .expect(A0.read()).toBeWithinRange(0, 1023)
  .it("reads less than mid-scale when grounded")
    .expect(A0.read()).toBeLessThan(512);

done();
```

Run the test:

```bash
npx typecode-test examples/my-sensor.test.ts --port COM4
```

## Pipeline Overview

```
┌─────────────────┐
│  test file .ts  │  (user-authored TypeScript)
└────────┬────────┘
         │  AST preprocessor  (host, Node.js)
         ▼
┌─────────────────┐
│ rewritten .ts   │  (Serial.print calls, hoisted hardware vars)
└────────┬────────┘
         │  typecode transpiler
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

## Limitations

- **No arrow function callbacks** — the TypeCode transpiler does not support inline arrow functions as arguments. Groups and cases are defined by fluent chaining, not by `describe("name", () => { ... })`.
- **No async tests** — all timing is implicit (the board executes sequentially, the host waits on serial output).
- **Sequential execution only** — all describes in a file run once, in order, inside `setup()`. There is no `beforeEach`/`afterEach`.
- **One file per upload** — each test file produces one sketch and one upload cycle. Multiple test files run as separate upload+execute passes.
- **Number types only for hardware values** — the TypeCode type system maps all numeric hardware readings to `int`/`float`. String expectations are for software string variables, not raw hardware reads.