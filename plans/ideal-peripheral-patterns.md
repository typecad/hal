# Ideal GPIO & Peripheral Access Patterns

## Overview

This plan establishes two access patterns across the TypeCode HAL:

1. **Object-Creation for GPIO** — `const led = LED.asOutput()` returns a type-narrowed pin object with mode-specific methods. One call configures mode AND provides type safety.
2. **Opt-In Ownership for Shared Buses** — `SPI0.take()` / `SPI0.release()` provides exclusive access for multi-threaded contention on SPI/I2C buses.

## Current State

### What Already Works
- `IOutputModePin` / `IInputModePin` interfaces exist in `packages/core/src/types/pin.ts`
- `BasePin.asOutput()` / `asInput()` / `asInputPullUp()` return these types
- Transpiler diagnostic `pin-mode-validation.ts` warns on unconfigured pin I/O
- Peripheral `.begin()` pattern works: `UART0.begin(9600)` → `ISerialPort`

### What's Missing
- `asOutput()`/`asInput()` have **no C++ emission** — not in `typecode-map.ts` or `strategy.ts`
- Transpiler has **no variable alias tracking** — `const led = LED.asOutput()` creates a variable `led` but `led.toggle()` is emitted as a raw call, not a typecode-call
- No ownership primitives for shared bus peripherals

---

## Part 1: GPIO Object-Creation Pattern

### Goal

```typescript
// Before (current)
LED.output(HIGH);
while (true) { LED.toggle(); delay(1000); }

// After (ideal)
const led = LED.asOutput(HIGH);
while (true) { led.toggle(); delay(1000); }
```

The `asOutput()` call emits `pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, HIGH)` in C++. The returned `led` variable is tracked as an alias for `LED` so that `led.toggle()` emits `digitalWrite(LED_BUILTIN, ...)` correctly.

### Step 1.1: Add `asOutput`/`asInput`/`asInputPullUp` to Typecode Map

**File:** `packages/framework-arduino/src/typecode-map.ts`

Add cases in `renderArduinoBuiltin()` for each receiver kind (`digital`, `pwm`, `interrupt`):

```typescript
case 'asOutput':
  if (args.length > 0) {
    return `pinMode(${pin}, OUTPUT); digitalWrite(${pin}, ${a(0)})`;
  }
  return `pinMode(${pin}, OUTPUT)`;
case 'asInput':
  return `pinMode(${pin}, INPUT)`;
case 'asInputPullUp':
  return `pinMode(${pin}, INPUT_PULLUP)`;
```

Also add to `packages/framework-avr/src/strategy.ts` for native AVR emission using `nativePinMode()`.

### Step 1.2: Variable Alias Tracking in IR Builder

**File:** `packages/cli/src/ir/build-ir.ts`

When the IR builder encounters a `var_decl` whose initializer is a `typecode-call` with method `asOutput`/`asInput`/`asInputPullUp`, it must record an alias mapping:

```
variableName → originalReceiver
```

For example: `const led = LED.asOutput()` records `led → LED`.

Then, when subsequent code uses `led.toggle()`, the builder resolves `led` back to `LED` and generates a proper `typecode-call` IR node with `receiver: "LED"` instead of a raw call.

**Implementation approach:**
- Add a `pinAliases: Map<string, string>` to the expression context (alongside existing `pointerVars`)
- In `expressionToIR()`, when processing a `CallExpression` like `LED.asOutput()` that returns a typecode-call, also check if the parent node is a variable declaration
- In `callToStatement()`, when the callee is an identifier that exists in `pinAliases`, substitute the alias and generate a `typecode-call` instead of a raw `call`
- The alias map flows through `lowerStatement()` / `variableStatementToIR()` which already handle `localVariableTypes` and `pointerVars`

### Step 1.3: Update Pin Mode Validation for Aliases

**File:** `packages/cli/src/ir/pin-mode-validation.ts`

When `checkTypecodeCall()` encounters a receiver that's in the alias map, resolve it to the original pin name before checking the `pinModeSet`. This ensures:

```typescript
const led = LED.asOutput();  // marks "LED" as mode-set
led.toggle();                 // resolves to "LED" → no warning
```

### Step 1.4: Update Examples

Update examples to demonstrate the new pattern:

- `examples/01-blink.ts` → use `LED.asOutput()`
- `examples/04-interrupt.ts` → use `D2.asInput()`
- `demo/src/sketch.ts` → use object-creation pattern
- Add new example `examples/01b-blink-object.ts` showing both patterns side-by-side

### Step 1.5: Tests

- Add test: `const led = LED.asOutput(); led.toggle()` emits `pinMode` + `digitalWrite`
- Add test: `const d3 = D3.asInput(); d3.read()` emits `pinMode(INPUT)` + `digitalRead`
- Add test: alias tracking — `led.toggle()` resolves to correct pin
- Add test: pin-mode-validation recognizes aliases — no false warnings
- Add test: `asOutput(HIGH)` emits both `pinMode` and `digitalWrite`

---

## Part 2: Opt-In Ownership for Shared Bus Peripherals

### Goal

```typescript
// Multi-threaded SPI usage (ESP32 with FreeRTOS)
const spi = SPI0.take();
if (spi) {
  spi.beginTransaction({ mode: 0, frequency: 1000000 });
  spi.transfer(data);
  spi.endTransaction();
  spi.release();
}
```

This is **opt-in** — the existing `SPI0.begin()` pattern continues to work for single-threaded use. Ownership is only needed when multiple tasks share a bus.

### Step 2.1: Ownership Type Interfaces

**File:** `packages/core/src/bus/spi.ts`

Add ownership wrapper types:

```typescript
/** Owned SPI bus — obtained via SPI0.take(), released via release() */
export interface IOwnedSPIBus extends ISPIBus {
  /** Release exclusive ownership back to the free bus. */
  release(): void;
}
```

**File:** `packages/core/src/bus/i2c.ts`

```typescript
/** Owned I2C bus — obtained via I2C0.take(), released via release() */
export interface IOwnedI2CBus extends II2CBus {
  /** Release exclusive ownership back to the free bus. */
  release(): void;
}
```

**File:** `packages/core/src/bus/uart.ts`

```typescript
/** Owned serial port — obtained via UART0.take(), released via release() */
export interface IOwnedSerialPort extends ISerialPort {
  /** Release exclusive ownership. */
  release(): void;
}
```

### Step 2.2: Add `take()` to Uninitialized Bus Interfaces

Add `take()` method to each uninitialized bus interface:

```typescript
// IUninitializedSPIBus
take(): IOwnedSPIBus | undefined;

// IUninitializedI2CBus  
take(): IOwnedI2CBus | undefined;

// IUninitializedUARTBus
take(): IOwnedSerialPort | undefined;
```

The `| undefined` return forces users to check ownership before proceeding.

### Step 2.3: Transpiler Emission for take/release

**File:** `packages/framework-arduino/src/typecode-map.ts`

Add cases for `take` and `release`:

```typescript
// In the 'spi' receiver kind section:
case 'take':
  return `/* SPI0 take: mutex acquire */`;  // Arduino Uno: no-op (single-threaded)
case 'release':
  return `/* SPI0 release: mutex release */`;
```

**File:** `packages/framework-avr/src/strategy.ts`

For AVR (single-threaded), `take()` is a simple boolean check:

```cpp
static bool _spi0_owned = false;
// take() → (!_spi0_owned && (_spi0_owned = true))
// release() → (_spi0_owned = false)
```

**File:** `packages/framework-arduino/src/profile.ts` or a new polyfill

For ESP32/FreeRTOS, generate mutex-based guards:

```cpp
static SemaphoreHandle_t _spi0_mutex = nullptr;
// take() → xSemaphoreTake(_spi0_mutex, 0) == pdTRUE
// release() → xSemaphoreGive(_spi0_mutex)
```

### Step 2.4: Transpiler Diagnostic for Ownership Violations

**File:** `packages/cli/src/ir/peripheral-ownership.ts` (new file)

Similar to `pin-mode-validation.ts`, scan typecode-calls in execution order:

```typescript
const BUS_RECEIVER_KINDS = new Set(['spi', 'i2c', 'serial']);

export function validatePeripheralOwnership(program: ProgramIR): Diagnostic[] {
  const ownedBuses = new Set<string>();
  
  // Scan all typecode-calls in execution order
  // If take() is called, mark bus as owned
  // If release() is called, mark bus as free
  // If I/O method called on un-owned bus → warning
  // If take() called on already-owned bus → error
}
```

Wire into `build-ir.ts` alongside existing validation passes.

### Step 2.5: Tests

- Add test: `SPI0.take()` generates mutex acquire on ESP32
- Add test: `SPI0.take()` generates boolean flag on AVR
- Add test: `spi.release()` generates mutex/flag release
- Add test: ownership diagnostic warns on I/O without take
- Add test: ownership diagnostic errors on double take
- Add test: ownership diagnostic clears on release

---

## Implementation Order

```
Phase 1: GPIO Object-Creation (core value, no breaking changes)
  Step 1.1 → typecode-map emission for asOutput/asInput/asInputPullUp
  Step 1.2 → variable alias tracking in IR builder
  Step 1.3 → update pin-mode-validation for aliases
  Step 1.5 → tests for all above
  Step 1.4 → update examples (after tests pass)

Phase 2: Bus Ownership (opt-in, additive only)
  Step 2.1 → ownership type interfaces in core
  Step 2.2 → take() on uninitialized bus interfaces
  Step 2.3 → transpiler emission for take/release
  Step 2.4 → ownership validation diagnostic
  Step 2.5 → tests for all above
```

## Files Modified

| File | Change |
|------|--------|
| `packages/framework-arduino/src/typecode-map.ts` | Add asOutput/asInput/asInputPullUp cases; add take/release cases |
| `packages/framework-avr/src/strategy.ts` | Add native AVR emission for asOutput/asInput; add take/release |
| `packages/cli/src/ir/build-ir.ts` | Add pinAliases tracking in expression context |
| `packages/cli/src/ir/pin-mode-validation.ts` | Resolve aliases before checking pinModeSet |
| `packages/core/src/bus/spi.ts` | Add IOwnedSPIBus, take() on IUninitializedSPIBus |
| `packages/core/src/bus/i2c.ts` | Add IOwnedI2CBus, take() on IUninitializedI2CBus |
| `packages/core/src/bus/uart.ts` | Add IOwnedSerialPort, take() on IUninitializedUARTBus |
| `packages/cli/src/ir/peripheral-ownership.ts` | New: ownership validation diagnostic |
| `examples/01-blink.ts` | Update to object-creation pattern |
| `demo/src/sketch.ts` | Update to object-creation pattern |
| `tests/pin-mode-validation.test.ts` | Add alias tracking tests |
| `tests/peripheral-ownership.test.ts` | New: ownership validation tests |

## Backward Compatibility

- **Phase 1** is fully backward compatible. The existing `LED.output(); LED.toggle()` pattern continues to work. The object-creation pattern is additive.
- **Phase 2** is fully backward compatible. `take()`/`release()` are new methods. The existing `SPI0.begin()` pattern is unchanged. Ownership is opt-in.
- The transpiler diagnostic for pin-mode-not-set continues to fire for the old pattern, providing a migration hint.
