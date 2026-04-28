# Test and Simulate Without Hardware

[← Home](index.md)

Most embedded firmware frameworks give you one way to validate behavior: flash it and see what happens. TypeHAL gives you three: an in-memory simulator for logic, a fluent assertion library that runs on real hardware over serial, and a VS Code debug bridge that maps C++ compiler errors back to your TypeScript source.

---

## In-memory simulation

The `@typehal/simulator` package lets you run your firmware logic in Node.js — register fake I2C/SPI devices, inject data, and assert on the bus traffic, all without a physical board.

```typescript
import { createSimBoard } from '@typehal/simulator';

const board = createSimBoard();

// Register a simulated BME280
board.i2c.addDevice(0x76, {
  readByte(reg: number) {
    if (reg === 0xD0) return 0x60; // chip ID
    return 0x00;
  }
});

// Run your firmware function
const chipId = board.i2c.device(0x76).readByte(0xD0);
console.assert(chipId === 0x60, 'chip ID mismatch');
```

Use the simulator for:

- Unit-testing initialization sequences
- Verifying register write order
- Checking bus traffic without a scope
- Running in CI with no hardware attached

---

## Hardware assertions with `@typehal/expect`

When you're ready to validate real behavior, `@typehal/expect` gives you a vitest-style fluent API that compiles into your sketch and reports pass/fail over serial.

```typescript
import { describe, done } from '@typehal/expect';
import { A0, A1 } from '@typehal';

describe("ADC sanity")
  .it("A0 reads within valid 10-bit range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it("A1 is non-negative")
    .expect(A1.readAnalog()).toBeGreaterThanOrEqual(0);

describe("ADC mid-scale")
  .it("A0 reads below mid-scale when grounded")
    .expect(A0.readAnalog()).toBeLessThan(512);

done();
```

Run it:

```bash
npx typehal-test --port COM4 tests/adc.test.ts
```

The host-side runner reads pass/fail from real pin states over serial. No mocks. No stubs. Actual hardware behavior.

### Available matchers

| Matcher | Description |
|---|---|
| `.toBeWithinRange(min, max)` | Value falls between min and max (inclusive) |
| `.toBeGreaterThanOrEqual(n)` | Value ≥ n |
| `.toBeLessThan(n)` | Value < n |
| `.toBeLessThanOrEqual(n)` | Value ≤ n |
| `.toBeGreaterThan(n)` | Value > n |
| `.toEqual(value)` | Strict equality |

---

## VS Code debug bridge

Set breakpoints in your `.ts` source files. The transpiler injects serial instrumentation that reports variable values and pauses execution — you step through your TypeScript code, not the generated C++.

To enable:

```bash
npx typehal sketch.ts --debug --compile --upload --port COM4
```

Then use the VS Code debug panel with the TypeHAL debug extension to attach and step through your firmware.

---

## Source maps for compiler errors

When `arduino-cli` rejects the emitted C++, TypeHAL maps the error back to your TypeScript source:

```bash
npx typehal map-error out/sketch/sketch.ino.thcppmap.json --line 42 --col 5
```

Output:

```
→ src/sketch.ts:18:12
  const temp = sensor.readByte(0xFA);
```

You see the TypeScript file, line, and column — not the generated C++ that no one intended to read.

---

## CI integration

Because TypeHAL builds are deterministic and source-mapped, you can run the full pipeline in CI:

```yaml
# GitHub Actions example
- name: Transpile and compile
  run: npx typehal build --compile
  # Exits non-zero on any error-level diagnostic
```

The simulator tests run in plain Node.js — no Arduino toolchain required in CI.

---

[← Ownership & Safety](ownership-and-safety.md) &nbsp;|&nbsp; [Quickstart →](quickstart.md)
