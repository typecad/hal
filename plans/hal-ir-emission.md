# Plan: HAL IR-Based Emission

## Overview

Replace the current raw C++ string emission in `@typehal/hal` with a structured Intermediate Representation (IR) approach. The HAL methods will produce semantic `HALOpIR` nodes instead of raw `emit("digitalWrite(...)")` strings, and the framework strategy will translate these nodes to framework-specific C++.

---

## Architecture: Current vs Target

### Current Flow

```
User sketch.ts
  → imports Pin from @typehal/hal
  → calls D13.high()
  → transpiler IR builder sees method call
  → hal-resolver.ts resolves to HAL source code
  → processHALMethodBody() parses emit("digitalWrite(13, HIGH)")
  → returns { emitLines: ["digitalWrite(13, HIGH);"] }
  → statement-to-ir.ts creates __EMIT__ statement IR
  → emitter injects raw C++ string into output
```

### Target Flow

```
User sketch.ts
  → imports Pin from @typehal/hal
  → calls D13.high()
  → transpiler IR builder sees method call
  → hal-resolver.ts resolves to HAL source code
  → processHALMethodBody() parses new gpioWrite(13, HIGH) semantic function
  → returns { halOps: [{ kind: "hal-op", operation: "gpio.write", args: [...] }] }
  → statement-to-ir.ts creates hal-op statement IR
  → emitter dispatches to framework strategy
  → ArduinoStrategy → "digitalWrite(13, HIGH);"
  → AvrNativeStrategy → "PORTB |= 0x20;"
```

---

## Step 1: Define HAL Operation IR Types

**File:** `packages/core/src/shared/hal-op-ir.ts` (new)

Define the `HALOpIR` union type representing all supported hardware operations. Each operation has a semantic name and typed arguments.

```typescript
// HAL Operation IR — semantic hardware operations
// The framework strategy translates these to C++

export type HALOpIR =
  // GPIO digital
  | { operation: "gpio.write"; pin: number; value: 0 | 1 }
  | { operation: "gpio.read"; pin: number }
  | { operation: "gpio.toggle"; pin: number }
  | { operation: "gpio.set_mode"; pin: number; mode: string }

  // PWM / Analog output
  | { operation: "pwm.write"; pin: number; duty: number }
  | { operation: "pwm.get_frequency"; pin: number }
  | { operation: "pwm.get_resolution"; pin: number }

  // ADC / Analog input
  | { operation: "adc.read"; pin: number }
  | { operation: "adc.get_resolution" }
  | { operation: "adc.set_reference"; reference: string | number }
  | { operation: "adc.get_reference_voltage"; referenceLabel: string }

  // Interrupts
  | { operation: "interrupt.attach"; pin: number; handler: string; mode: string }
  | { operation: "interrupt.detach"; pin: number }

  // Tone / Audio
  | { operation: "tone.play"; pin: number; frequency: number; duration?: number }
  | { operation: "tone.stop"; pin: number }

  // Timing
  | { operation: "timing.delay"; ms: number }
  | { operation: "timing.delay_microseconds"; us: number }
  | { operation: "timing.millis" }
  | { operation: "timing.micros" }
  | { operation: "timing.set_interval"; handler: string; timeout: number }
  | { operation: "timing.set_timeout"; handler: string; timeout: number }
  | { operation: "timing.clear_interval"; id: number }
  | { operation: "timing.clear_timeout"; id: number }

  // I2C
  | { operation: "i2c.begin"; bus: string; address?: number }
  | { operation: "i2c.end"; bus: string }
  | { operation: "i2c.begin_transmission"; bus: string; address: number }
  | { operation: "i2c.write"; bus: string; data: string }
  | { operation: "i2c.end_transmission"; bus: string; stop: boolean }
  | { operation: "i2c.request_from"; bus: string; address: number; quantity: number; stop: boolean }
  | { operation: "i2c.available"; bus: string }
  | { operation: "i2c.read"; bus: string }
  | { operation: "i2c.set_clock"; bus: string; hz: number }
  | { operation: "i2c.recover"; bus: string }

  // SPI
  | { operation: "spi.begin"; bus: string }
  | { operation: "spi.end"; bus: string }
  | { operation: "spi.transfer"; bus: string; data: string }
  | { operation: "spi.begin_transaction"; bus: string; settings: string }
  | { operation: "spi.end_transaction"; bus: string }
  | { operation: "spi.set_frequency"; bus: string; hz: number }
  | { operation: "spi.set_mode"; bus: string; mode: number }
  | { operation: "spi.set_bit_order"; bus: string; order: string }
  | { operation: "spi.cs_low"; pin: number }
  | { operation: "spi.cs_high"; pin: number }

  // UART / Serial
  | { operation: "uart.begin"; port: string; baud: number }
  | { operation: "uart.end"; port: string }
  | { operation: "uart.print"; port: string; value: string }
  | { operation: "uart.println"; port: string; value: string }
  | { operation: "uart.printf"; port: string; format: string; args: string }
  | { operation: "uart.write"; port: string; data: string }
  | { operation: "uart.read"; port: string }
  | { operation: "uart.peek"; port: string }
  | { operation: "uart.available"; port: string }
  | { operation: "uart.flush"; port: string }

  // Pulse measurement
  | { operation: "pulse.in"; pin: number; value: 0 | 1; timeout?: number }
  | { operation: "pulse.in_long"; pin: number; value: 0 | 1 }

  // Shift register
  | { operation: "shift.out"; dataPin: number; clockPin: number; bitOrder: string; value: number }
  | { operation: "shift.in"; dataPin: number; clockPin: number; bitOrder: string }

  // Board constants
  | { operation: "board.resolve"; path: string }

  // Snprintf (for string formatting)
  | { operation: "snprintf.emit"; bufferName: string; format: string; args: string[] }

  // Raw C++ passthrough (escape hatch for unsupported operations)
  | { operation: "raw"; code: string };
```

---

## Step 2: Add `hal-op` Statement IR Kind

**File:** `packages/core/src/shared/ir-core.ts`

Add a new kind to `StatementIR`:

```typescript
// In the StatementIR union type, add:
| {
    kind: "hal-op";
    sourceSpan: SourceSpan;
    leadingComments?: string[];
    trailingComments?: string[];
    operation: HALOpIR;
    /** When true, the HAL operation returns a value that should be used as an expression */
    returns_value: boolean;
  }
```

Add to `ExpressionIR`:

```typescript
// In the ExpressionIR union type, add:
| {
    kind: "hal-expr";
    operation: HALOpIR;
  }
```

Add `HALOpIR` to the exports from `ir.ts`:

```typescript
export type { HALOpIR } from './hal-op-ir';
```

---

## Step 3: Replace `emit()` in HAL Source Files with Semantic Functions

Each HAL source file currently uses `emit("raw C++ string")`. Replace with structured function calls that the resolver can parse into `HALOpIR` nodes.

### New semantic helper functions

**File:** `packages/hal/src/emit.ts`

```typescript
// Semantic HAL operation functions — resolved to HALOpIR by the transpiler

/** Set a digital pin HIGH or LOW */
export declare function gpioWrite(pin: number, value: 0 | 1): void;
/** Read a digital pin, returns 1 (HIGH) or 0 (LOW) */
export declare function gpioRead(pin: number): number;
/** Toggle a digital pin */
export declare function gpioToggle(pin: number): void;
/** Set pin mode (OUTPUT, INPUT, INPUT_PULLUP) */
export declare function gpioSetMode(pin: number, mode: string): void;

/** Write PWM duty cycle (0-100%) */
export declare function pwmWrite(pin: number, duty: number): void;
export declare function pwmGetFrequency(pin: number): number;
export declare function pwmGetResolution(pin: number): number;

/** Read analog value from pin */
export declare function adcRead(pin: number): number;
export declare function adcGetResolution(): number;
export declare function adcSetReference(ref: string): void;
export declare function adcGetReferenceVoltage(label: string): number;

/** Attach / detach interrupts */
export declare function interruptAttach(pin: number, handler: string, mode: string): void;
export declare function interruptDetach(pin: number): void;

/** Tone generation */
export declare function tonePlay(pin: number, frequency: number, duration?: number): void;
export declare function toneStop(pin: number): void;

/** Timing */
export declare function delayMs(ms: number): void;
export declare function delayMicro(us: number): void;
export declare function getMillis(): number;
export declare function getMicros(): number;
export declare function setInterval_(handler: string, timeout: number): number;
export declare function setTimeout_(handler: string, timeout: number): number;
export declare function clearInterval_(id: number): void;
export declare function clearTimeout_(id: number): void;

/** I2C */
export declare function i2cBegin(bus: string, address?: number): void;
export declare function i2cEnd(bus: string): void;
export declare function i2cBeginTx(bus: string, address: number): void;
export declare function i2cWrite(bus: string, data: string): void;
export declare function i2cEndTx(bus: string, stop: boolean): number;
export declare function i2cRequestFrom(bus: string, address: number, quantity: number, stop: boolean): number;
export declare function i2cAvailable(bus: string): number;
export declare function i2cRead(bus: string): number;
export declare function i2cSetClock(bus: string, hz: number): void;
export declare function i2cRecover(bus: string): void;

/** SPI */
export declare function spiBegin(bus: string): void;
export declare function spiEnd(bus: string): void;
export declare function spiTransfer(bus: string, data: string): number;
export declare function spiBeginTx(bus: string, settings: string): void;
export declare function spiEndTx(bus: string): void;
export declare function spiSetFreq(bus: string, hz: number): void;
export declare function spiSetMode(bus: string, mode: number): void;
export declare function spiSetBitOrder(bus: string, order: string): void;
export declare function spiCsLow(pin: number): void;
export declare function spiCsHigh(pin: number): void;

/** UART */
export declare function uartBegin(port: string, baud: number): void;
export declare function uartEnd(port: string): void;
export declare function uartPrint(port: string, value: string): void;
export declare function uartPrintln(port: string, value: string): void;
export declare function uartPrintf(port: string, format: string, args: string): void;
export declare function uartWrite(port: string, data: string): void;
export declare function uartRead(port: string): number;
export declare function uartPeek(port: string): number;
export declare function uartAvailable(port: string): number;
export declare function uartFlush(port: string): void;

/** Pulse */
export declare function pulseIn_(pin: number, value: 0 | 1, timeout?: number): number;
export declare function pulseInLong_(pin: number, value: 0 | 1): number;

/** Shift */
export declare function shiftOut_(dataPin: number, clockPin: number, bitOrder: string, value: number): void;
export declare function shiftIn_(dataPin: number, clockPin: number, bitOrder: string): number;

/** Board constants */
export declare function boardResolve(path: string): any;

/** Raw C++ escape hatch */
export declare function rawCpp(code: string): void;

// Keep old emit() for backward compatibility during migration
export declare function emit(text: string): void;
```

### Example: Migrated `packages/hal/src/gpio.ts`

```typescript
import { gpioWrite, gpioRead, gpioToggle, gpioSetMode, pwmWrite, pwmGetFrequency, pwmGetResolution, 
         adcRead, adcGetResolution, adcSetReference, adcGetReferenceVoltage,
         interruptAttach, interruptDetach, tonePlay, toneStop,
         boardResolve } from './emit';
import { board } from './board';
import { callback } from './callback';
import { ADC } from './adc';
import { HIGH, LOW } from './constants';

// NOTE: callback() still returns a generated function name string — 
// this is consumed by interruptAttach/timing etc. as a string argument.

export class OutputPin {
  private _pin: number;
  private _lastFreq: number;
  readonly number: number;
  readonly gpio: number;

  constructor(pin: number) {
    this._pin = pin;
    this.number = pin;
    this.gpio = pin;
    this._lastFreq = 0;
  }

  high(): void { gpioWrite(this._pin, HIGH); }
  low(): void { gpioWrite(this._pin, LOW); }

  toggle(): void {
    // toggle = if currently LOW, write HIGH; else write LOW
    // This maps to a read + conditional write. The resolver produces:
    //   gpioRead(pin) → condition → gpioWrite(pin, value)
    gpioWrite(this._pin, gpioRead(this._pin) === LOW ? HIGH : LOW);
  }

  write(value: number | boolean): void {
    gpioWrite(this._pin, value ? HIGH : LOW);
  }

  pulse(durationMs: number): void {
    gpioWrite(this._pin, HIGH);
    delayMs(durationMs);
    gpioWrite(this._pin, LOW);
  }

  // ... etc
}
```

**Note:** Some methods (like `toggle`) currently emit a single C++ expression with a ternary. With IR, `toggle` becomes three IR nodes: read, conditional, write. The resolver can either:
1. Emit these as separate `hal-op` statements, or
2. Collapse them into a single `hal-expr` for emission

For the initial implementation, produce separate `hal-op` statements for simplicity. The framework strategy can optimize them.

---

## Step 4: Modify `hal-resolver.ts` to Produce HAL-Op IR

**File:** `packages/transpiler/src/ir/hal-resolver.ts`

The `processHALMethodBody()` function currently returns `{ emitLines: string[], returnValue?: string }`. Change it to return `{ halOps: HALOpIR[], returnOp?: HALOpIR }`.

### Changes needed:

1. Parse the new semantic function calls (`gpioWrite`, `gpioRead`, etc.) instead of `emit("...")`
2. Map each semantic function call to a `HALOpIR` node
3. For `include()` calls, keep the current behavior
4. For `board()` calls, produce `{ operation: "board.resolve", path }` HALOpIR
5. For `callback()` calls, register the callback and return the generated name (unchanged)

### Resolution table

| HAL source call | HALOpIR produced |
|----------------|-----------------|
| `gpioWrite(pin, val)` | `{ operation: "gpio.write", pin, value: val }` |
| `gpioRead(pin)` | `{ operation: "gpio.read", pin }` |
| `gpioToggle(pin)` | `{ operation: "gpio.toggle", pin }` |
| `gpioSetMode(pin, mode)` | `{ operation: "gpio.set_mode", pin, mode }` |
| `pwmWrite(pin, duty)` | `{ operation: "pwm.write", pin, duty }` |
| `adcRead(pin)` | `{ operation: "adc.read", pin }` |
| `interruptAttach(pin, handler, mode)` | `{ operation: "interrupt.attach", pin, handler, mode }` |
| `delayMs(ms)` | `{ operation: "timing.delay", ms }` |
| `i2cBegin(bus)` | `{ operation: "i2c.begin", bus }` |
| `spiBegin(bus)` | `{ operation: "spi.begin", bus }` |
| `uartBegin(port, baud)` | `{ operation: "uart.begin", port, baud }` |
| `boardResolve(path)` | `{ operation: "board.resolve", path }` |
| `rawCpp(code)` | `{ operation: "raw", code }` |

---

## Step 5: Modify `statement-to-ir.ts` to Store HALOpIR in IR

**File:** `packages/transpiler/src/ir/statement-to-ir.ts`

Currently `tryResolveHALMethod()` returns a `StatementIR` with `kind: "call"` and `callee: "__EMIT__"` for emit lines. Change this to return `kind: "hal-op"` with the `HALOpIR` operation.

### Changes:

1. `tryResolveHALMethod()` — instead of building `__EMIT__` call statements, build `hal-op` statements
2. For return values from HAL methods, use `hal-expr` expression IR
3. Keep the `tryResolveHALExpression()` path for expression-context HAL calls

### New code sketch:
```typescript
function buildHALOpStatement(
  op: HALOpIR, 
  sourceSpan: SourceSpan, 
  comments: { leadingComments?: string[]; trailingComments?: string[] }
): StatementIR {
  return {
    kind: "hal-op",
    sourceSpan,
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    operation: op,
    returns_value: false,
  };
}

function buildHALOpExpression(op: HALOpIR): ExpressionIR {
  return {
    kind: "hal-expr",
    operation: op,
  };
}
```

---

## Step 6: Add `resolveHALOperation()` to `PlatformStrategy`

**File:** `packages/core/src/shared/platform-strategy.ts`

Add a new sub-interface `PlatformHALStrategy` and a method to the composed `PlatformStrategy`:

```typescript
export interface PlatformHALStrategy {
  /**
   * Resolve a HAL operation to C++ code.
   * Returns a { code: string } for statement operations,
   * or { expression: string } for expression operations.
   * Returns undefined to fall back to default/raw emission.
   */
  resolveHALOperation?(op: HALOpIR): { code?: string; expression?: string } | undefined;
}

// Add to PlatformStrategy:
export interface PlatformStrategy
  extends PlatformProfileStrategy,
    PlatformPolyfillStrategy,
    PlatformTypeStrategy,
    PlatformExpressionStrategy,
    PlatformStatementStrategy,
    PlatformSafetyStrategy,
    PlatformBuildStrategy,
    PlatformDebugStrategy,
    PlatformAsyncStrategy,
    PlatformHALStrategy {  // <-- NEW
  readonly id: string;
}
```

---

## Step 7: Implement `resolveHALOperation()` in Framework Strategies

### 7.1 ArduinoStrategy

**File:** `packages/framework-arduino/src/strategy.ts`

```typescript
resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    // GPIO
    case "gpio.write":
      return { code: `digitalWrite(${op.pin}, ${op.value ? "HIGH" : "LOW"});` };
    case "gpio.read":
      return { expression: `digitalRead(${op.pin})` };
    case "gpio.toggle":
      return { expression: `(digitalRead(${op.pin}) == LOW ? HIGH : LOW)` };
    case "gpio.set_mode":
      return { code: `pinMode(${op.pin}, ${op.mode});` };

    // PWM
    case "pwm.write":
      return { code: `analogWrite(${op.pin}, ${op.duty});` };

    // ADC
    case "adc.read":
      return { expression: `analogRead(${op.pin})` };
    case "adc.set_reference":
      return { code: `analogReference(${op.reference});` };

    // Timing
    case "timing.delay":
      return { code: `delay(${op.ms});` };
    case "timing.delay_microseconds":
      return { code: `delayMicroseconds(${op.us});` };
    case "timing.millis":
      return { expression: `millis()` };
    case "timing.micros":
      return { expression: `micros()` };

    // Interrupts
    case "interrupt.attach":
      return { code: `attachInterrupt(${op.pin}, ${op.handler}, ${op.mode});` };
    case "interrupt.detach":
      return { code: `detachInterrupt(${op.pin});` };

    // I2C
    case "i2c.begin":
      return { code: `${op.bus}.begin(${op.address ?? ""});` };
    case "i2c.begin_transmission":
      return { code: `${op.bus}.beginTransmission(${op.address});` };
    case "i2c.write":
      return { code: `${op.bus}.write(${op.data});` };
    case "i2c.end_transmission":
      return { code: `${op.bus}.endTransmission(${op.stop});` };
    case "i2c.request_from":
      return { code: `${op.bus}.requestFrom(${op.address}, ${op.quantity}, ${op.stop});` };
    case "i2c.available":
      return { expression: `${op.bus}.available()` };
    case "i2c.read":
      return { expression: `${op.bus}.read()` };
    case "i2c.set_clock":
      return { code: `${op.bus}.setClock(${op.hz});` };
    case "i2c.end":
      return { code: `${op.bus}.end();` };

    // SPI
    case "spi.begin":
      return { code: `${op.bus}.begin();` };
    case "spi.transfer":
      return { expression: `${op.bus}.transfer(${op.data})` };
    case "spi.set_frequency":
      return { code: `${op.bus}.beginTransaction(SPISettings(${op.hz}, MSBFIRST, SPI_MODE0));` };
    case "spi.cs_low":
      return { code: `digitalWrite(${op.pin}, LOW);` };
    case "spi.cs_high":
      return { code: `digitalWrite(${op.pin}, HIGH);` };

    // UART
    case "uart.begin":
      return { code: `${op.port}.begin(${op.baud});` };
    case "uart.print":
      return { code: `${op.port}.print(${op.value});` };
    case "uart.println":
      return { code: `${op.port}.println(${op.value});` };
    case "uart.read":
      return { expression: `${op.port}.read()` };
    case "uart.available":
      return { expression: `${op.port}.available()` };
    case "uart.flush":
      return { code: `${op.port}.flush();` };

    // Tone
    case "tone.play":
      if (op.duration !== undefined) {
        return { code: `tone(${op.pin}, ${op.frequency}, ${op.duration});` };
      }
      return { code: `tone(${op.pin}, ${op.frequency});` };
    case "tone.stop":
      return { code: `noTone(${op.pin});` };

    // Pulse
    case "pulse.in":
      return { expression: `pulseIn(${op.pin}, ${op.value ? "HIGH" : "LOW"}${op.timeout !== undefined ? `, ${op.timeout}` : ""})` };

    // Shift
    case "shift.out":
      return { code: `shiftOut(${op.dataPin}, ${op.clockPin}, ${op.bitOrder}, ${op.value});` };
    case "shift.in":
      return { expression: `shiftIn(${op.dataPin}, ${op.clockPin}, ${op.bitOrder})` };

    // Board constants
    case "board.resolve":
      return { expression: this.renderBoardDefinitionAccess(op.path.split("."), undefined) };

    // Raw passthrough
    case "raw":
      return { code: op.code };

    // Snprintf string formatting
    case "snprintf.emit":
      return { code: `snprintf(${op.bufferName}, sizeof(${op.bufferName}), ${op.format}, ${op.args.join(", ")});` };

    default:
      return undefined; // fall through to default handling
  }
}
```

### 7.2 AvrNativeStrategy

**File:** `packages/framework-avr/src/strategy.ts`

Override `resolveHALOperation()` to produce native register access:

```typescript
resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "gpio.write": {
      const info = getPinInfo(op.pin);
      if (!info) return undefined;
      const mask = getPinBitMask(op.pin);
      return {
        code: op.value
          ? `${info.port} |= ${mask};`   // HIGH
          : `${info.port} &= ~${mask};`  // LOW
      };
    }
    case "gpio.read": {
      const info = getPinInfo(op.pin);
      if (!info) return undefined;
      const mask = getPinBitMask(op.pin);
      return { expression: `((${info.pinReg} & ${mask}) ? 1 : 0)` };
    }
    case "gpio.set_mode":
      return { code: nativePinMode(op.pin, op.mode) };
    case "adc.read":
      return { expression: nativeAnalogRead(op.pin) };

    // Delegate unhandled operations to parent (ArduinoStrategy)
    default:
      return super.resolveHALOperation?.(op);
  }
}
```

---

## Step 8: Modify the C++ Emitter

**File:** `packages/transpiler/src/emit/cpp-emitter.ts`

In the statement emission logic, handle `hal-op` and `hal-expr` IR nodes:

```typescript
function emitStatement(stmt: StatementIR, ...): string {
  // ... existing cases ...
  
  case "hal-op": {
    const op = stmt.operation;
    const resolved = strategy.resolveHALOperation?.(op);
    if (resolved?.code) {
      return resolved.code;
    }
    if (resolved?.expression) {
      return `${resolved.expression};`;
    }
    // Fallback: raw emission
    if (op.operation === "raw") {
      return (op as any).code;
    }
    return `/* unknown hal-op: ${op.operation} */`;
  }
}

function emitExpression(expr: ExpressionIR, ...): string {
  // ... existing cases ...
  
  case "hal-expr": {
    const op = expr.operation;
    const resolved = strategy.resolveHALOperation?.(op);
    if (resolved?.expression) {
      return resolved.expression;
    }
    return `/* unknown hal-expr: ${op.operation} */`;
  }
}
```

---

## Step 9: Migration Strategy — Backward Compatibility

To avoid breaking all existing code:

1. **Phase 1:** Add the new semantic functions to `emit.ts` alongside the old `emit()`. Add `HALOpIR` types. Add `hal-op` IR handling to the emitter.
2. **Phase 2:** Migrate HAL source files one module at a time (gpio.ts → i2c.ts → spi.ts → uart.ts → ...) from `emit()` to semantic functions.
3. **Phase 3:** Add `resolveHALOperation()` to ArduinoStrategy. Verify all tests pass.
4. **Phase 4:** Add native AVR operations to AvrNativeStrategy.
5. **Phase 5:** Remove old `emit()` support from the resolver and HAL source files once all tests pass with the new system.

The old `emit()` can coexist because:
- The `hal-resolver.ts` can check the function name: if it's `emit()`, use old path; if it's `gpioWrite()`/etc., use new path
- The emitter can handle both `__EMIT__` statement IR (old) and `hal-op` statement IR (new)

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `packages/core/src/shared/hal-op-ir.ts` | **NEW** — HAL operation IR type definitions |
| `packages/core/src/shared/ir-core.ts` | Add `hal-op` to StatementIR, `hal-expr` to ExpressionIR |
| `packages/core/src/shared/ir.ts` | Re-export HALOpIR |
| `packages/core/src/shared/platform-strategy.ts` | Add `PlatformHALStrategy.resolveHALOperation()` |
| `packages/hal/src/emit.ts` | Add semantic HAL operation function declarations |
| `packages/hal/src/gpio.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/i2c.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/spi.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/uart.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/adc.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/timing.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/pulse.ts` | Replace `emit()` calls with semantic functions |
| `packages/hal/src/shift.ts` | Replace `emit()` calls with semantic functions |
| `packages/transpiler/src/ir/hal-resolver.ts` | Parse semantic functions → produce HALOpIR |
| `packages/transpiler/src/ir/statement-to-ir.ts` | Build `hal-op` statements from HALOpIR |
| `packages/transpiler/src/emit/cpp-emitter.ts` | Dispatch `hal-op`/`hal-expr` to strategy |
| `packages/framework-arduino/src/strategy.ts` | Implement `resolveHALOperation()` |
| `packages/framework-avr/src/strategy.ts` | Override `resolveHALOperation()` for registers |
| `packages/framework-native/src/strategy.ts` | Implement `resolveHALOperation()` for hosted C++ |
