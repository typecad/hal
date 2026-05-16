# Plan: Complete HAL-to-Semantic Migration

## Overview

**Goal:** Eliminate all remaining `emit()` calls from HAL source files, replacing them with semantic HALOpIR function calls that flow through the resolver → strategy pipeline.

**Current state:** 43 methods migrated, ~86 `emit()` calls remaining across 16 HAL files.
**Target state:** Zero `emit()` calls in HAL source files (except `emit.ts` declaration itself).

---

## Prerequisite: Resolver Infrastructure Changes

Four changes to [`packages/transpiler/src/ir/hal-resolver.ts`](../packages/transpiler/src/ir/hal-resolver.ts) unlock the vast majority of remaining migrations.

### R1. Boolean support in `resolveNumericArg`

**File:** [`hal-resolver.ts:667-679`](../packages/transpiler/src/ir/hal-resolver.ts)
**Impact:** Unblocks 4 methods (`OutputPin.write`, `Pin.write`, `Pin.asOutput(initial?)`, `Pin.output(initial?)`)

Current code:
```ts
function resolveNumericArg(...): number | null {
  const text = resolveSemanticArg(...);
  if (text === null) return null;
  const n = Number(text);
  return isNaN(n) ? null : n;
}
```

Fix — add boolean coercion before `Number()`:
```ts
function resolveNumericArg(...): number | null {
  const text = resolveSemanticArg(...);
  if (text === null) return null;
  if (text === "true") return 1;
  if (text === "false") return 0;
  const n = Number(text);
  return isNaN(n) ? null : n;
}
```

### R2. Return expression from semantic calls

**File:** [`hal-resolver.ts:1147-1153`](../packages/transpiler/src/ir/hal-resolver.ts) + [`packages/transpiler/src/ir/statement-to-ir.ts`](../packages/transpiler/src/ir/statement-to-ir.ts)
**Impact:** Unblocks ~30 methods that use `emit("return EXPR")` pattern

**Problem:** When a HAL method body contains `return adcRead(this._pin)`, the resolver's return handler calls `resolveExpressionText()` which doesn't know about semantic functions — it would produce the meaningless string `"adcRead(13)"` instead of routing through the strategy.

**Design:**

1. Add `returnHalOpIndex?: number` to `processHALMethodBody`'s return type (line 991)

2. Before the existing return handler (line 1147), add a semantic call check:
```ts
// return semanticCall(args) — produce HALOpIR and mark as expression return
if (ts.isReturnStatement(stmt) && stmt.expression && returnValue === undefined) {
  const retExpr = stmt.expression;
  if (ts.isCallExpression(retExpr) && ts.isIdentifier(retExpr.expression)) {
    // Extract callbacks from arguments
    for (const arg of retExpr.arguments) {
      extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts);
    }
    const semanticOp = tryResolveSemanticCall(
      retExpr.expression.text,
      retExpr.arguments,
      instance, paramNames, callArgTexts, paramDefaults,
    );
    if (semanticOp) {
      halOps.push(semanticOp);
      returnHalOpIndex = halOps.length - 1;
      continue;
    }
  }
  // Fall through to existing resolveExpressionText handler
}
```

3. In the consumers of `processHALMethodBody` result (in [`statement-to-ir.ts`](../packages/transpiler/src/ir/statement-to-ir.ts)):
   - `tryResolveHALMethod` (line 98)
   - `resolveHALCallForVarInit` (line 260)
   - `tryResolveHALExpression` (line 370)

   When `returnHalOpIndex !== undefined`, create a `{ kind: "hal-expr", op: halOps[returnHalOpIndex] }` ExpressionIR node for the return value. The expression renderer already handles `hal-expr` at [line 210](../packages/transpiler/src/emit/expression-renderer.ts) — it calls `strategy.resolveHALOperation(op)` and returns the `expression` field.

### R3. Semantic calls in `processStatementList`

**File:** [`hal-resolver.ts:1213-1247`](../packages/transpiler/src/ir/hal-resolver.ts)
**Impact:** Unblocks 4 methods with if-blocks containing emit calls

**Problem:** `processStatementList` only handles `emit()` and `include()` — not semantic function calls. Methods like `Pin.asOutput(initial?)` have `if (initial !== undefined) { emit(...) }` inside if-blocks.

**Design:**

1. Add `halOps: HALOpIR[]` and `callArgs: ExpressionIR[]` parameters to `processStatementList`

2. Extend the call handler to try semantic resolution:
```ts
function processStatementList(
  stmts: readonly ts.Statement[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  emitLines: string[],
  halOps: HALOpIR[],          // NEW
  callArgs: ExpressionIR[],   // NEW
  paramDefaults: Map<string, string>,
  returnExpr?: { value: string },
): void {
  for (const stmt of stmts) {
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (ts.isIdentifier(call.expression)) {
        if (call.expression.text === "emit") {
          // ... existing emit handling ...
        } else if (call.expression.text === "include") {
          // ... existing include handling ...
        } else {
          // NEW: Try semantic HAL function call
          for (const arg of call.arguments) {
            extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts);
          }
          const semanticOp = tryResolveSemanticCall(
            call.expression.text, call.arguments,
            instance, paramNames, callArgTexts, paramDefaults,
          );
          if (semanticOp) {
            halOps.push(semanticOp);
          }
        }
      }
    }
  }
}
```

3. Update the call site in `processHALMethodBody` (line 1138) to pass `halOps` and `callArgs`.

### R4. If-condition evaluation for compile-time constants

**File:** [`hal-resolver.ts:1134-1145`](../packages/transpiler/src/ir/hal-resolver.ts)
**Impact:** Unblocks `Power.deepSleep()`, `Power.lightSleep()` (if-blocks with `board("architecture")` checks)

**Problem:** The resolver always processes the then-statement of if-blocks without evaluating the condition. For `if (arch === "esp32") { emit(...) }`, both branches' emit calls are processed regardless of the actual architecture.

**Design:** Add basic condition evaluation before processing if-blocks:

```ts
if (ts.isIfStatement(stmt)) {
  // Try to evaluate the condition at compile time
  let conditionTrue = true; // default: process both branches
  if (stmt.expression && ts.isBinaryExpression(stmt.expression)) {
    const left = resolveExpressionText(stmt.expression.left, ...);
    const right = resolveExpressionText(stmt.expression.right, ...);
    const op = stmt.expression.operatorToken.kind;
    if (left !== null && right !== null) {
      if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        conditionTrue = left === right;
      } else if (op === ts.SyntaxKind.ExclamationEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        conditionTrue = left !== right;
      }
    }
  }

  if (conditionTrue && stmt.thenStatement) {
    processStatementList(/* then branch */, halOps, callArgs, ...);
  }
  if (!conditionTrue && stmt.elseStatement) {
    processStatementList(/* else branch */, halOps, callArgs, ...);
  }
  continue;
}
```

**Note:** This is a nice-to-have. If not implemented, `Power.deepSleep()` and `Power.lightSleep()` can use `rawCpp()` instead.

---

## Phase 1: Complete GPIO Migration

**File:** [`packages/hal/src/gpio.ts`](../packages/hal/src/gpio.ts)
**Prerequisites:** R1 (booleans), R2 (return expressions), R3 (if-block semantic calls)
**Remaining emit() calls:** 9

| Method | Current emit() | Migration | Resolver Dependency |
|--------|---------------|-----------|-------------------|
| `OutputPin.write(value)` | `emit(\`digitalWrite(${this._pin}, ${value});\`)` | `gpioWrite(this._pin, value)` | R1 (boolean value) |
| `OutputPin.pulse(durationMs)` | 3× emit (HIGH, delay, LOW) | `gpioWrite(this._pin, 1); delayMicro(durationMs * 1000); gpioWrite(this._pin, 0)` | None |
| `OutputPin.pwm(percent)` | `emit(\`analogWrite(${this._pin}, ${percent} * ((1 << ${board(...)}) - 1) / 100);\`)` | `pwmWrite(this._pin, percent * ((1 << boardResolve("peripherals.pwm.resolution")) - 1) / 100)` | None (boardResolve resolves at compile time) |
| `InputPin.readAnalog()` | `emit(\`return analogRead(${this._pin});\`)` | `return adcRead(this._pin)` | R2 (return expr) |
| `InputPin.readVoltage()` | `emit(\`return analogRead(...) * ... / ...;\`)` | `return adcReadVoltage(this._pin)` | R2 (return expr) |
| `InputPin.waitForRising(timeout?)` | `emit(\`__typehal_wait_pin_edge(...)\`)` | `rawCpp(\`__typehal_wait_pin_edge(${this._pin}, RISING, ${timeout ?? -1})\`)` | None |
| `InputPin.waitForFalling(timeout?)` | `emit(\`__typehal_wait_pin_edge(...)\`)` | `rawCpp(\`__typehal_wait_pin_edge(${this._pin}, FALLING, ${timeout ?? -1})\`)` | None |
| `Pin.asOutput(initial?)` | `if (initial !== undefined) { emit(...) }` | `if (initial !== undefined) { gpioWrite(this._pin, initial) }` | R1 + R3 |
| `Pin.output(initial?)` | same as above | same as above | R1 + R3 |
| `Pin.write(value)` | `emit(\`digitalWrite(${this._pin}, ${value});\`)` | `gpioWrite(this._pin, value)` | R1 (boolean value) |
| `Pin.pwm(value)` | `emit(\`analogWrite(${this._pin}, ${value});\`)` | `pwmWrite(this._pin, value)` | None |

**Note on `pulse()`:** The `delayMicro` semantic function already exists. The 3-step sequence (HIGH → delay → LOW) becomes 3 semantic calls in sequence, which `processHALMethodBody` already handles.

**Note on `pwm()`:** The expression `percent * ((1 << boardResolve("peripherals.pwm.resolution")) - 1) / 100` is a compile-time expression because `boardResolve` resolves to a literal. The resolver's `resolveExpressionText` handles binary expressions and `board()` calls, so this should resolve to a concrete number. Then `pwmWrite(pin, computedDuty)` works.

**Note on `readVoltage()`:** The `adcReadVoltage` HALOpIR op already exists in [`hal-op-ir.ts:85-88`](../packages/core/src/shared/hal-op-ir.ts) and the Arduino strategy already handles it at [line 1053-1054](../packages/framework-arduino/src/strategy.ts). The resolver case needs to be added to `tryResolveSemanticCall`.

**After this phase:** `gpio.ts` has zero `emit()` calls. Can remove `emit` from import.

---

## Phase 2: Complete I2C Migration

**File:** [`packages/hal/src/i2c.ts`](../packages/hal/src/i2c.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 9 (across 9 methods)

| Method | Migration | Resolver Dependency |
|--------|-----------|-------------------|
| `I2CDevice.readByte(reg)` | `i2cBeginTx` + `i2cWrite` + `i2cEndTx` + `i2cRequestFrom` + `return i2cRead` | R2 (return expr) |
| `I2CDevice.writeBytes(reg, data)` | `i2cBeginTx` + `i2cWrite(reg)` + `i2cWrite(data, sizeof(data))` + `i2cEndTx` | Complex: `sizeof()` expression |
| `I2CDevice.readBytes(reg, count)` | Multi-step + for-loop + return | Complex: for-loop |
| `I2CBus.recover()` | 7× emit with for-loop | Complex: for-loop |
| `I2CBus.readByte(addr, reg)` | `i2cBeginTx` + `i2cWrite` + `i2cEndTx` + `i2cRequestFrom` + `return i2cRead` | R2 (return expr) |
| `I2CBus.endTransmission(stop?)` | `return i2cEndTx(bus, stop)` | R2 (return expr) |
| `I2CBus.requestFrom(addr, qty, stop?)` | `return i2cRequestFrom(bus, addr, qty, stop)` | R2 (return expr) |
| `I2CBus.available()` | `return i2cAvailable(bus)` | R2 (return expr) |
| `I2CBus.read()` | `return i2cRead(bus)` | R2 (return expr) |

**Complex methods — recommended approach:**

- **`writeBytes`**: The `sizeof(data)` expression is problematic. Option A: Use `rawCpp()` for the sizeof line. Option B: Add a new semantic function `i2cWriteBuffer(bus, reg, data)` that handles the sizeof internally. **Recommend Option A** (simpler).

- **`readBytes`**: Contains a for-loop that reads bytes into a buffer. Use `rawCpp()` for the entire method body.

- **`recover()`**: Contains a for-loop with 7 emit calls. Use `rawCpp()` for the entire method body.

**After this phase:** `i2c.ts` has zero `emit()` calls (3 methods use `rawCpp()`).

---

## Phase 3: Complete SPI Migration

**File:** [`packages/hal/src/spi.ts`](../packages/hal/src/spi.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 7 (across 7 methods)

| Method | Migration | Notes |
|--------|-----------|-------|
| `SPIDevice.transfer(data)` | `spiCsLow(cs); auto __res = spiTransfer(bus, data); spiCsHigh(cs); return __res` | R2 + intermediate variable |
| `SPIDevice.readRegister(reg, count)` | `rawCpp(...)` | For-loop — too complex for individual ops |
| `SPIBus.setFrequency(hz)` | `spiBeginTx(bus, \`SPISettings(${hz}, MSBFIRST, SPI_MODE0)\`)` | SPISettings constructor in arg |
| `SPIBus.setMode(mode)` | `spiSetMode(bus, mode)` — add resolver case | Resolver case missing |
| `SPIBus.setBitOrder(order)` | `spiSetBitOrder(bus, order)` — add resolver case | Resolver case missing |
| `SPIBus.write16(value)` | `rawCpp(\`${bus}.transfer16(${value});\`)` | No semantic op for transfer16 |
| `SPIBus.transfer(value)` | `return spiTransfer(bus, value)` | R2 (return expr) — stub method |

**Note on `SPIDevice.transfer()`:** This method needs an intermediate variable (`auto __res = ...`) to capture the transfer result before deasserting CS. The resolver doesn't support variable declarations in method bodies. Options:
- Option A: Use `rawCpp()` for the entire sequence
- Option B: Add a new `spiTransferCs(bus, data, cs)` semantic op that handles CS assert/deassert + transfer in one op
- **Recommend Option A** for now.

**Note on `setMode`/`setBitOrder`:** The resolver cases for `spiSetMode` and `spiSetBitOrder` need to be added to `tryResolveSemanticCall`. The HALOpIR types (`SpiSetModeOp`, `SpiSetBitOrderOp`) and strategy handlers already exist.

**After this phase:** `spi.ts` has zero `emit()` calls.

---

## Phase 4: Complete UART Migration

**File:** [`packages/hal/src/uart.ts`](../packages/hal/src/uart.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 6 (across 6 methods)

| Method | Migration | Notes |
|--------|-----------|-------|
| `SerialPort.printf(format, ...args)` | `uartPrintf(port, format, args)` | Spread param handling needed |
| `SerialPort.read()` | `return uartRead(port)` | R2 (return expr) |
| `SerialPort.readLine()` | `rawCpp(\`return ${port}.readStringUntil('\\n');\`)` | No semantic op |
| `SerialPort.peek()` | `return uartPeek(port)` | R2 (return expr) |
| `SerialPort.available()` | `return uartAvailable(port)` | R2 (return expr) |
| `SerialPort.waitForConnection()` | `rawCpp(\`while (!${port}) { delay(10); }\`)` | While loop — no semantic op |

**Note on `printf()`:** The `uartPrintf` op exists in HALOpIR and the strategy. The resolver case exists at [line 968](../packages/transpiler/src/ir/hal-resolver.ts). The challenge is the spread parameter `...args`. The resolver needs to handle `args` as a spread parameter, collecting all remaining callArgTexts. The `_spreadParamName` tracking already exists (line 1021).

**After this phase:** `uart.ts` has zero `emit()` calls.

---

## Phase 5: ADC + DAC Migration

**Files:** [`packages/hal/src/adc.ts`](../packages/hal/src/adc.ts), [`packages/hal/src/dac.ts`](../packages/hal/src/dac.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 6

### ADC (4 emit calls)

| Method | Migration | Notes |
|--------|-----------|-------|
| `ADCClass.getAnalogResolution()` | `return boardResolve("peripherals.adc.0.resolution")` | R2 (return expr) — `boardResolve` produces expression |
| `ADCClass.setAnalogReference(ref)` | `this._reference = String(ref); adcSetReference(ref)` | Already partially migrated in gpio.ts; ADC class needs same |
| `ADCClass.getAnalogReference()` | `return boardResolve("peripherals.adc.0.referenceVoltages." + this._reference)` | R2 + dynamic boardResolve path |
| `ADCClass.read(pin)` | `return adcRead(pin)` | R2 (return expr) |

**Note on `getAnalogReference()`:** The dynamic board path `"peripherals.adc.0.referenceVoltages." + this._reference` uses string concatenation with a tracked field. The `resolveExpressionText` already handles `board()` with binary `+` expressions (line 543-554). The `boardResolve` semantic function should support the same.

### DAC (2 emit calls)

| Method | Migration | Notes |
|--------|-----------|-------|
| `DACClass.write(pin, value)` | `dacWrite(pin, value)` | Op exists in resolver + strategy |
| `DACClass.getResolution()` | `return boardResolve("peripherals.dac.0.resolution")` | R2 (return expr) |

**After this phase:** `adc.ts` and `dac.ts` have zero `emit()` calls.

---

## Phase 6: Pulse + Shift Migration

**Files:** [`packages/hal/src/pulse.ts`](../packages/hal/src/pulse.ts), [`packages/hal/src/shift.ts`](../packages/hal/src/shift.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 9

### Pulse (3 emit calls)

| Method | Migration | Notes |
|--------|-----------|-------|
| `Pulse.long(pin, value)` | `return pulseInLong_(pin._pin, value)` | R2 + pin field access |
| `PulseMeasurement.high()` | `return pulseIn_(pin, 1, timeout)` | R2 (return expr) |
| `PulseMeasurement.low()` | `return pulseIn_(pin, 0, timeout)` | R2 (return expr) |

**Note:** `PulseMeasurement` is an internal class. The resolver needs to track its `_pin` and `_timeout` fields. The constructor does `this._pin = (pin as any)._pin` — the resolver handles `this._field = value` assignments (line 1044-1063), so `_pin` will be tracked. The `timeout()` method sets `this._timeout = us` — also tracked.

The conditional `${this._timeout !== undefined ? ... : ""}` in the current emit template is handled by the `pulseIn_` resolver case which already supports optional timeout.

### Shift (6 emit calls)

| Method | Migration | Notes |
|--------|-----------|-------|
| `Shift.out(dp, cp, order, val)` | `shiftOut_(dp._pin, cp._pin, bitOrder, val)` | Pin field access via `(pin as any)._pin` |
| `Shift.in(dp, cp, order)` | `return shiftIn_(dp._pin, cp._pin, bitOrder)` | R2 (return expr) |
| `ShiftOutBuilder.msbFirst()` | `shiftOut_(this._dataPin, this._clockPin, MSBFIRST, this._value)` | Tracked fields |
| `ShiftOutBuilder.lsbFirst()` | `shiftOut_(this._dataPin, this._clockPin, LSBFIRST, this._value)` | Tracked fields |
| `ShiftInBuilder.msbFirst()` | `return shiftIn_(this._dataPin, this._clockPin, MSBFIRST)` | R2 (return expr) |
| `ShiftInBuilder.lsbFirst()` | `return shiftIn_(this._dataPin, this._clockPin, LSBFIRST)` | R2 (return expr) |

**Note on `Shift.out()`:** The method uses `const bitOrder = order === 'lsb' ? LSBFIRST : MSBFIRST` — a local variable with ternary. The resolver doesn't track local variables. Options:
- Option A: Inline the ternary: `shiftOut_(dp._pin, cp._pin, order === 'lsb' ? 1 : 0, val)` — but the resolver's `resolveSemanticArg` would need to handle ternary expressions.
- Option B: Use `resolveSemanticArg` for the bitOrder argument, which resolves `bitOrder` → looks up in paramNames → gets the callArgText → which would be `"lsb"` or `"msb"`. Then the resolver case for `shiftOut_` can map the string to the constant.
- **Recommend Option B** — the resolver case already handles string args.

**After this phase:** `pulse.ts` and `shift.ts` have zero `emit()` calls.

---

## Phase 7: Timing Migration

**File:** [`packages/hal/src/timing.ts`](../packages/hal/src/timing.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 8

| Method | Migration | Notes |
|--------|-----------|-------|
| `TimingClass.freeHeap()` | `return rawCpp("return ESP.getFreeHeap();")` or new `timingFreeHeap()` | Strategy returns `{ expression: "0" }` — needs fix |
| `TimingClass.setInterval(h, t)` | `return timingSetInterval(callback(h), t)` | R2 + callback + op exists (strategy returns undefined!) |
| `TimingClass.setTimeout(h, t)` | `return timingSetTimeout(callback(h), t)` | R2 + callback + op exists (strategy returns undefined!) |
| `TimingClass.clearInterval(id)` | `timingClearInterval(id)` | Op exists (strategy returns undefined) |
| `TimingClass.clearTimeout(id)` | `timingClearTimeout(id)` | Op exists (strategy returns undefined) |
| `setInterval(h, t)` (global) | Same as class method | Same |
| `setTimeout(h, t)` (global) | Same as class method | Same |
| `clearInterval(id)` (global) | Same as class method | Same |
| `clearTimeout(id)` (global) | Same as class method | Same |

**Critical issue:** The Arduino strategy returns `undefined` for `timing.set_interval`, `timing.set_timeout`, `timing.clear_interval`, `timing.clear_timeout` (line 1086-1090). This means the strategy doesn't translate these ops — they're handled through the polyfill infrastructure instead.

**Fix required in [`strategy.ts:1086-1090`](../packages/framework-arduino/src/strategy.ts):**
```ts
case "timing.set_interval":
  return { expression: `__tc_setInterval(${op.handler}, ${op.timeout})` };
case "timing.set_timeout":
  return { expression: `__tc_setTimeout(${op.handler}, ${op.timeout})` };
case "timing.clear_interval":
  return { code: `__tc_clearInterval(${op.id});` };
case "timing.clear_timeout":
  return { code: `__tc_clearTimeout(${op.id});` };
```

**Note on `freeHeap()`:** The current strategy returns `{ expression: "0" }` which is wrong for real hardware. Should be `{ expression: "ESP.getFreeHeap()" }` for ESP32 or kept platform-specific. For now, use `rawCpp("return ESP.getFreeHeap()")` or fix the strategy.

**After this phase:** `timing.ts` has zero `emit()` calls.

---

## Phase 8: Power + WDT + Timer Migration

**Files:** [`packages/hal/src/power.ts`](../packages/hal/src/power.ts), [`packages/hal/src/wdt.ts`](../packages/hal/src/wdt.ts), [`packages/hal/src/timer.ts`](../packages/hal/src/timer.ts)
**Prerequisites:** R3 (if-block semantic calls), R4 (if-condition evaluation) — or use `rawCpp()`
**Remaining emit() calls:** 12

### New semantic ops needed:

**In [`packages/core/src/shared/hal-op-ir.ts`](../packages/core/src/shared/hal-op-ir.ts):**
```ts
// Power
export interface PowerDeepSleepOp { operation: "power.deep_sleep"; ms: number; }
export interface PowerLightSleepOp { operation: "power.light_sleep"; }
export interface PowerSetCpuFrequencyOp { operation: "power.set_cpu_frequency"; mhz: number; }

// WDT
export interface WdtEnableOp { operation: "wdt.enable"; timeout: string | number; }
export interface WdtResetOp { operation: "wdt.reset"; }
export interface WdtDisableOp { operation: "wdt.disable"; }

// Timer
export interface TimerSetFrequencyOp { operation: "timer.set_frequency"; instance: number; hz: number; }
export interface TimerOnOverflowOp { operation: "timer.on_overflow"; instance: number; handler: string; }
export interface TimerStartOp { operation: "timer.start"; instance: number; }
export interface TimerStopOp { operation: "timer.stop"; instance: number; }
```

**In [`packages/hal/src/emit.ts`](../packages/hal/src/emit.ts):**
```ts
export declare function powerDeepSleep(ms: number): void;
export declare function powerLightSleep(): void;
export declare function powerSetCpuFrequency(mhz: number): void;
export declare function wdtEnable(timeout: number | string): void;
export declare function wdtReset(): void;
export declare function wdtDisable(): void;
export declare function timerSetFrequency(instance: number, hz: number): void;
export declare function timerOnOverflow(instance: number, handler: string): void;
export declare function timerStart(instance: number): void;
export declare function timerStop(instance: number): void;
```

### Power (5 emit calls)

| Method | Migration | Notes |
|--------|-----------|-------|
| `Power.deepSleep(ms)` | `powerDeepSleep(ms)` | If-block with arch check — use R4 or rawCpp |
| `Power.lightSleep()` | `powerLightSleep()` | If-block with arch check — use R4 or rawCpp |
| `Power.setCpuFrequency(mhz)` | `powerSetCpuFrequency(mhz)` | Simple |

**Note on `deepSleep`/`lightSleep`:** These have if-blocks checking `board("architecture") === "esp32"`. With R4 (if-condition evaluation), the resolver would evaluate the condition and only emit the correct branch. Without R4, use `rawCpp()` for the entire method body.

**Strategy for power ops:**
```ts
case "power.deep_sleep":
  return { code: `esp_sleep_enable_timer_wakeup(${op.ms} * 1000);\n  esp_deep_sleep_start();` };
case "power.light_sleep":
  return { code: `esp_light_sleep_start();` };
case "power.set_cpu_frequency":
  return { code: `setCpuFrequencyMhz(${op.mhz});` };
```

### WDT (3 emit calls)

| Method | Migration |
|--------|-----------|
| `WDT.enable(timeout)` | `wdtEnable(timeout)` |
| `WDT.reset()` | `wdtReset()` |
| `WDT.disable()` | `wdtDisable()` |

**Strategy:**
```ts
case "wdt.enable": return { code: `wdt_enable(${op.timeout});` };
case "wdt.reset": return { code: `wdt_reset();` };
case "wdt.disable": return { code: `wdt_disable();` };
```

### Timer (4 emit calls)

| Method | Migration | Notes |
|--------|-----------|-------|
| `HardwareTimer.setFrequency(hz)` | `timerSetFrequency(this._instance, hz)` | Comment emit can be dropped |
| `HardwareTimer.onOverflow(handler)` | `timerOnOverflow(this._instance, callback(handler))` | Callback extraction |
| `HardwareTimer.start()` | `timerStart(this._instance)` | Simple |
| `HardwareTimer.stop()` | `timerStop(this._instance)` | Simple |

**Strategy:**
```ts
case "timer.set_frequency": return { code: `Timer${op.instance}.setFrequency(${op.hz});` };
case "timer.on_overflow": return { code: `Timer${op.instance}.onOverflow(${op.handler});` };
case "timer.start": return { code: `Timer${op.instance}.start();` };
case "timer.stop": return { code: `Timer${op.instance}.stop();` };
```

**After this phase:** `power.ts`, `wdt.ts`, `timer.ts` have zero `emit()` calls.

---

## Phase 9: Random Migration

**File:** [`packages/hal/src/random.ts`](../packages/hal/src/random.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 4

### New semantic ops needed:

```ts
export interface RandomSeedOp { operation: "random.seed"; value: number; }
export interface RandomUpToOp { operation: "random.up_to"; max: number; }
export interface RandomBetweenOp { operation: "random.between"; min: number; max: number; }
export interface RandomIntOp { operation: "random.int"; }
```

```ts
export declare function randomSeed_(value: number): void;
export declare function randomUpTo(max: number): number;
export declare function randomBetween(min: number, max: number): number;
export declare function randomInt(): number;
```

| Method | Migration |
|--------|-----------|
| `Random.seed(val)` | `randomSeed_(val)` |
| `Random.upTo(max)` | `return randomUpTo(max)` |
| `Random.between(min, max)` | `return randomBetween(min, max)` |
| `Random.int()` | `return randomInt()` |

**Strategy:**
```ts
case "random.seed": return { code: `randomSeed(${op.value});` };
case "random.up_to": return { expression: `random(${op.max})` };
case "random.between": return { expression: `random(${op.min}, ${op.max})` };
case "random.int": return { expression: `random(2147483647)` };
```

**After this phase:** `random.ts` has zero `emit()` calls.

---

## Phase 10: Async Migration

**File:** [`packages/hal/src/async.ts`](../packages/hal/src/async.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 4

### New semantic ops needed:

```ts
export interface AsyncSleepOp { operation: "async.sleep"; ms: number; }
export interface AsyncYieldOp { operation: "async.yield"; }
export interface AsyncSleepUntilOp { operation: "async.sleep_until"; pollIntervalMs: number; }
export interface AsyncCurrentTaskOp { operation: "async.current_task"; }
```

| Method | Migration |
|--------|-----------|
| `AsyncClass.sleep(ms)` | `asyncSleep(ms)` |
| `AsyncClass.yield()` | `asyncYield()` |
| `AsyncClass.sleepUntil(condition, pollIntervalMs)` | `asyncSleepUntil(pollIntervalMs)` |
| `AsyncClass.currentTask()` | `return asyncCurrentTask()` |

**Strategy:**
```ts
case "async.sleep": return { code: `__typehal_async_sleep(${op.ms})` };
case "async.yield": return { code: `__typehal_async_yield()` };
case "async.sleep_until": return { code: `__typehal_async_sleep_until(${op.pollIntervalMs})` };
case "async.current_task": return { expression: `__typehal_async_current_task()` };
```

**After this phase:** `async.ts` has zero `emit()` calls.

---

## Phase 11: EEPROM + Preferences + FS Migration

**Files:** [`packages/hal/src/eeprom.ts`](../packages/hal/src/eeprom.ts), [`packages/hal/src/preferences.ts`](../packages/hal/src/preferences.ts), [`packages/hal/src/fs.ts`](../packages/hal/src/fs.ts)
**Prerequisites:** R2 (return expressions)
**Remaining emit() calls:** 20

These are **Arduino-specific / ESP32-specific** peripherals. The semantic op value is low (no multi-framework benefit), but completing the migration eliminates `emit()` entirely.

### Approach: Use `rawCpp()` for most methods

Since these peripherals map 1:1 to Arduino C++ API calls, `rawCpp()` is the simplest approach:

**EEPROM (3 emit calls):**
```ts
write(address: number, value: number): void { rawCpp(`${this._name}.write(${address}, ${value});`); }
update(address: number, value: number): void { rawCpp(`${this._name}.update(${address}, ${value});`); }
put<T>(address: number, value: T): void { rawCpp(`${this._name}.put(${address}, ${value});`); }
```

**Preferences (9 emit calls):**
```ts
begin(name: string, readOnly: boolean = false): void { rawCpp(`Preferences.begin(${name}, ${readOnly});`); }
end(): void { rawCpp(`Preferences.end();`); }
// ... etc
```

**FS (8 emit calls):**
```ts
begin(): boolean { include("<FS.h>"); rawCpp(`return FS.begin();`); return true; }
// ... etc
```

**Note on `rawCpp()` with return values:** The `rawCpp()` function currently produces a `RawCppOp` which the strategy translates as `{ code: op.code }`. For return expressions, we need `rawCpp()` to also support expression mode. Options:
- Option A: Add `rawExpr()` function that produces `{ expression: code }` 
- Option B: Detect `return` prefix in `rawCpp()` (same convention as `emit()`)
- Option C: Use `rawCpp("return EXPR")` and have the resolver handle the "return " prefix

**Recommend Option B/C** — consistent with existing `emit()` convention.

**After this phase:** `eeprom.ts`, `preferences.ts`, `fs.ts` have zero `emit()` calls.

---

## Phase 12: Test File

**File:** [`packages/hal/src/test.ts`](../packages/hal/src/test.ts)
**Remaining emit() calls:** 1

```ts
static start() {
    let _t = "test";
    include("<test.h>");
    rawCpp(`test(${_t}, LOW);`);
}
```

**After this phase:** `test.ts` has zero `emit()` calls.

---

## Phase 13: Remove emit()

Once all HAL files are migrated:

1. **Remove `emit` from all HAL file imports** — verify no file imports `emit` anymore
2. **Mark `emit()` as deprecated** in [`emit.ts`](../packages/hal/src/emit.ts) with a JSDoc comment
3. **Remove `emit` handling from `processHALMethodBody`** — the entire `if (call.expression.text === "emit")` block (lines 1094-1122) can be removed
4. **Remove `emit` handling from `processStatementList`** — the emit branch (lines 1225-1238)
5. **Remove `resolveTemplateLiteral`** function — only used by emit path
6. **Remove `emit` from `emit.ts`** — rename file to `hal-ops.ts` or similar

---

## Execution Order

```
Phase A: Resolver infrastructure (R1-R4)     ← prerequisites for everything
Phase 1: GPIO complete                        ← highest impact
Phase 2: I2C complete
Phase 3: SPI complete
Phase 4: UART complete
Phase 5: ADC + DAC
Phase 6: Pulse + Shift
Phase 7: Timing (needs strategy fix)
Phase 8: Power + WDT + Timer (new ops)
Phase 9: Random (new ops)
Phase 10: Async (new ops)
Phase 11: EEPROM + Preferences + FS (rawCpp)
Phase 12: Test file (rawCpp)
Phase 13: Remove emit()
```

## Estimated Effort

| Phase | New Ops | Resolver Changes | HAL File Changes | Strategy Changes | Complexity |
|-------|---------|-----------------|-----------------|-----------------|------------|
| R1-R4 | 0 | ~80 lines | 0 | 0 | Medium |
| Phase 1 | 0 | 1 (adcReadVoltage resolver) | ~30 lines | 0 | Low |
| Phase 2 | 0 | 0 | ~40 lines | 0 | Low-Medium |
| Phase 3 | 0 | 2 (spiSetMode, spiSetBitOrder) | ~30 lines | 0 | Low |
| Phase 4 | 0 | 0 | ~15 lines | 0 | Low |
| Phase 5 | 0 | 0 | ~20 lines | 0 | Low |
| Phase 6 | 0 | 0 | ~30 lines | 0 | Low |
| Phase 7 | 0 | 0 | ~20 lines | ~10 lines | Low |
| Phase 8 | 10 | ~80 lines | ~30 lines | ~20 lines | Medium |
| Phase 9 | 4 | ~40 lines | ~15 lines | ~10 lines | Low |
| Phase 10 | 4 | ~40 lines | ~15 lines | ~10 lines | Low |
| Phase 11 | 0 | ~10 lines (rawExpr) | ~50 lines | 0 | Low |
| Phase 12 | 0 | 0 | ~5 lines | 0 | Trivial |
| Phase 13 | 0 | Remove ~50 lines | Remove imports | 0 | Low |

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| R2 (return expressions) breaks existing emit return handling | Medium | Keep both paths during migration; returnHalOpIndex is additive |
| If-condition evaluation (R4) is incomplete | Medium | Start without R4; use rawCpp for Power methods |
| `rawCpp()` becomes a crutch that hides real ops | Low | Audit rawCpp usage; only use for truly framework-specific code |
| Strategy changes for timing ops break polyfill system | Medium | Verify polyfill interaction before changing strategy |
| Spread parameter handling for printf is incomplete | Low | Test with variadic args early |
| New ops increase strategy maintenance burden | Low | Ops are simple 1:1 mappings; low complexity |

## Validation Strategy

After each phase:
1. `pnpm run build` — must pass with zero errors
2. Demo project transpilation — verify C++ output is byte-identical
3. Grep for `emit(` in migrated files — must return zero results
4. Run test suite (once vitest setup issue is fixed)
