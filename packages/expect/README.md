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
 Board   blackpill_f411ce/stm32f411xe @ COM4
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

1. **Preprocess** — an AST transform rewrites the fluent test syntax into console `print()` calls.
2. **Transpile** — Cuttlefish converts the rewritten TypeScript to a C++ Zephyr program.
3. **Compile** — `west build` compiles the program for the target board.
4. **Upload** — `west flash` flashes the firmware over serial.
5. **Capture** — the host reads structured protocol lines from the serial port.
6. **Evaluate** — assertion math runs on the host; the firmware only sends raw values.
7. **Report** — results are printed in vitest-style output.

---

## Installation

```bash
npm install --save-dev @typecad/expect @typecad/cuttlefish
```

`@typecad/expect` ships the `cuttlefish-test` CLI. It pairs with [`@typecad/cuttlefish`](https://cuttlefish.typecad.net), which transpiles your TypeScript test files to C++ for upload to hardware.

**Prerequisites:**

- A Zephyr build environment — install it with the bundled installer:
  `npx --package @typecad/framework-zephyr zephyr-installer`
- A project `cuttlefish.config.ts` naming a board target
  (`board: 'blackpill_f411ce/stm32f411xe'`) and `@typecad/framework-zephyr`
- A USB serial port available

---

## Writing tests

Test files follow a fluent chaining style. Expectations can use direct values or zero-argument functions/IIFEs that return the value to assert.

```typescript
// examples/my-sensor.test.ts
import { describe, done } from '@typecad/expect';
import { ADC_PIN, ADC_MAX } from '@typecad/test-pins';
import { ADC } from '@typecad/board';

describe("A0 analog read")
  .it("reads a value in valid ADC range")
    .expect((() => { const sense = new ADC(ADC_PIN); return sense.read(); })())
    .toBeWithinRange(0, ADC_MAX)
  .it("reads less than mid-scale when grounded")
    .expect((() => { const sense = new ADC(ADC_PIN); return sense.read(); })())
    .toBeLessThan(ADC_MAX / 2);

done();
```

### describe / it

`describe(name: string): Suite`

Opens a named test group. Returns a `Suite` that you chain `.it()` calls onto.

`suite.it(name: string): Suite`

Opens a named test case within the current group. Returns the same `Suite` for further chaining.

### expect

`suite.expect(value: number): Expectation`

Captures a hardware value to be asserted. The argument must be a TypeCAD hardware expression (e.g. `sense.read()`, `pin.get()`) or a zero-argument function returning one. The preprocessor hoists hardware expressions so they are evaluated exactly once.

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
npx --package=@typecad/expect cuttlefish-test examples/my-sensor.test.ts

# Run all test files matched by config include patterns
npx --package=@typecad/expect cuttlefish-test

# Override the port at run-time
npx --package=@typecad/expect cuttlefish-test --port /dev/ttyACM0 examples/my-sensor.test.ts
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
| `--board <pkg>` | `-b` | from config | Board target override |
| `--build-target <id>` | | from config | Framework build target override (e.g. `blackpill_f411ce/stm32f411xe`) |
| `--baud <rate>` | | `115200` | Serial baud rate |
| `--timeout <ms>` | `-t` | `30000` | Serial read timeout in milliseconds |
| `--include <glob>` | `-i` | from config | Test file glob pattern (repeatable) |
| `--exclude <glob>` | `-x` | from config | Test file glob pattern to skip (repeatable) |
| `--verbose` | `-v` | `false` | Show raw serial output and per-assertion detail |
| `--config <path>` | | `cuttlefish.config.ts` | Config file to load (suite dirs pass a board-specific config) |
| `--discover` | | | List attached USB serial ports (VID:PID, serial, manufacturer) and which one the active board identity matches, then exit |
| `--dry-run` | | | Compile only — skip upload and serial execution (pipeline check without hardware) |
| `--bail` | | | Stop after the first failing file |
| `--help` | `-h` | | Print help and exit |

### USB port discovery (multi-board rigs)

COM/tty numbers reshuffle on every replug and on every CDC re-enumeration
after a flash, so a test box with several boards identifies them by USB
VID/PID (+ optional serial number) instead:

```typescript
test: {
  usb: { vid: '2FE3', pid: '0001' },   // resolves the port by identity
},
```

Board packages that ship a `test-pins.json` can carry the same `usb` block —
then no config change is needed at all (an explicit `test.usb` in the config
wins). Zephyr CDC consoles enumerate at the Zephyr test IDs `2FE3:0001` for
every board (per-board PIDs are no longer assigned), so vid/pid alone cannot
distinguish several attached CDC boards — run one CDC board at a time.
UART-bridge boards identify by their bridge chip (Uno 16U2 `2341:0043`,
CH340 clones `1A86:7523`; ESP32 DevKitC CP2102 `10C4:EA60`).
Several identical devkits disambiguate with the bridge's USB serial number:
`usb: { vid: '10C4', pid: 'EA60', serial: '0001' }`.

When a USB identity is active the runner re-resolves the port **after every
upload** — a CDC console that comes back under a different COM number is
found again automatically. Discovery failures are loud and list every
attached port (what a nightly log wants). An explicit `--port` flag or
`test.port` always overrides discovery.

Bring a rig up with `--discover`: it prints every attached port's
VID:PID/serial/manufacturer and marks which one the current config matches
(exit code 1 when the identity has no unique match, so scripts can gate).

```bash
cuttlefish-test --config boards/blackpill/cuttlefish.config.ts --discover
# USB serial ports:
#   COM7  2FE3:0001 serial …  <-- matches this config
#   COM4  10C4:EA60 serial 0001 [Silicon Labs]
# config identity 2FE3:0001 -> COM7
```

### cuttlefish.config.ts

Add a `test` section to your project's `cuttlefish.config.ts` to avoid passing flags every time:

```typescript
// cuttlefish.config.ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  board: 'blackpill_f411ce/stm32f411xe',
  framework: '@typecad/framework-zephyr',

  test: {
    port: 'COM4',            // serial port of the connected board
    baudRate: 115200,        // must match the console's baud rate
    timeout: 30000,          // ms to wait for SUITE_END before giving up
    include: [               // glob patterns for test discovery
      'examples/**/*.test.ts',
      'tests/hardware/**/*.test.ts',
    ],
    exclude: [               // optional glob patterns to skip after discovery
      'tests/hardware/network/**/*.test.ts',
    ],
  },
};

export default config;
```

All `test` fields are optional and can be overridden by CLI flags.

### Target-specific skips

Use a file-level comment when a test is valid only for some MCUs or framework targets. The runner checks these comments before preprocessing, compiling, or uploading.

```typescript
// @typecad-skip-target native: this group drives Zephyr console timing.
```

The inverse form skips every target except the listed ones:

```typescript
// @typecad-only-target esp32s3_devkitc,blackpill_f411ce: pins live in test-pins.json for these boards.
```

Targets are matched against `target`, the `buildTarget` id, and the final `/`-segment of the board target (e.g. `stm32f411xe` from `blackpill_f411ce/stm32f411xe`) — `*` matches everything.

Skipped files are reported in the same style as Vitest:

```text
 ↓ tests/32-wdt.test.ts (skipped)

 Tests       1 skipped (1)
 Test Files  1 skipped (1)
 PASS All tests passed
```

Run with `--verbose` to print the skip reason from the directive.

### Board test-pin roles (`@typecad/test-pins`)

Each board config ships a `test-pins.json` (co-located with its
`cuttlefish.config.ts`, e.g. `packages/hal/boards/<name>/`) declaring which
pins a hardware suite may use and the board's numeric facts:

```jsonc
{
  "pins": {
    "gpioOut": "PB5",
    "gpioIn": "PB0",
    "pwm": "PB6", "pwmAlt": "PB7",
    "cs": "PA4", "interrupt": "PA0",
    "led": "LED", "button": "BUTTON",
    "adcPin": "PA1", "adcPinAlt": "PA2",
    "i2cBus": "'I2C0'"
  },
  "facts": {
    "adcMax": 4095
  }
}
```

Test files import stable role names instead of board-specific pin symbols:

```typescript
import { GPIO_OUT, PWM_PIN, ADC_PIN, ADC_MAX } from '@typecad/test-pins';
```

During preprocessing the runner substitutes each role with the configured board's pin symbol (facts become numeric literals) and rewrites the import to `@typecad/board` — the exact lowering path hand-written per-board tests use. Files declare the roles they need so they skip cleanly on boards that cannot provide them:

```typescript
// @typecad-requires-roles adcPin, adcMax
```

Because expect matcher arguments must be literals, compare facts on-device inside the `expect()` IIFE:

```typescript
describe("ADC upper bound")
  .expect((() => { const sense = new ADC(ADC_PIN); return sense.read() <= ADC_MAX ? 1 : 0; })()).toBe(1)
```

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
│ rewritten .ts   │  (console print calls, hoisted hardware vars)
└────────┬────────┘
         │  Cuttlefish transpiler
         ▼
┌─────────────────┐
│  .cpp program   │  (Zephyr C++)
└────────┬────────┘
         │  west build + flash
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

All lines not beginning with `[TC:` are ignored, so any other console output (`printk` debug prints, shell output) does not interfere with results.

**Assertion line format:** `[TC:EXPECT:<matcher>:<expected>:<actual>]`

- `expected` — the value(s) from the test source (e.g. `0,1023` for a range)
- `actual` — the raw value read from hardware

Assertion math (pass/fail, formatting) is computed entirely on the host, not in firmware.

### AST preprocessor

The Cuttlefish transpiler cannot evaluate hardware calls (like `sense.read()`) when they are nested inside non-TypeCAD function calls — they lose their structured IR and become plain text. The preprocessor solves this before transpilation:

1. Removes the `import { describe, done } from '@typecad/expect'` statement.
2. Emits the console init + `[TC:SUITE_START]` preamble once (the Zephyr console self-initializes — no init call is needed).
3. Walks the fluent chain `describe(...).it(...).expect(expr).matcher(args)`.
4. **Hoists** hardware expressions out of `.expect()` into a `const __tc_vN: number = expr;` declaration at the surrounding statement level.
5. Replaces the `.expect(...).matcher(...)` chain with the appropriate `__tc_print("[TC:EXPECT:...]")` calls.
6. Rewrites `done()` to `__tc_println("[TC:SUITE_END]")` + `while (true) { k_msleep(1000); }`.

The result is valid TypeCAD TypeScript with no nested hardware calls, ready for the standard transpiler.

---

## Limitations

- **No vitest-style callback suites** — groups and cases are defined by fluent chaining, not by `describe("name", () => { ... })`.
- **No async tests** — all timing is implicit (the board executes sequentially, the host waits on serial output).
- **Sequential execution only** — all describes in a file run once, in order, from the program's top-level statements. There is no `beforeEach`/`afterEach`.
- **One file per upload** — each test file produces one program and one upload cycle. Multiple test files run as separate upload+execute passes.
- **Number types only for hardware values** — TypeCAD maps numeric hardware readings to `int`/`float`. String expectations are for software string variables, not raw hardware reads.
