# MCU Package Implementation Plan

## Overview

Create a new `mcu-atmega328p` package that defines MCU pins by datasheet port name (`PB5`, `PC0`), includes the Arduino core pin mapping table (`PB5 → 13`), and refactor `board-arduino-uno` to consume it. The HAL layer gains port-name awareness, and `framework-arduino` reads the pin map from the MCU package.

---

## Phase 1: `mcu-atmega328p` Package (New)

### 1.1 Package scaffold
Create `packages/mcu-atmega328p/` with:
- `package.json` — name `@typehal/mcu-atmega328p`, dependencies: `@typehal/core`, `@typehal/schema`, `@typehal/hal`
- `tsconfig.json` — standard build config (mirror `board-arduino-uno/tsconfig.json`)
- `src/index.ts` — barrel + MCU definition manifest
- `src/pins.ts` — pin exports using `Pin.fromPort()`
- `src/arduino-map.ts` — Arduino pin mapping table from `pins_arduino.h`

### 1.2 `src/pins.ts` — Datasheet pin definitions
```typescript
import { Pin } from '@typehal/hal';

// Port D (PD0-PD7)
export const PD0 = Pin.fromPort('PD0');
export const PD1 = Pin.fromPort('PD1');
export const PD2 = Pin.fromPort('PD2');
export const PD3 = Pin.fromPort('PD3');
export const PD4 = Pin.fromPort('PD4');
export const PD5 = Pin.fromPort('PD5');
export const PD6 = Pin.fromPort('PD6');
export const PD7 = Pin.fromPort('PD7');

// Port B (PB0-PB7)
export const PB0 = Pin.fromPort('PB0');
export const PB1 = Pin.fromPort('PB1');
export const PB2 = Pin.fromPort('PB2');
export const PB3 = Pin.fromPort('PB3');
export const PB4 = Pin.fromPort('PB4');
export const PB5 = Pin.fromPort('PB5');
export const PB6 = Pin.fromPort('PB6');
export const PB7 = Pin.fromPort('PB7');

// Port C (PC0-PC6)
export const PC0 = Pin.fromPort('PC0');
export const PC1 = Pin.fromPort('PC1');
export const PC2 = Pin.fromPort('PC2');
export const PC3 = Pin.fromPort('PC3');
export const PC4 = Pin.fromPort('PC4');
export const PC5 = Pin.fromPort('PC5');
export const PC6 = Pin.fromPort('PC6');
```

### 1.3 `src/arduino-map.ts` — Arduino core pin mapping
```typescript
/**
 * Arduino core pin mapping for ATmega328P.
 * Source: Arduino AVR core, variants/standard/pins_arduino.h
 */
export const ARDUINO_PIN_MAP: Record<string, number> = {
  PD0: 0,  PD1: 1,  PD2: 2,  PD3: 3,
  PD4: 4,  PD5: 5,  PD6: 6,  PD7: 7,
  PB0: 8,  PB1: 9,  PB2: 10, PB3: 11,
  PB4: 12, PB5: 13,
  PC0: 14, PC1: 15, PC2: 16, PC3: 17,
  PC4: 18, PC5: 19,
};

export const ARDUINO_ANALOG_OFFSET = 14;

/** Reverse map: Arduino pin number → MCU port name */
export const ARDUINO_PIN_REVERSE: Record<number, string> = {};
for (const [port, num] of Object.entries(ARDUINO_PIN_MAP)) {
  ARDUINO_PIN_REVERSE[num] = port;
}
```

### 1.4 `src/index.ts` — MCU definition manifest (subset)
Extract only the MCU-level data from the current `board-arduino-uno/src/index.ts`:

```typescript
import type { MCUDefinition } from '@typehal/schema';

export const ATmega328P = {
  id: 'atmega328p',
  name: 'ATmega328P',
  family: 'avr',
  memory: { flash: 32768, sram: 2048, eeprom: 1024 },
  peripherals: {
    timers: [
      { instance: 0, type: 'sys', bits: 8, features: ['pwm', 'interrupt'], frequency: 16000000 },
      { instance: 1, type: 'general', bits: 16, features: ['pwm', 'interrupt', 'capture', 'compare'], frequency: 16000000 },
      { instance: 2, type: 'general', bits: 8, features: ['pwm', 'interrupt'], frequency: 16000000 },
    ],
    adc: [{ instance: 0, channels: 6, resolution: 10, maxValue: 1023, referenceVoltage: 5.0 }],
    // ... extracted from current index.ts
  },
  frameworkPinMaps: {
    arduino: {
      pinMap: ARDUINO_PIN_MAP,
      reverseMap: ARDUINO_PIN_REVERSE,
      analogOffset: ARDUINO_ANALOG_OFFSET,
    },
  },
};

export * from './pins';
export * from './arduino-map';
```

---

## Phase 2: HAL Layer Changes

### 2.1 `packages/hal/src/gpio.ts` — `Pin.fromPort()` static factory

Add a static factory method to `Pin`:

```typescript
export class Pin {
  private _port: string;      // "PB5" — canonical MCU port identity
  private _pin: number;       // framework pin number (set by transpiler)
  readonly port: string;
  readonly number: number;
  readonly gpio: number;

  /** Legacy constructor (backward compatible during migration) */
  constructor(pin: number) {
    this._pin = pin;
    this._port = '';          // unknown port
    this.number = pin;
    this.gpio = pin;
    this.port = '';
  }

  /** Create a Pin from its MCU port name (datasheet identifier) */
  static fromPort(port: string): Pin {
    const p = new Pin(-1);
    (p as any)._port = port;
    (p as any).port = port;
    return p;
  }

  // Methods use this._port when available, falling back to this._pin:
  high(): void { gpioWrite(this._port || String(this._pin), 1); }
  low(): void  { gpioWrite(this._port || String(this._pin), 0); }
  // ... same pattern for all methods
}
```

**Key insight**: The `_port` field stores the string port name. The transpiler's `resolveExpressionText()` resolves `this._port` to `"PB5"` from the instance's `fieldValues` map. The `_pin` field stores the legacy number. When `_port` is empty (`''`), the method falls back to `_pin` for backward compatibility.

### 2.2 `packages/hal/src/emit.ts` — `gpioWrite` signature

Change the first parameter type from `pin: number` to `pin: string | number`:

```typescript
/** Set a digital pin HIGH or LOW. pin is the MCU port name (e.g., "PB5") or legacy number. */
export declare function gpioWrite(pin: string | number, value: number): void;
export declare function gpioRead(pin: string | number): number;
export declare function gpioToggle(pin: string | number): void;
export declare function gpioSetMode(pin: string | number, mode: string): void;
export declare function pwmWrite(pin: string | number, duty: number): void;
export declare function adcRead(pin: string | number): number;
export declare function adcReadVoltage(pin: string | number): number;
export declare function tonePlay(pin: string | number, frequency: number, duration?: number): void;
export declare function toneStop(pin: string | number): void;
// ... all pin-using functions
```

The transpiler's HAL resolver already handles `this._port` → string value resolution. The `resolveNumericArg` function will need a `resolvePortArg` variant that returns a string.

---

## Phase 3: HALOpIR Types

### 3.1 `packages/core/src/shared/hal-op-ir.ts` — Add `port` field

Add an optional `port` field to every pin-carrying IR interface:

```typescript
export interface GpioWriteOp {
  operation: "gpio.write";
  port?: string;    // "PB5" — canonical MCU port name
  pin: number;      // legacy framework pin number
  value: 0 | 1;
}

export interface GpioReadOp {
  operation: "gpio.read";
  port?: string;
  pin: number;
}
// ... same for GpioToggleOp, GpioSetModeOp, PwmWriteOp, AdcReadOp,
//     AdcReadVoltageOp, InterruptAttachOp, InterruptDetachOp,
//     TonePlayOp, ToneStopOp, PulseInOp, PulseInLongOp, etc.
```

The `port` field is optional for backward compatibility. During migration, the transpiler emits both `port` and `pin`. Framework strategies can prefer `port` when available.

---

## Phase 4: Transpiler `hal-resolver.ts` Changes

### 4.1 `resolveExpressionText()` — Handle `this._port`

In `resolveExpressionText()` (line ~430), when resolving `this._port`, look up `_port` in `instance.fieldValues`. Already works because the generic path at line ~445 does `instance.fieldValues.get(fieldName)`.

### 4.2 `tryResolveSemanticCall()` — Produce port-based HALOpIR

For GPIO calls, resolve the pin argument as a string (port name) first:

```typescript
case "gpioWrite": {
  const port = resolvePortFromArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
  const pinNum = resolveNumericArg(args, 0, instance, paramNames, callArgTexts, paramDefaults);
  const value = resolveNumericArg(args, 1, instance, paramNames, callArgTexts, paramDefaults);
  if ((port === null && pinNum === null) || value === null) return null;
  return {
    operation: "gpio.write",
    port: port ?? undefined,
    pin: pinNum ?? -1,
    value: (value ? 1 : 0) as 0 | 1,
  };
}
```

Add a `resolvePortFromArg()` helper that returns a string (port name) or null:

```typescript
function resolvePortFromArg(
  args: readonly ts.Expression[],
  idx: number,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults: Map<string, string> | undefined,
): string | null {
  const arg = args[idx];
  if (!arg) return null;
  
  // this._port → look up in instance field values
  if (ts.isPropertyAccessExpression(arg) &&
      arg.expression.kind === ts.SyntaxKind.ThisKeyword &&
      arg.name.text === '_port') {
    const val = instance.fieldValues.get('_port');
    if (val && val !== '') return val;
    return null;
  }
  
  // String literal: "PB5"
  if (ts.isStringLiteral(arg)) return arg.text;
  
  return null;
}
```

### 4.3 `resolveHALReceiver()` — Handle `Pin.fromPort()` and bare names via reverse map

**For `Pin.fromPort("PB5")`**: Already handled by the generic `resolveCtorFieldValues` path — the field mapping `_port → "PB5"` is stored from the constructor `this._port = port`. No change needed.

**For bare `D13` / `A0` names** — use the MCU package's reverse map:

```typescript
// CURRENT (line 291):
const dMatch = name.match(/^D(\d+)$/);
if (dMatch) {
  const inst = { className: "Pin", fieldValues: new Map([["_pin", dMatch[1]]]) };
}

// NEW:
const dMatch = name.match(/^D(\d+)$/);
if (dMatch) {
  const arduinoPin = parseInt(dMatch[1]);
  const reverseMap = getCurrentMCUPinReverseMap(); // from board constants
  const portName = reverseMap?.[arduinoPin] as string | undefined;
  if (portName) {
    const inst = {
      className: "Pin",
      fieldValues: new Map([["_port", portName], ["_pin", String(arduinoPin)]])
    };
    halInstances.set(name, inst);
    return inst;
  }
  // Fallback to legacy numeric
  const inst = { className: "Pin", fieldValues: new Map([["_pin", dMatch[1]]]) };
  halInstances.set(name, inst);
  return inst;
}
```

Same pattern for `A0`-`A5`.

### 4.4 `board-resolver.ts` — Load MCU pin map from MCU package

When the board definition is loaded, also load the MCU package if referenced. Add a new export:

```typescript
export function getMCUPinReverseMap(boardPackage: string, configPath: string): Record<number, string> | undefined {
  // 1. Parse the board definition file to find `mcu` field
  // 2. Resolve the MCU package from node_modules
  // 3. Read the arduino-map.ts file
  // 4. Return ARDUINO_PIN_REVERSE
}
```

---

## Phase 5: Arduino Strategy Changes

### 5.1 `framework-arduino/src/strategy.ts` — Use `port` for pin resolution

```typescript
resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "gpio.write": {
      const pin = this.resolvePinNum(op);
      return { code: `digitalWrite(${pin}, ${op.value ? "HIGH" : "LOW"});` };
    }
    case "gpio.read": {
      const pin = this.resolvePinNum(op);
      return { expression: `digitalRead(${pin})` };
    }
    // ... all pin-carrying operations
  }
}

/** Resolve pin number from HALOpIR, preferring port lookup */
private resolvePinNum(op: { port?: string; pin: number }): number {
  if (op.port) {
    const mcuPinMap = this.getMCUPinMap(); // loaded from MCU package
    const num = mcuPinMap?.[op.port];
    if (num !== undefined) return num;
  }
  return op.pin; // fallback to legacy number
}

private getMCUPinMap(): Record<string, number> | undefined {
  // The MCU package's arduino-map is loaded alongside the board definition
  // and stored in a strategy-level cache
  if (this._mcuPinMap) return this._mcuPinMap;
  // Load from MCU package...
}
```

---

## Phase 6: `board-arduino-uno` Updates

### 6.1 `pins.ts` — Import from MCU, add aliases

```typescript
// Import datasheet pins from MCU package
import {
  PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7,
  PB0, PB1, PB2, PB3, PB4, PB5,
  PC0, PC1, PC2, PC3, PC4, PC5,
} from '@typehal/mcu-atmega328p';

// Board-specific aliases (wiring)
export const LED  = PB5;
export const SDA  = PC4;
export const SCL  = PC5;
export const MOSI = PB3;
export const MISO = PB4;
export const SCK  = PB5;
export const SS   = PB2;
export const TX   = PD1;
export const RX   = PD0;

// Arduino-style pin aliases (D0-D13, A0-A5)
export const D0  = PD0;  export const D1  = PD1;
export const D2  = PD2;  export const D3  = PD3;
export const D4  = PD4;  export const D5  = PD5;
export const D6  = PD6;  export const D7  = PD7;
export const D8  = PB0;  export const D9  = PB1;
export const D10 = PB2;  export const D11 = PB3;
export const D12 = PB4;  export const D13 = PB5;
export const A0  = PC0;  export const A1  = PC1;
export const A2  = PC2;  export const A3  = PC3;
export const A4  = PC4;  export const A5  = PC5;

// Re-export from MCU (backward compat)
export { PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7,
         PB0, PB1, PB2, PB3, PB4, PB5,
         PC0, PC1, PC2, PC3, PC4, PC5 };
```

### 6.2 `index.ts` — Reference MCU package in BoardDefinition

```typescript
export const ArduinoUno: BoardDefinition = {
  id: 'arduino-uno',
  name: 'Arduino Uno',
  vendor: 'Arduino',
  description: 'Arduino Uno Rev3 — ATmega328P',
  architecture: 'avr',
  mcu: 'ATmega328P',
  mcuPackage: '@typehal/mcu-atmega328p',  // NEW: reference to MCU package
  clockSpeed: 16_000_000,
  memory: { flash: 32768, sram: 2048, eeprom: 1024 },
  // ... rest unchanged (pins, peripherals, features, build)
};
```

### 6.3 `package.json` — Add dependency
```json
"dependencies": {
  "@typehal/core": "*",
  "@typehal/schema": "*",
  "@typehal/hal": "*",
  "@typehal/mcu-atmega328p": "*"
}
```

---

## Phase 7: Demo Project Updates

### 7.1 `demo/package.json` — Add MCU dependency
```json
"dependencies": {
  "@typehal/core": "*",
  "@typehal/hal": "*",
  "@typehal/board-arduino-uno": "*",
  "@typehal/framework-arduino": "*",
  "@typehal/mcu-atmega328p": "*"
}
```

### 7.2 `demo/typehal-env.d.ts` — Update re-export
```typescript
declare module '@typehal' {
  export * from '@typehal/board-arduino-uno';
}
// (unchanged — still re-exports from board package)
```

### 7.3 `demo/src/sketch.ts` — Use port-name imports (optional)
The sketch can still use `D2`, `D4`, `D9`, `LED` — these are re-exported from `board-arduino-uno` which now re-exports from `mcu-atmega328p`. The sketch itself doesn't need to change.

Optional: Demonstrate using MCU port names directly:
```typescript
import { PB5, UART0 } from '@typehal';
const led = PB5.asOutput(false); // "PB5" instead of "LED" or "D13"
```

---

## Phase 8: Root Workspace Registration

### 8.1 `package.json` — Add workspace
```json
"workspaces": [
  "packages/mcu-atmega328p",
  // ... existing
]
```

---

## Migration Impact Analysis

### What breaks
- **Bare `D13`/`A0` resolution**: Now goes through reverse map instead of direct number. Same result for ATmega328P.
- **`Pin` constructor signature**: Constructor still accepts `number` for backward compat. `fromPort()` is the new preferred API.
- **Board definition `index.ts`**: Added `mcuPackage` field — existing parsers ignore unknown fields.

### What doesn't break
- All existing HAL class methods (`high()`, `write()`, `pwm()`) keep same signatures
- Arduino strategy continues emitting `digitalWrite(pin, val)` with same pin numbers
- `I2C`, `SPI`, `UART` peripheral usage unchanged
- Board manifest constants unchanged
- Test suite: pin validation tests should pass unchanged (same pin capabilities, same pin numbers from Arduino strategy)

### Test areas to watch
- `tests/hal-direct-gpio.test.ts` — may need updates if tests create `Pin` with numbers
- `tests/gpio-object-creation.test.ts` — may need `fromPort()` test cases
- `tests/pin-safety.test.ts` — pin names in constants are now port names
- `tests/pin-alias-conflict.test.ts` — alias resolution may change
- `tests/peripheral-*.test.ts` — peripheral pin pinouts come from board definition, unchanged

---

## Implementation Order

1. **Create `mcu-atmega328p` package** (Phase 1) — purely additive
2. **Update HALOpIR types** (Phase 3) — add optional `port` fields
3. **Update `hal/gpio.ts` Pin class** (Phase 2.1) — add `fromPort()`, `_port` field
4. **Update `hal/emit.ts` signatures** (Phase 2.2) — widen to `string | number`
5. **Update `hal-resolver.ts`** (Phase 4) — port resolution, bare-name via reverse map
6. **Update `framework-arduino/strategy.ts`** (Phase 5) — use `port` for pin mapping
7. **Update `board-arduino-uno`** (Phase 6) — import from MCU, add dep
8. **Update demo project** (Phase 7)
9. **Register in root workspace** (Phase 8)
10. **Build and test** — `npm run build && npm test`
