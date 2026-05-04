# Adding HAL Features with emit/include

This guide explains how to add new hardware abstraction features to TypeHAL using the `emit()`, `include()`, and `board()` compile-time functions. The HAL source files live in `packages/typehal/src/` and are read by the transpiler's resolver at build time.

## Core principle

**If the HAL doesn't `emit()`/`include()` it, it doesn't happen.** There are no transpiler inline fallbacks. Every line of C++ output and every `#include` header must originate from a HAL source file. Board-specific constants accessed via `board()` are the only way to make HAL methods adapt to different hardware.

---

## How emit, include, and board work

`emit()`, `include()`, and `board()` are compile-time directives that look like normal TypeScript function calls but are intercepted by the transpiler's HAL resolver when it processes method bodies.

```ts
// emit.ts — declare, no runtime body
declare function emit(text: string): void;

// include.ts — real function (no-op at runtime, intercepted at transpile time)
function include(text: string): void {}

// board.ts — declare, no runtime body
declare function board(path: string): number;
```

- **`emit(text)`** — The resolver processes the template literal argument, substitutes `this._field` values, method parameters, and `board()` references, and appends the result as a line of C++ code.
- **`include(header)`** — The resolver adds the header string to a global deduplicated set. Appears as `#include` directives in the output.
- **`board(path)`** — The resolver looks up a dot-path in the loaded board definition and substitutes the literal value. Used inside `emit()` template literals to make HAL methods board-aware.

---

## File layout

```
packages/typehal/src/
  emit.ts          — emit() declaration
  include.ts       — include() function
  board.ts         — board() declaration
  constants.ts     — phantom C++ constants (HIGH, LOW, WDTO_*, etc.)
  gpio.ts          — Pin class (digital I/O)
  i2c.ts           — I2CBus + I2CDevice classes
  spi.ts           — SPIBus + SPIDevice classes
  uart.ts          — SerialPort class
  eeprom.ts        — EEPROMClass singleton
  wdt.ts           — WDTClass singleton
  timing.ts        — declare function stubs (delay, millis, etc.)
  math.ts          — declare function stubs (abs, min, max)
  pulse.ts         — declare function stubs (pulseIn, pulseInLong)
  shift.ts         — declare function stubs (shiftIn, shiftOut)
  random.ts        — declare function stubs (randomSeed, random)
  index.ts         — barrel re-exports
```

To add a new HAL peripheral, create a `.ts` file in this directory and add the filename to the `HAL_SOURCE_FILES` array in `packages/transpiler/src/ir/hal-resolver.ts`:

```ts
const HAL_SOURCE_FILES = [
  "gpio.ts",
  "i2c.ts",
  "spi.ts",
  "uart.ts",
  "eeprom.ts",
  "wdt.ts",
  "your-new-peripheral.ts",  // ← add here
];
```

Then re-export your classes and functions from `index.ts`.

---

## Anatomy of a HAL class

### Private fields and constructor

The resolver reads the constructor to build a field map. It looks for the exact pattern `this._field = param`:

```ts
import { emit } from './emit';
import { include } from './include';

export class MyBus {
  private _bus: string;           // ← private field with underscore prefix

  constructor(bus: string) {
    this._bus = bus;              // ← resolver reads this assignment
    include("<MyBus.h>");         // ← headers from constructor are registered at instantiation
  }
}
```

The resolver records `_bus` → `bus`. When the transpiler later encounters `const b = new MyBus("Wire")`, it stores the field value `_bus` → `"Wire"` and registers the `#include <MyBus.h>`.

### Using field values in emit

Reference private fields with `${this._fieldName}` in emit template literals:

```ts
begin(): this {
  emit(`${this._bus}.begin();`);
  return this;
}
```

When `_bus` is `"Wire"`, this produces the C++ line:
```cpp
Wire.begin();
```

### Using method parameters in emit

Parameters are interpolated by name using `${paramName}`:

```ts
write(value: number): void {
  emit(`${this._bus}.write(${value});`);
}
```

When called as `myBus.write(0x55)` with `_bus` → `"Wire"`, this produces:
```cpp
Wire.write(85);
```

The resolver substitutes `value` with the rendered text of the call argument.

### Multiple emit calls

A single method can issue multiple `emit()` calls. Each one produces a separate line of C++:

```ts
writeByte(register: number, value: number): void {
  emit(`${this._bus}.beginTransmission(${this._address});`);
  emit(`${this._bus}.write(${register});`);
  emit(`${this._bus}.write(${value});`);
  emit(`${this._bus}.endTransmission();`);
}
```

### Include in methods

Call `include()` inside any method to register a header. It deduplicates automatically:

```ts
begin(): this {
  include("<Wire.h>");
  emit(`${this._bus}.begin();`);
  return this;
}
```

Only call `include()` inside `begin()` or the constructor — not on every method call — to avoid redundant processing.

### Return values

There are two ways to express return values.

**1. Auto-passthrough (stub methods)**

If a method has no `emit()` calls and returns a literal, the resolver synthesizes a C++ method call:

```ts
read(): number { return 0; }
```

The resolver generates `Wire.read()` — the C++ object name comes from the first constructor field, and the method name and arguments come from the TypeScript call.

**2. Explicit return expression**

Use `emit("return EXPR;")` to specify the exact C++ return expression. Include a fallback `return` for TypeScript type-checking:

```ts
readByte(): number {
  emit(`return ${this._bus}.read();`);
  return 0;    // fallback for TypeScript — never reached at transpile time
}
```

The resolver detects `emit("return ...")` and extracts the expression (without `return` and trailing `;`) as the return value. The fallback `return 0` is ignored because the resolver already captured a return value from the `emit()` call.

### Fluent API (method chaining)

Methods that return `this` propagate the HAL instance for chaining:

```ts
begin(): this {
  include("<Wire.h>");
  emit(`${this._bus}.begin();`);
  return this;
}
```

When the transpiler sees `const bus = I2C0.begin()`, it tracks `bus` as the same HAL instance. Subsequent calls like `bus.setClock(400000)` resolve correctly.

Methods that return primitive values (number, string, void) do **not** propagate the instance.

---

## Full examples

### Simple peripheral with stub methods

```ts
import { emit } from './emit';
import { include } from './include';

export class ADCBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
    include("<ADC.h>");
  }

  begin(): this {
    emit(`${this._bus}.begin();`);
    return this;
  }

  read(channel: number): number {
    // Auto-passthrough: no emit(), returns literal → generates ADC.read(channel)
    return 0;
  }

  setResolution(bits: number): void {
    emit(`${this._bus}.setResolution(${bits});`);
  }
}
```

### Singleton with no constructor fields

```ts
import { emit } from './emit';

export class TimerClass {
  // No private fields — no constructor needed

  start(period: number): void {
    emit(`Timer.start(${period});`);
  }

  stop(): void {
    emit(`Timer.stop();`);
  }
}

export const Timer = new TimerClass();
```

For singletons exported as pre-constructed instances, add a bare-name fallback in `resolveHALReceiver()` in `hal-resolver.ts` so the transpiler can resolve the identifier without an import:

```ts
const bareNameMap: Record<string, ...> = {
  EEPROM: { className: "EEPROMClass", fieldValues: new Map([["_name", "EEPROM"]]) },
  WDT:    { className: "WDTClass", fieldValues: new Map() },
  Timer:  { className: "TimerClass", fieldValues: new Map() },  // ← add here
};
```

### Device accessor pattern (like I2C.device)

For peripherals that communicate with addressed devices, create a companion class:

```ts
export class MyBus {
  private _bus: string;
  constructor(bus: string) { this._bus = bus; }

  begin(): this {
    include("<MyLib.h>");
    emit(`${this._bus}.begin();`);
    return this;
  }

  device(address: number): MyDevice {
    return new MyDevice(this._bus, address);
  }
}

export class MyDevice {
  private _bus: string;
  private _address: number;

  constructor(bus: string, address: number) {
    this._bus = bus;
    this._address = address;
  }

  writeByte(register: number, value: number): void {
    emit(`${this._bus}.beginTransmission(${this._address});`);
    emit(`${this._bus}.write(${register});`);
    emit(`${this._bus}.write(${value});`);
    emit(`${this._bus}.endTransmission();`);
  }

  readByte(register: number): number {
    emit(`${this._bus}.beginTransmission(${this._address});`);
    emit(`${this._bus}.write(${register});`);
    emit(`${this._bus}.endTransmission(false);`);
    emit(`${this._bus}.requestFrom(${this._address}, 1);`);
    emit(`return ${this._bus}.read();`);
    return 0;
  }
}
```

### Using constants

Declare phantom constants in `constants.ts` for C++ identifiers that should pass through unchanged:

```ts
// constants.ts
export declare const SPI_MODE0: number;
export declare const SPI_MODE1: number;
```

Use them as bare identifiers inside emit strings — the resolver passes them through as-is:

```ts
// spi.ts
beginTransaction(settings: string): void {
  emit(`${this._bus}.beginTransaction(${settings});`);
}
```

When `settings` resolves to `SPISettings(1000000, MSBFIRST, SPI_MODE0)`, the bare `MSBFIRST` and `SPI_MODE0` identifiers survive into the C++ output unchanged.

### Declare-function modules (no class)

For simple C functions that don't need an object, use `declare function` stubs. The transpiler handles these as pass-through calls:

```ts
// timing.ts
export declare function delay(ms: number): void;
export declare function millis(): number;
export declare function micros(): number;
```

No `emit()` or `include()` needed — the transpiler generates direct function calls like `delay(1000)` and `millis()` in the C++ output.

### Board-aware methods with board()

HAL methods can reference board-specific constants (ADC resolution, reference voltage, PWM resolution, clock speed, etc.) using the `board()` compile-time function inside `emit()` template literals.

#### What board data is available

Board packages (`@typehal/board-arduino-uno`, `@typehal/board-esp32-devkit`, etc.) export a `BoardDefinition` object containing:

| Path | Example (Arduino Uno) | Example (ESP32) |
|------|-----------------------|-----------------|
| `architecture` | `'avr'` | `'esp32'` |
| `mcu` | `'ATmega328P'` | `'ESP32-WROOM-32'` |
| `clockSpeed` | `16000000` | `240000000` |
| `memory.flash` | `32768` | `4194304` |
| `memory.sram` | `2048` | `520192` |
| `memory.eeprom` | `1024` | `—` |
| `peripherals.adc.0.resolution` | `10` | `12` |
| `peripherals.adc.0.referenceVoltage` | `5.0` | `3.3` |
| `peripherals.adc.0.channels` | `6` | `8` |
| `peripherals.pwm.resolution` | `8` | `20` |
| `peripherals.pwm.maxFrequency` | `62500` | `40000000` |
| `peripherals.pwm.channels` | `6` | `16` |
| `peripherals.dac.0.resolution` | — | `8` |
| `peripherals.i2c.0.instance` | `0` | `0` |
| `peripherals.spi.0.instance` | `0` | `0` |
| `peripherals.uart.0.instance` | `0` | `0` |
| `features.watchdog` | `true` | `true` |
| `features.hardwareRng` | `false` | `true` |

Paths use dot notation. Array entries are indexed: `peripherals.adc.0.resolution` means `peripherals.adc[0].resolution`.

#### How to add computed board fields

If a HAL method needs a derived value (e.g. ADC max value = 2^resolution - 1), add it as a computed field in the board definition rather than doing math in the resolver. The board packages are responsible for pre-computing derived values:

```ts
// In the board package's definition:
peripherals: {
  adc: [{
    instance: 0,
    resolution: 10,
    referenceVoltage: 5.0,
    channels: 6,
    maxValue: 1023,           // ← pre-computed: (1 << 10) - 1
  }],
}
```

This keeps the resolver simple — it does string substitution only, not expression evaluation.

#### Using board() in emit templates

Import `board` from `'./board'` and use it inside template literal expressions within `emit()`:

```ts
import { emit } from './emit';
import { board } from './board';

export class Pin {
  private _pin: string;
  constructor(pin: number) { this._pin = String(pin); }

  readVoltage(): number {
    emit(`return analogRead(${this._pin}) * ${board("peripherals.adc.0.referenceVoltage")} / ${board("peripherals.adc.0.maxValue")};`);
    return 0;
  }
}
```

When targeting Arduino Uno (10-bit ADC, 5.0V reference, maxValue 1023):
```cpp
return analogRead(7) * 5.0 / 1023;
```

When targeting ESP32 (12-bit ADC, 3.3V reference, maxValue 4095):
```cpp
return analogRead(7) * 3.3 / 4095;
```

The same HAL source produces different C++ depending on which board package is loaded.

#### board() with multiple peripherals

When a board has multiple instances of a peripheral (e.g., ESP32 has two ADCs), use the instance index in the path:

```ts
// First ADC (ADC1 on ESP32)
const res1 = board("peripherals.adc.0.resolution");

// Second ADC (ADC2 on ESP32)
const res2 = board("peripherals.adc.1.resolution");
```

The instance index matches the array position in the board definition's `peripherals.adc[]`.

#### How board data reaches the resolver

The resolver accesses board data through module-level state in `build-ir-state.ts`:

```
buildProgramIR()
  │
  ├── resolveBoardConstants(boardFile)     ← board data resolved FIRST
  │     stores in currentBoardConstants     ← module-level variable
  │
  ├── source.forEachChild(...)             ← IR building (including HAL resolution)
  │     │
  │     └── processHALMethodBody()
  │           │
  │           └── resolveExpressionText()  ← intercepts board("path") calls
  │                 looks up path in currentBoardConstants
  │                 returns literal value as string
  │
  └── runProgramValidations(...)           ← board data used for validation
```

This is the same module-level state pattern used by `requiredIncludes` — the resolver imports `currentBoardConstants` from `build-ir-state.ts` and reads it during template resolution.

#### Design rules for board()

1. **Always use pre-computed values.** Don't put arithmetic in the emit template that depends on `board()` results. Define `maxValue`, `frequencyHz`, etc. in the board package instead.
2. **Use board() only inside emit() template literals.** The resolver intercepts it during template resolution. Calling `board()` outside an emit string has no effect.
3. **Board paths must match the BoardDefinition structure exactly.** The path is a literal string — no variable interpolation. The resolver does a direct map lookup.
4. **If the path doesn't exist, the method falls back.** The resolver returns `null` for unresolved `board()` calls, which causes the entire emit template to fail. The method then produces no C++ output. Ensure the board package you're targeting actually has the field you're referencing.
5. **Same HAL source, different boards.** The point of `board()` is that one HAL method definition adapts to any board. Don't board-switch in the HAL source — let the board data do the work.

---

## Naming helpers

Provide a naming function that maps TypeHAL instance numbers to Arduino C++ object names:

```ts
export function serialName(instance: number): string {
  return instance === 0 ? "Serial" : `Serial${instance}`;
}
```

Usage: `new SerialPort(serialName(0))` → `_port` = `"Serial"`.

---

## The resolver pipeline

Understanding how the resolver processes your HAL source helps debug issues.

1. **Load** — At transpile start, the resolver reads each file in `HAL_SOURCE_FILES`, parses it with the TypeScript compiler API, and extracts class constructors (field maps, includes) and methods (AST nodes, parameter names) into the `halClassRegistry`.

2. **Resolve receiver** — When the transpiler encounters a method call, it resolves the receiver (the object before the `.`) to a `HALInstance` with a className and fieldValues map. Resolution sources:
   - Tracked variable instances (from `halInstances`)
   - Bare-name singletons (`EEPROM`, `WDT`)
   - Pattern-based bus aliases (`UART0` → `SerialPort` with `_port` = `"Serial"`)
   - D/A pin patterns (`D13` → `Pin` with `_pin` = `"13"`)
   - Inline `new` expressions

3. **Process method body** — The resolver looks up the method AST from the class registry and iterates through its statements:
   - `emit(template)` → resolves template with field/param substitution, appends to `emitLines[]`
   - `include(header)` → adds to global `requiredIncludes` set
   - `return expr` → captures as `returnValue`
   - `emit("return EXPR")` → special convention, extracts as return value expression

4. **Template resolution** — Inside template literals:
   - `${this._field}` → replaced with the resolved field value from the instance
   - `${paramName}` → replaced with the rendered text of the call argument
   - `${board("path.to.value")}` → replaced with the literal value from the loaded board definition
   - Bare identifiers (constants like `HIGH`, `OUTPUT`) → passed through as-is
   - Nested expressions (function calls, binary ops) → recursively resolved

5. **Auto-passthrough** — If a method has no `emit()` calls and returns a literal (0, ""), the resolver synthesizes `<cppObj>.<method>(<args>)`. The C++ object name comes from the first constructor field. **The `Pin` class is excluded** because pin methods map to standalone C functions, not object methods.

6. **Instance propagation** — After processing a `const x = obj.method()` call:
   - If the method returns `this` (or has no return value) → `x` is tracked as the same HAL instance
   - If the method returns a primitive → `x` is **not** tracked as a HAL instance

---

## Checklist for adding a new HAL peripheral

1. Create `packages/typehal/src/your-peripheral.ts` with class(es) using `emit()`/`include()`
2. If the method needs board-specific constants, import `board` from `'./board'` and use `${board("path")}` in emit templates
3. If the board definition doesn't have the field you need, add it to the board package and `BoardDefinition` type in `packages/schema/src/board/types.ts`
4. If needed, add phantom C++ constants to `constants.ts` with `export declare const`
5. Add any naming helper functions (e.g., `yourPeripheralName(instance: number): string`)
6. Export everything from `index.ts`
7. Add the filename to `HAL_SOURCE_FILES` in `packages/transpiler/src/ir/hal-resolver.ts`
8. If the class is a singleton used without import, add a bare-name fallback entry in `resolveHALReceiver()`
9. If the class supports pattern-based bus aliases (e.g., `CAN0`), add a regex fallback in `resolveHALReceiver()`
10. Rebuild: `pnpm --filter @typehal/core build && pnpm --filter @typehal/transpiler build`
11. Add tests in `tests/packages/hal/` asserting against emitted C++ text for each supported board
12. Run `pnpm vitest run` to verify

---

## Common patterns reference

| Pattern | When to use | Example |
|---------|-------------|---------|
| `emit(\`${this._field}.action()\`)` | Every method that generates C++ | `emit(\`${this._bus}.begin()\`)` |
| `include("<Header.h>")` | When the C++ code needs a header | In `begin()` or constructor |
| `${board("path")}` in emit | Board-specific constants in C++ output | `${board("peripherals.adc.0.maxValue")}` |
| `return 0;` (no emit) | Auto-passthrough: maps to `<obj>.method()` | `read(): number { return 0; }` |
| `emit("return EXPR;")` + `return 0;` | Explicit C++ return expression | `emit(\`return Wire.read(); \`)` |
| `return this;` | Method chaining, instance propagation | `begin(): this { ...; return this; }` |
| `export declare const X: number` | Phantom C++ constants | `WDTO_2S`, `OUTPUT`, `HIGH` |
| `export declare function f(): void` | Pass-through C functions | `delay(ms: number): void` |
| Singleton `export const X = new XClass()` | Global peripherals (WDT, EEPROM) | `export const WDT = new WDTClass()` |
| Device class + `bus.device(addr)` | Addressed bus devices | `I2CBus.device(0x76).writeByte(reg, val)` |

---

## Debugging

- **Method not resolved** — Check that the class name in your HAL source matches what the resolver expects. The resolver looks up classes by name in `halClassRegistry`.
- **Template literal not substituting** — Ensure the parameter name in the emit string exactly matches the TypeScript method parameter name. The resolver matches by name, not position.
- **Missing `#include`** — Call `include()` inside the method or constructor that needs it. Constructor includes are registered when the instance is created.
- **Return value wrong** — If using auto-passthrough, make sure there are no `emit()` calls in the method (auto-passthrough only activates for stub methods). If using explicit return, use the `emit("return EXPR;")` convention.
- **Instance not tracked** — Methods must return `this` for instance propagation. Methods returning primitives (number, void) break the chain.
- **board() producing no output** — If the board path doesn't exist in the loaded board definition, the resolver returns `null` for the entire emit template. Check that the path matches the `BoardDefinition` structure exactly (including array indices). Test with a known path like `"architecture"` first.
- **board() returns wrong value** — The path must match the flat dot-path key used by `resolveBoardConstants`. For array entries, use numeric indices: `peripherals.adc.0.resolution`, not `peripherals.adc[0].resolution`.
- **Method works on one board but not another** — Different boards have different peripheral definitions. A path like `peripherals.dac.0.resolution` exists on ESP32 but not on Arduino Uno. Use `board()` only for fields that exist across all target boards, or accept that the method won't produce output on boards missing the field.
- **Rebuild after changes** — HAL source changes require `pnpm --filter @typehal/core build && pnpm --filter @typehal/transpiler build` before the transpiler picks them up.
