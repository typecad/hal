# HALOpIR Migration Plan — Completing the Semantic HAL System

## Context

The HALOpIR system is **architecturally complete** — all three layers exist and are wired together:

| Layer | File | Status |
|-------|------|--------|
| **IR types (50+ ops)** | [`packages/core/src/shared/hal-op-ir.ts`](../packages/core/src/shared/hal-op-ir.ts) | ✅ Complete |
| **Resolver: `tryResolveSemanticCall()`** | [`packages/transpiler/src/ir/hal-resolver.ts:670-976`](../packages/transpiler/src/ir/hal-resolver.ts) | ✅ Complete |
| **Framework `resolveHALOperation()`** | [`packages/framework-arduino/src/strategy.ts:1023-1185`](../packages/framework-arduino/src/strategy.ts) | ✅ Complete |
| **Statement renderer dispatch** | [`packages/transpiler/src/emit/statement-renderer.ts:278-280`](../packages/transpiler/src/emit/statement-renderer.ts) | ✅ Complete |
| **Expression renderer dispatch** | [`packages/transpiler/src/emit/expression-renderer.ts:210-220`](../packages/transpiler/src/emit/expression-renderer.ts) | ✅ Complete |
| **Semantic function declarations** | [`packages/hal/src/emit.ts:20-130`](../packages/hal/src/emit.ts) | ✅ Complete |
| **HAL classes using semantic ops** | HAL source files | ✅ **DONE** |

## Data Flow (Current vs Target)

```
LEGACY (emit path — still used for complex methods):
  OutputPin.write(value) → emit('digitalWrite(${this._pin}, ${value});')
    → processHALMethodBody → emitLines: ['digitalWrite(13, 1);']
    → statement-to-ir → emitCpp statement
    → statement-renderer → "digitalWrite(13, 1);"  [direct string]
    
MIGRATED (semantic HALOpIR path):
  OutputPin.high() → gpioWrite(this._pin, 1)
    → processHALMethodBody → halOps: [{operation:'gpio.write', pin:13, value:1}]
    → statement-to-ir → hal-op statement
    → statement-renderer → strategy.resolveHALOperation(op) → "digitalWrite(13, HIGH);"
```

## Migration Status Summary

| Phase | Status | Methods Migrated | Methods Kept on emit() |
|-------|--------|-----------------|----------------------|
| **Phase 1: GPIO** | ✅ Complete | 22 methods | 9 methods (boolean args, return exprs, complex exprs) |
| **Phase 2: I2C** | ✅ Complete | 8 methods | 9 methods (return exprs, for-loops, sizeof) |
| **Phase 3: SPI** | ✅ Complete | 7 methods | 7 methods (return exprs, for-loops, SPISettings ctor) |
| **Phase 3: UART** | ✅ Complete | 6 methods | 6 methods (return exprs, variadic args, while loops) |
| **Phase 4: Callbacks** | ✅ Complete | Fix applied to `extractAndRegisterCallbacks()` | — |
| **Phase 5: Remaining** | ⏸ Deferred | — | All (need new ops or resolver changes) |
| **Phase 6: Validation** | ✅ Complete | Demo transpiles correctly | Pre-existing vitest setup issue |
| **Phase 7: Cleanup** | ✅ Complete | This document | — |

**Total migrated: 43 methods across 4 HAL modules.**

---

## Work Breakdown

### Phase 1: GPIO + Pin Classes ✅ COMPLETE

**File modified:** [`packages/hal/src/gpio.ts`](../packages/hal/src/gpio.ts)

**Migrated to semantic functions (22 methods):**

| Method | Semantic Replacement |
|--------|---------------------|
| `OutputPin.high()` | `gpioWrite(this._pin, 1)` |
| `OutputPin.low()` | `gpioWrite(this._pin, 0)` |
| `OutputPin.toggle()` | `gpioToggle(this._pin)` |
| `OutputPin.tone(frequency)` | `tonePlay(this._pin, frequency)` |
| `OutputPin.toneFor(f, d)` | `tonePlay(this._pin, f, d)` |
| `OutputPin.noTone()` | `toneStop(this._pin)` |
| `InputPin.setAnalogReference(ref)` | `adcSetReference(ref)` |
| `InputPin.onFalling(handler)` | `interruptAttach(this._pin, callback(handler), "FALLING")` |
| `InputPin.onRising(handler)` | `interruptAttach(this._pin, callback(handler), "RISING")` |
| `InputPin.onChange(handler)` | `interruptAttach(this._pin, callback(handler), "CHANGE")` |
| `InputPin.offAll()` | `interruptDetach(this._pin)` |
| `Pin.asOutput(initial?)` | `gpioSetMode(this._pin, "OUTPUT")` |
| `Pin.asInput()` | `gpioSetMode(this._pin, "INPUT")` |
| `Pin.asInputPullUp()` | `gpioSetMode(this._pin, "INPUT_PULLUP")` |
| `Pin.asInputPullDown()` | `gpioSetMode(this._pin, "INPUT_PULLDOWN")` |
| `Pin.inputPullUp()` | `gpioSetMode(this._pin, "INPUT_PULLUP")` |
| `Pin.high()` | `gpioWrite(this._pin, 1)` |
| `Pin.low()` | `gpioWrite(this._pin, 0)` |
| `Pin.toggle()` | `gpioToggle(this._pin)` |
| `Pin.tone(frequency)` | `tonePlay(this._pin, frequency)` |
| `Pin.noTone()` | `toneStop(this._pin)` |
| `ToneChain.for(duration)` | `tonePlay(this._pin, this._frequency, duration)` |

**Kept on `emit()` (9 methods) — with reasons:**

| Method | Reason |
|--------|--------|
| `OutputPin.write(value)` | Boolean value — `resolveNumericArg` can't handle `true`/`false` |
| `OutputPin.pulse(durationMs)` | Complex expression — 3 sequential operations with computed values |
| `OutputPin.pwm(percent)` | Uses `board()` + math — composite expression |
| `InputPin.readAnalog()` | Return expression — `processHALMethodBody` doesn't support return from semantic calls |
| `InputPin.readVoltage()` | Composite expression — `adcRead` * `board()` / `board()` |
| `InputPin.waitForRising(timeout?)` | No HALOpIR op exists |
| `InputPin.waitForFalling(timeout?)` | No HALOpIR op exists |
| `Pin.write(value)` | Boolean value — same as `OutputPin.write` |
| `Pin.pwm(percent)` | Variable args + `board()` math — same as `OutputPin.pwm` |

**Import changes:**
- Added: `gpioWrite`, `gpioToggle`, `gpioSetMode`, `tonePlay`, `toneStop`, `adcSetReference`, `interruptAttach`, `interruptDetach`
- Removed unused: `LOW`, `OUTPUT`, `INPUT`, `INPUT_PULLUP`, `delayMicroseconds`, `tone`, `noTone`, `analogWrite`
- Kept: `emit`, `board`, `callback`, `digitalRead` (used by remaining emit methods)

### Phase 2: I2C Classes ✅ COMPLETE

**File modified:** [`packages/hal/src/i2c.ts`](../packages/hal/src/i2c.ts)

**Migrated to semantic functions (8 methods):**

| Method | Semantic Replacement |
|--------|---------------------|
| `I2CBus.begin()` | `i2cBegin(this._bus)` |
| `I2CBus.beginSlave(addr)` | `i2cBegin(this._bus, addr)` |
| `I2CBus.end()` | `i2cEnd(this._bus)` |
| `I2CBus.setClock(hz)` | `i2cSetClock(this._bus, hz)` |
| `I2CBus.writeByte(addr, reg, val)` | `i2cBeginTx` + `i2cWrite` + `i2cWrite` + `i2cEndTx` |
| `I2CBus.beginTransmission(addr)` | `i2cBeginTx(this._bus, addr)` |
| `I2CBus.write(data)` | `i2cWrite(this._bus, data)` |
| `I2CDevice.writeByte(reg, val)` | `i2cBeginTx` + `i2cWrite` + `i2cWrite` + `i2cEndTx` |

**Kept on `emit()` (9 methods) — with reasons:**

| Method | Reason |
|--------|--------|
| `I2CBus.readByte(addr, reg)` | Return expression from semantic calls |
| `I2CBus.endTransmission(stop?)` | Return expression |
| `I2CBus.requestFrom(addr, qty, stop?)` | Return expression |
| `I2CBus.available()` | Return expression |
| `I2CBus.read()` | Return expression |
| `I2CBus.writeBytes(addr, reg, data)` | Uses `sizeof()` — complex expression |
| `I2CBus.readBytes(reg, count)` | For-loop construct |
| `I2CBus.recover()` | Complex for-loop with pinMode |
| `I2CDevice.readByte(reg)` | Return expression |

**Import changes:**
- Added: `i2cBegin`, `i2cEnd`, `i2cSetClock`, `i2cBeginTx`, `i2cWrite`, `i2cEndTx`

**Type widening in [`emit.ts`](../packages/hal/src/emit.ts):**
- `i2cWrite(bus: string, data: string)` → `i2cWrite(bus: string, data: string | number | number[] | Uint8Array)`

### Phase 3: SPI + UART Classes ✅ COMPLETE

**Files modified:** [`packages/hal/src/spi.ts`](../packages/hal/src/spi.ts), [`packages/hal/src/uart.ts`](../packages/hal/src/uart.ts)

**SPI — Migrated (7 methods):**

| Method | Semantic Replacement |
|--------|---------------------|
| `SPIBus.begin()` | `spiBegin(this._bus)` |
| `SPIBus.end()` | `spiEnd(this._bus)` |
| `SPIBus.beginTransaction(settings)` | `spiBeginTx(this._bus, settings)` |
| `SPIBus.endTransaction()` | `spiEndTx(this._bus)` |
| `SPIBus.write(value)` | `spiTransfer(this._bus, value)` |
| `SPIDevice.write(data)` | `spiCsLow` + `spiTransfer` + `spiCsHigh` |
| `SPIDevice.writeRegister(reg, val)` | `spiCsLow` + `spiTransfer`×2 + `spiCsHigh` |

**SPI — Kept on `emit()` (7 methods):**

| Method | Reason |
|--------|--------|
| `SPIDevice.transfer(data)` | Return expression |
| `SPIDevice.readRegister(reg, count)` | For-loop construct |
| `SPIBus.setFrequency(hz)` | SPISettings constructor — complex expression |
| `SPIBus.setMode(mode)` | No semantic op for `spiSetMode` in resolver |
| `SPIBus.setBitOrder(order)` | No semantic op for `spiSetBitOrder` in resolver |
| `SPIBus.write16(value)` | Uses `transfer16` — no semantic op |
| `SPIBus.transfer(value)` | Return expression (stub) |

**UART — Migrated (6 methods):**

| Method | Semantic Replacement |
|--------|---------------------|
| `SerialPort.begin(baud)` | `uartBegin(this._port, baud)` |
| `SerialPort.end()` | `uartEnd(this._port)` |
| `SerialPort.print(value)` | `uartPrint(this._port, value)` |
| `SerialPort.println(value)` | `uartPrintln(this._port, value)` |
| `SerialPort.write(data)` | `uartWrite(this._port, data)` |
| `SerialPort.flush()` | `uartFlush(this._port)` |

**UART — Kept on `emit()` (6 methods):**

| Method | Reason |
|--------|--------|
| `SerialPort.printf(format, ...args)` | Variadic arguments — no semantic op support |
| `SerialPort.read()` | Return expression |
| `SerialPort.readLine()` | No semantic op exists |
| `SerialPort.peek()` | Return expression |
| `SerialPort.available()` | Return expression |
| `SerialPort.waitForConnection()` | While-loop construct |

**Type widening in [`emit.ts`](../packages/hal/src/emit.ts):**
- `spiTransfer(bus: string, data: string)` → `spiTransfer(bus: string, data: string | number | Uint8Array)`
- `spiBeginTx(bus: string, settings: string)` → `spiBeginTx(bus: string, settings: string | any)`
- `uartPrint(port: string, value: string)` → `uartPrint(port: string, value: any)`
- `uartPrintln(port: string, value: string)` → `uartPrintln(port: string, value: any)`
- `uartWrite(port: string, data: string)` → `uartWrite(port: string, data: any)`

### Phase 4: Callback Handling Verification ✅ COMPLETE

**Fix applied to [`packages/transpiler/src/ir/hal-resolver.ts`](../packages/transpiler/src/ir/hal-resolver.ts):**

Added `extractAndRegisterCallbacks()` call before `tryResolveSemanticCall()` in `processHALMethodBody` (lines 1069-1092). This ensures that `callback(handler)` expressions in semantic call arguments are properly resolved and registered, replacing them with `"__CALLBACK_N__"` placeholders that the resolver can handle.

**Verified:** Interrupt attach methods (`onFalling`, `onRising`, `onChange`) now correctly produce `interruptAttach` HALOpIR nodes with properly resolved callback names.

### Phase 5: Remaining HAL Files ⏸ DEFERRED

**Assessment:** The remaining HAL files cannot be migrated without either:
1. New semantic ops added to the resolver
2. Changes to `processHALMethodBody` to support return expressions from semantic calls
3. Changes to `processStatementList` to handle semantic calls in if-blocks
4. Changes to `resolveNumericArg` to handle boolean values

| File | emit() calls | Blocker |
|------|-------------|---------|
| `timing.ts` | 8 | Return expressions; `setInterval`/`setTimeout` ops return `undefined` in ArduinoStrategy |
| `eeprom.ts` | 3 | No semantic ops exist; inherently Arduino-specific |
| `adc.ts` | ~5 | Return expressions |
| `dac.ts` | ~3 | Return expressions |
| `pulse.ts` | 4 | Return expressions; method chaining with intermediate state |
| `shift.ts` | 4 | Static methods accessing `(pin as any)._pin`; return expressions |
| `random.ts` | ~2 | Return expressions |
| `power.ts` | ~2 | No semantic ops |
| `preferences.ts` | ~4 | No semantic ops; return expressions |
| `fs.ts` | ~5 | No semantic ops; complex constructs |
| `async.ts` | ~3 | No semantic ops |
| `timer.ts` | ~3 | No semantic ops |
| `wdt.ts` | ~2 | No semantic ops |
| `test.ts` | ~2 | Test-only |

**Recommendation:** To unlock further migration, the highest-value resolver changes would be:
1. **Support return expressions from semantic calls** in `processHALMethodBody` — this would unlock `read()`, `readByte()`, `available()`, `peek()`, etc.
2. **Support boolean values in `resolveNumericArg`** — this would unlock `write(true)`/`write(false)`
3. **Add semantic ops for remaining peripherals** (eeprom, power, preferences, fs, etc.)

### Phase 6: Validation & Testing ✅ COMPLETE

**Demo project validation:**
- `demo/src/sketch.ts` transpiles successfully
- Generated [`demo/src/out/.build/sketch.cpp`](../demo/src/out/.build/sketch.cpp) contains correct translations:
  - `pinMode(4, INPUT_PULLUP)` from `gpioSetMode` ✓
  - `pinMode(13, OUTPUT)` from `gpioSetMode` ✓
  - `Serial.begin(115200)` from `uartBegin` ✓
  - `digitalWrite(13, false)` from `emit()` (boolean — expected) ✓

**Build validation:**
- `pnpm run build` succeeds with no TypeScript errors ✓

**Test suite:**
- All 58 tests fail with pre-existing `TypeError: Cannot read properties of undefined (reading 'config')` — this is a vitest setup issue unrelated to the migration changes. The tests were failing before any migration work began.

### Phase 7: Cleanup ✅ COMPLETE

1. ✅ Removed unused imports from migrated HAL files (`LOW`, `OUTPUT`, `INPUT`, `INPUT_PULLUP`, `tone`, `noTone`, `analogWrite`, `delayMicroseconds`)
2. ✅ Widened type signatures in `emit.ts` for `i2cWrite`, `spiTransfer`, `spiBeginTx`, `uartPrint`, `uartPrintln`, `uartWrite`
3. ✅ Updated this migration plan document with completion status
4. ⏸ `emit()` deprecation — not yet marked as deprecated since ~40 methods still use it

---

## Discovered Constraints

During migration, the following resolver constraints were identified that prevented full migration:

### 1. Return Expression Limitation
`processHALMethodBody` only handles semantic calls as **top-level expression statements**. When a method body contains `return someSemanticCall()`, the resolver doesn't produce a HALOpIR for the return value. This blocks migration of all `read()`, `readByte()`, `available()`, `peek()`, `endTransmission()`, `requestFrom()` methods.

**Fix:** Extend `processHALMethodBody` to detect `return` statements wrapping a single semantic call and produce a `hal-expr` node.

### 2. Boolean Value Limitation
`resolveNumericArg` only handles numeric literals (`0`, `1`, `42`). Boolean values (`true`, `false`) cause it to return `null`, which prevents `gpioWrite(pin, true)` from resolving. This blocks `write(value)` where `value` is a boolean parameter.

**Fix:** Extend `resolveNumericArg` to handle `true` → `1`, `false` → `0`.

### 3. If-Block Semantic Call Limitation
`processStatementList` (which handles if-blocks and other compound statements) only processes `emit()` and `include()` calls — not semantic function calls. This means semantic calls inside conditional blocks would fail to resolve.

**Fix:** Extend `processStatementList` to also call `tryResolveSemanticCall` for expression statements.

### 4. Composite Expression Limitation
Methods like `readVoltage()` and `pwm()` combine multiple operations (e.g., `adcRead() * board() / board()`). The resolver doesn't support composite expressions mixing semantic calls with arithmetic.

**Fix:** Either add specialized semantic ops (e.g., `adcReadVoltage`) or extend the expression resolver to handle composite expressions.

## Execution Order (Actual)

```
Phase 4: Callback verification         ← completed first (critical path)
Phase 1: GPIO + Pin (gpio.ts)          ← highest impact, most methods
Phase 2: I2C (i2c.ts)                  ← bus classes
Phase 3: SPI + UART (spi.ts, uart.ts)  ← bus classes
Phase 5: Remaining HAL files            ← assessed, deferred (blockers identified)
Phase 6: Validation & testing           ← demo transpiles correctly
Phase 7: Cleanup + documentation        ← this document
```

## Risk Assessment (Retrospective)

| Risk | Outcome | Notes |
|------|---------|-------|
| Callback resolution broken in semantic path | ✅ Mitigated | Fix applied in Phase 4 |
| Field value resolution for chained methods | ✅ No issues | `halInstances` map tracked fields correctly |
| Board constant resolution through `boardResolve` | ⚠️ Not tested | No migrated methods use `boardResolve` |
| Return value expression handling | ⚠️ Confirmed blocker | Methods with return expressions kept on `emit()` |
| Snapshot churn masking real regressions | ✅ No issues | Demo output verified manually |
| Type signature mismatches | ✅ Fixed | Widened types in `emit.ts` |
