# Demo #34 Transpiler Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four transpiler bugs (Findings A–D) surfaced by demo #34 in `packages/cuttlefish/src`, each with a TDD regression test, so the demo's *natural* (un-worked-around) form compiles and runs correctly.

**Architecture:** Four surgical fixes, each touching one localized site. Fix D narrows ternary type inference in the expression renderer. Fix A tags a `new`-class `raw` IR node with a structural marker and switches the heap validator to read it. Fix C adds a HAL pre-scan pass in `build-ir.ts`. Fix B aligns the HAL var-init path with the inline-expression path so a value-bearing halOp is captured into the variable instead of dropping it and registering the variable as the pin. Order: D → A → C → B.

**Tech Stack:** TypeScript, vitest, the cuttlefish IR pipeline (`packages/cuttlefish/src`). Tests use the `transpile` / `transpileAVR` / `transpileNative` / `expectCppContains` helpers from `tests/setup.ts`.

**Spec:** `docs/superpowers/specs/2026-06-19-demo34-transpiler-fixes-design.md`

---

## File Structure

**Modify (all under `packages/cuttlefish/src/`):**
- `api/shared/ir-core.ts` — add optional `newClassName?: string` to the `raw` ExpressionIR variant (Fix A).
- `ir/expression-to-ir.ts:1502-1503` — set `newClassName` when lowering a user-class `new` (Fix A).
- `ir/heap-array-validation.ts:46-74` — detect heap allocs by the marker, not `raw` text (Fix A).
- `ir/build-ir.ts` — add a HAL pre-scan phase before function/top-level lowering (Fix C).
- `ir/transformers/variables.ts:466-561` — capture value-bearing halOps into the var; stop registering them as the receiver instance (Fix B).
- `emit/expression-renderer.ts:381-388` — ternary of two string-literal operands infers `const char*` (Fix D).

**Test (create):**
- `tests/packages/transpiler/demo-34-regressions.test.ts` — one `describe` per finding.

**Test (modify):**
- `tests/packages/hal/hal-adc.test.ts:45-58` — correct the assertion that encodes Finding B (expect the voltage variable, not `Serial.println(14)`).

**Verification (modify, last task):**
- `demo/src/main.ts` — rewrite to the natural form (remove the four workarounds) and confirm `npm run compile` + hardware run.

---

## Task 1: Fix D — ternary of string literals in concat (TDD)

**Files:**
- Modify: `packages/cuttlefish/src/emit/expression-renderer.ts:381-388`
- Test: `tests/packages/transpiler/demo-34-regressions.test.ts` (create)

- [ ] **Step 1: Create the regression test file with the failing Finding-D test**

Create `tests/packages/transpiler/demo-34-regressions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

// ── D: inline ternary of two string literals as a `+` operand ───────────────
// A ternary whose two branches are string literals must infer `const char*`
// (what it renders as), NOT `std::string`, so the concat/snprintf path does
// not wrap it in an invalid `.c_str()`.
describe("D: inline ternary of string literals in concat", () => {
  it("compiles 'x=' + (cond ? 'a' : 'b') without an invalid .c_str()", () => {
    const src = `
function tag(on: boolean): string {
  return 'x=' + (on ? 'a' : 'b');
}
console.log(tag(true));
`;
    const res = transpile(src, { target: "arduino" });
    // The invalid form was `(on ? "a" : "b").c_str()`; it must not appear.
    expect(res.cpp).not.toMatch(/\)\.c_str\(\)/);
    // The ternary should render as a bare conditional, fed straight to snprintf.
    expect(res.cpp).toMatch(/\(on \? "a" : "b"\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts`
Expected: FAIL — the emitted cpp contains `(on ? "a" : "b").c_str()` (or the transpile errors). To see the exact emitted form, the failing test's `not.toMatch(/\)\.c_str\(\)/)` will fail showing the match.

- [ ] **Step 3: Read the current ternary inference to confirm the edit site**

Read `packages/cuttlefish/src/emit/expression-renderer.ts` lines 381-388. Confirm the `case "ternary"` returns `std::string` when either branch is a string literal (because `inferExpressionCppType` returns `"std::string"` for a `string` IR node at line 355-358).

- [ ] **Step 4: Implement the fix**

In `packages/cuttlefish/src/emit/expression-renderer.ts`, replace the `case "ternary"` block (lines 381-388) with:

```ts
      case "ternary": {
        const whenTrue = this.inferExpressionCppType(expr.whenTrue, knownVariableTypes);
        const whenFalse = this.inferExpressionCppType(expr.whenFalse, knownVariableTypes);
        if (whenTrue && whenFalse && whenTrue === whenFalse) return whenTrue;
        // A ternary of two string LITERALS renders as `(c ? "a" : "b")` — a
        // const char*, which has no .c_str() member. inferExpressionCppType
        // returns "std::string" for a `string` IR node, so without this guard
        // the concat/snprintf path wraps the ternary in an invalid `.c_str()`
        // (demo #34 Finding D). Only the both-branches-are-string-literals
        // case is narrowed; a branch that is a real std::string variable
        // keeps the std::string widening.
        const bothStringLiterals = expr.whenTrue.kind === "string" && expr.whenFalse.kind === "string";
        if (bothStringLiterals) return "const char*";
        if (this.strategy.isStringLikeType(whenTrue ?? "") || this.strategy.isStringLikeType(whenFalse ?? "")) return "std::string";
        if (whenTrue === "double" || whenTrue === "float" || whenFalse === "double" || whenFalse === "float") return "double";
        return whenTrue ?? whenFalse;
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Run the broader expression/concat test suites to check for regressions**

Run: `npx vitest run tests/expressions.test.ts tests/semantic-cpp.test.ts tests/packages/transpiler/demo-18-regressions.test.ts tests/packages/transpiler/demo-29-regressions.test.ts`
Expected: all PASS. If any now fail because they relied on the `.c_str()` wrapping for a both-literal ternary, inspect: those would be encoding the bug and should be updated the same way (but none are expected — the narrowing only fires for two string *literals*).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/emit/expression-renderer.ts tests/packages/transpiler/demo-34-regressions.test.ts
git commit -m "fix(emit): ternary of two string literals infers const char* (demo #34 D)"
```

---

## Task 2: Fix A — structural heap-allocation detection (TDD)

**Files:**
- Modify: `packages/cuttlefish/src/api/shared/ir-core.ts:47`
- Modify: `packages/cuttlefish/src/ir/expression-to-ir.ts:1502-1503`
- Modify: `packages/cuttlefish/src/ir/heap-array-validation.ts:46-74`
- Test: `tests/packages/transpiler/demo-34-regressions.test.ts` (append Finding-A block)

- [ ] **Step 1: Append the failing Finding-A test**

Append to `tests/packages/transpiler/demo-34-regressions.test.ts` (add the `transpileAVR`, `transpileNative` imports to the top import line):

```ts
import { transpileAVR, transpileNative } from "../../setup";
```

and add this `describe` block at the end of the file:

```ts
// ── A: heap-allocation-avr detection is independent of HAL imports ──────────
// `new MyClass()` on AVR must be flagged whether or not a HAL/board import is
// present. Today the no-import case is silently allowed (the gate keys off
// `raw` IR text whose presence depends on import structure).
describe("A: heap-allocation-avr detected regardless of HAL import", () => {
  it("flags new Blinker() WITHOUT a HAL import (currently silently allowed)", () => {
    const src = `
class Blinker { on: boolean; constructor() { this.on = false; } }
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("flags new Blinker() WITH a HAL import (already worked)", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
class Blinker { on: boolean; constructor() { this.on = false; } }
const led = LED.asOutput();
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag new on native (heap is safe there)", () => {
    const src = `
class Blinker { on: boolean; constructor() { this.on = false; } }
function run(): void { const b: Blinker = new Blinker(); }
run();
`;
    const res = transpileNative(src);
    const errs = res.diagnostics.filter(d => d.code === "heap-allocation-avr");
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts -t "heap-allocation-avr"`
Expected: the "WITHOUT a HAL import" test FAILS (diagnostics array is empty). The "WITH a HAL import" test passes. The native test passes.

- [ ] **Step 3: Add the structural marker to the raw ExpressionIR**

In `packages/cuttlefish/src/api/shared/ir-core.ts`, change line 47 from:

```ts
  | { kind: "raw"; value: string }
```
to:

```ts
  | { kind: "raw"; value: string; newClassName?: string }
```

- [ ] **Step 4: Set the marker when lowering a user-class `new`**

In `packages/cuttlefish/src/ir/expression-to-ir.ts`, replace lines 1502-1503:

```ts
    const resolvedCtorText = nestedClassAliases.get(ctorText) ?? ctorText;
    return { kind: "raw", value: `new ${resolvedCtorText}(${argsText})` };
```
with:

```ts
    const resolvedCtorText = nestedClassAliases.get(ctorText) ?? ctorText;
    // Tag the node with the constructed class name so the heap-allocation
    // validator can detect heap allocation by CONSTRUCT (demo #34 Finding A),
    // not by pattern-matching the `raw` text (whose presence depended on
    // unrelated import structure).
    return { kind: "raw", value: `new ${resolvedCtorText}(${argsText})`, newClassName: resolvedCtorText };
```

- [ ] **Step 5: Switch the heap validator to read the marker**

In `packages/cuttlefish/src/ir/heap-array-validation.ts`, replace the `checkStatement` body's `new`-detection (lines 50-74) so it keys off the marker first and only falls back to the text regex for untagged nodes. Replace this block:

```ts
      if (
        init &&
        init.kind === 'raw' &&
        typeof init.value === 'string' &&
        /^new\s+\w/.test(init.value)
      ) {
        const match = init.value.match(/^new\s+(\w+)/);
        const className = match ? match[1] : 'unknown';
```
with:

```ts
      // Detect heap allocation by CONSTRUCT (demo #34 Finding A). A user-class
      // `new` now tags its raw node with `newClassName`; fall back to the text
      // regex only for untagged raw nodes (older paths / hand-built IR). Keying
      // off the marker makes detection independent of program/import structure.
      if (init && init.kind === 'raw') {
        const tagged = (init as { newClassName?: string }).newClassName;
        const isHeapNew = !!tagged || /^new\s+\w/.test(init.value);
        if (!isHeapNew) {
          walkNestedStatements(stmt, checkStatement);
          continue;
        }
        const match = init.value.match(/^new\s+(\w+)/);
        const className = tagged ?? (match ? match[1] : 'unknown');
```

Then confirm the rest of the block (pushing the diagnostic, then `walkNestedStatements(stmt, checkStatement)`) still closes correctly. The `if (init && init.kind === 'raw') {` now wraps the whole detection; ensure the existing diagnostic-push + trailing `walkNestedStatements` call remain inside it. Read the full function after editing to confirm braces balance.

- [ ] **Step 6: Run the Finding-A tests to verify they pass**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts -t "heap-allocation-avr"`
Expected: all 3 tests PASS (both AVR cases now flagged; native not flagged).

- [ ] **Step 7: Run the full transpiler + heap-related suites for regressions**

Run: `npx vitest run tests/packages/transpiler/ tests/arduino-avr-safety.test.ts tests/bug-a-mutable-array-vars.test.ts`
Expected: all PASS. If `tests/packages/transpiler/demo-33-regressions.test.ts` now shows a NEW `heap-allocation-avr` diagnostic in its snapshot/output, that is EXPECTED and correct (demo #33's `new Accumulator()` is now consistently flagged on AVR) — update that test's expectations to include the diagnostic (it should not have been silently allowed).

- [ ] **Step 8: If demo-33 regressions changed, reconcile them**

If Step 7 surfaced a new diagnostic in `tests/packages/transpiler/demo-33-regressions.test.ts`, read that file and the SUPPORT_MATRIX §2.5 context, then add an assertion that `new Accumulator()` on AVR emits exactly one `heap-allocation-avr` diagnostic (this is the *correct* consistent behavior). Do NOT silence it. Commit the reconciliation together with the fix.

- [ ] **Step 9: Commit**

```bash
git add packages/cuttlefish/src/api/shared/ir-core.ts packages/cuttlefish/src/ir/expression-to-ir.ts packages/cuttlefish/src/ir/heap-array-validation.ts tests/packages/transpiler/demo-34-regressions.test.ts
# also add the demo-33 reconciliation if Step 8 applied:
# git add tests/packages/transpiler/demo-33-regressions.test.ts
git commit -m "fix(ir): detect heap allocation by construct, not raw text (demo #34 A)"
```

---

## Task 3: Fix C — HAL pre-scan pass for order-independent resolution (TDD)

**Files:**
- Modify: `packages/cuttlefish/src/ir/build-ir.ts` (add a pre-scan phase near the Phase 0 class pre-scan, lines 153-187)
- Test: `tests/packages/transpiler/demo-34-regressions.test.ts` (append Finding-C block)

- [ ] **Step 1: Append the failing Finding-C test**

Append to `tests/packages/transpiler/demo-34-regressions.test.ts`:

```ts
import { transpileArduino } from "../../setup";

// ── C: pin method call from a function declared BEFORE the pin const ────────
// HAL resolution is order-dependent today: a function body lowered before the
// `const led = LED.asOutput()` that registers `led` fails to inline and emits
// `led.high()` verbatim (avr-g++: 'led' was not declared in this scope).
describe("C: pin call from a function resolves regardless of declaration order", () => {
  it("inlines led.high() when the function is declared AFTER const led (already worked)", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
const led = LED.asOutput();
function driveLed(): void { led.high(); }
driveLed();
`;
    const res = transpileArduino(src);
    expect(res.cpp).toContain("digitalWrite(13, HIGH)");
  });

  it("inlines led.high() when the function is declared BEFORE const led (currently fails)", () => {
    const src = `
import { LED } from '@typecad/board-arduino-uno';
function driveLed(): void { led.high(); }
const led = LED.asOutput();
driveLed();
`;
    const res = transpileArduino(src);
    // Must inline — NOT emit the bare `led.high()` that references a
    // non-existent C++ variable.
    expect(res.cpp).toContain("digitalWrite(13, HIGH)");
    expect(res.cpp).not.toMatch(/\bled\.high\(\)/);
  });
});
```

- [ ] **Step 2: Run the tests to verify the second fails**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts -t "declaration order"`
Expected: the "declared BEFORE" test FAILS (`led.high()` is emitted verbatim). The "declared AFTER" test passes.

- [ ] **Step 3: Read the existing pre-scan + HAL-registration code to mirror it**

Read `packages/cuttlefish/src/ir/build-ir.ts` lines 140-400 to see the Phase 0 pre-scans and where top-level pin constants are currently registered into `halInstances` during lowering (the `if (ts.isVariableStatement(stmt))` blocks around lines 320-380 that call `halInstances.set(name, { className: "Pin", fieldValues })`). The pre-scan must replicate the *registration* subset of that logic without emitting statements.

Also read `packages/cuttlefish/src/ir/transformers/variables.ts` lines 416-571 — the per-declaration HAL registration logic (constructor args → fieldValues, `asOutput`/`asInput` → instance registration). The pre-scan reuses the same `resolveHALReceiver` / `isKnownHALClass` helpers.

- [ ] **Step 4: Add the HAL pre-scan pass**

In `packages/cuttlefish/src/ir/build-ir.ts`, immediately AFTER the Phase 0 interface pre-scan (after the `for (const statement of source.statements) { if (ts.isInterfaceDeclaration...) }` loop that ends around line 178), add a new pre-scan phase. It walks top-level variable statements once and registers pin/bus instances into `halInstances` *before* any function or top-level body is lowered:

```ts
  // Phase 0c: Pre-scan top-level HAL declarations so HAL resolution is
  // order-independent. A function that references a pin const must inline
  // the pin call even if the function appears before the `const led =
  // LED.asOutput()` that registers `led` (demo #34 Finding C). This mirrors
  // the per-declaration registration in transformers/variables.ts but runs
  // once up front and emits NO statements — it only populates halInstances.
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const varName = decl.name.text;

      // new Pin(n) / new KnownHALClass(...)
      if (ts.isNewExpression(decl.initializer) && ts.isIdentifier(decl.initializer.expression)) {
        const className = decl.initializer.expression.text;
        if (isKnownHALClass(className)) {
          const fieldValues = new Map<string, string>();
          const ctorArgs = decl.initializer.arguments as ts.NodeArray<ts.Expression> | undefined;
          if (ctorArgs) {
            for (const arg of ctorArgs) {
              if (ts.isNumericLiteral(arg) && className === "Pin") fieldValues.set("_pin", arg.text);
              else if (ts.isPropertyAccessExpression(arg) && className === "Pin") fieldValues.set("_pin", arg.getText());
              else if (ts.isIdentifier(arg) && className === "Pin") {
                const existing = halInstances.get(arg.text);
                if (existing?.fieldValues.has("_pin")) fieldValues.set("_pin", existing.fieldValues.get("_pin")!);
                else fieldValues.set("_pin", arg.text);
              }
            }
          }
          halInstances.set(varName, { className, fieldValues });
        }
        continue;
      }

      // pin.method() returning a HAL instance (asOutput/asInput/asInputPullUp)
      if (ts.isCallExpression(decl.initializer) && ts.isPropertyAccessExpression(decl.initializer.expression)) {
        const receiver = decl.initializer.expression.expression;
        const instance = resolveHALReceiver(receiver);
        if (instance) {
          // Mirror transformers/variables.ts: a "this"-returning method (the
          // mode setters) registers the variable as the receiver instance.
          halInstances.set(varName, instance);
        }
        continue;
      }

      // aliasing: const x = led;  (identifier initializer that is a known pin)
      if (ts.isIdentifier(decl.initializer)) {
        const existing = halInstances.get(decl.initializer.text);
        if (existing) halInstances.set(varName, existing);
      }
    }
  }
```

Confirm `isKnownHALClass` and `resolveHALReceiver` are already imported in `build-ir.ts` (they are, per the existing `halInstances.set(name, { className: "Pin", ... })` blocks at lines 330/340/351 — those import from `./hal-resolver`). If not imported, add them to the existing `import { ... } from "./hal-resolver"` line.

- [ ] **Step 5: Run the Finding-C tests to verify they pass**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts -t "declaration order"`
Expected: both tests PASS.

- [ ] **Step 6: Run the full HAL + transpiler suites for regressions**

Run: `npx vitest run tests/packages/hal/ tests/hal-direct-gpio.test.ts tests/packages/transpiler/`
Expected: all PASS. The pre-scan only ADDS registrations before lowering; per-statement lowering still runs and still emits the side-effects, so existing behavior is preserved. If a test fails because the pre-scan registered something the lowering path also registers (double-set), that is harmless (a `Map.set` overwrite with identical content) — verify the emitted cpp is unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ir/build-ir.ts tests/packages/transpiler/demo-34-regressions.test.ts
git commit -m "fix(ir): HAL pre-scan pass for order-independent pin resolution (demo #34 C)"
```

---

## Task 4: Fix B — capture value-bearing halOps into the variable (TDD)

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/variables.ts:466-561`
- Modify: `tests/packages/hal/hal-adc.test.ts:45-58` (correct the encoded-bug assertion)
- Test: `tests/packages/transpiler/demo-34-regressions.test.ts` (append Finding-B block)

- [ ] **Step 1: Append the failing Finding-B test**

Append to `tests/packages/transpiler/demo-34-regressions.test.ts`:

```ts
// ── B: storing the return of a pin read captures the real value ────────────
// `const v = adc.readAnalog()` must emit `auto v = analogRead(14)` and
// reference `v` at use sites. Today the read is dropped and every use of `v`
// becomes the pin number `14` (the variable is wrongly registered as the pin
// instance).
describe("B: stored pin-method return value is captured, not substituted with the pin number", () => {
  it("emits auto v = analogRead(14) and references v", () => {
    const src = `
import { A0 } from '@typecad/board-arduino-uno';
const adc = A0.asInput();
const v: int32_t = adc.readAnalog();
console.log('' + v);
`;
    const res = transpileArduino(src);
    // The read must be captured into the variable.
    expect(res.cpp).toMatch(/auto v = analogRead\(14\)/);
    // The use site must reference `v`, NOT the literal pin number 14.
    expect(res.cpp).not.toMatch(/"%d", 14/);
  });

  it("a reassigned stored read keeps using the variable", () => {
    const src = `
import { A0 } from '@typecad/board-arduino-uno';
const adc = A0.asInput();
let v: int32_t = adc.readAnalog();
v = v + 1;
console.log('' + v);
`;
    const res = transpileArduino(src);
    expect(res.cpp).toMatch(/auto v = analogRead\(14\)/);
    // `v + 1` must stay `v + 1`, not become `14 + 1`.
    expect(res.cpp).not.toMatch(/14 \+ 1/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts -t "stored pin-method return"`
Expected: both FAIL — emitted cpp has no `auto v = analogRead(14)` and the use site shows `14`.

- [ ] **Step 3: Read the var-init HAL path to confirm the exact edit site**

Read `packages/cuttlefish/src/ir/transformers/variables.ts` lines 466-561 in full. Confirm:
- Line 468 calls `resolveHALCallForVarInit`.
- Line 474 computes `isHalOpReturn = result.returnValue === "__hal_op_return__"`.
- Lines 476-486 emit side-effect halOps.
- Line 505-511 registers the variable as the receiver instance when `(!result.returnValue || result.returnValue === "this" || isHalOpReturn)`.
- Lines 512-557 emit the var_decl — the `isHalOpReturn` branch (513-524) emits `initializer: { kind: "hal-expr", operation: lastOp }`, which is correct, but it is only reached when `result.returnValue && result.returnValue !== "this"`.

The bug: for `readAnalog`, `result.returnValue` is `__hal_op_return__` (truthy, not "this"), so line 512 enters, and the `isHalOpReturn` branch at 513 SHOULD fire. Verify by checking the actual `result.returnValue` for `readAnalog`: read `packages/cuttlefish/src/ir/hal/hal-emitter.ts` lines 415-433 to confirm `return adcRead(pin)` sets `returnValue = "__hal_op_return__"`. If it does, the bug is that line 509 ALSO registers the var as the instance (so later uses substitute the pin), even though line 513 emits a correct var_decl. The fix is to NOT register as instance when `isHalOpReturn`, and ensure the var_decl's later references resolve to the variable (not the pin).

- [ ] **Step 4: Implement the fix — do not register a value-bearing-halOp var as the receiver**

In `packages/cuttlefish/src/ir/transformers/variables.ts`, change the receiver-registration condition at lines 505-511 so a value-bearing halOp return does NOT alias the variable to the pin. Replace:

```ts
          } else if (ts.isPropertyAccessExpression(init.expression)) {
            const receiver = init.expression.expression;
            const instance = resolveHALReceiver(receiver);
            if (instance && (!result.returnValue || result.returnValue === "this" || isHalOpReturn)) {
              halInstances.set(varName, instance);
            }
          }
```
with:

```ts
          } else if (ts.isPropertyAccessExpression(init.expression)) {
            const receiver = init.expression.expression;
            const instance = resolveHALReceiver(receiver);
            // Register the variable as the receiver instance ONLY when the
            // method returns the pin itself ("this", e.g. asOutput/asInput) or
            // returns nothing (a pure side-effect). A value-bearing halOp
            // (readAnalog/readVoltage — returnValue === "__hal_op_return__")
            // must NOT alias the variable to the pin: the variable holds the
            // READ RESULT, and aliasing it makes every later use substitute the
            // pin number (demo #34 Finding B).
            if (instance && (!result.returnValue || result.returnValue === "this") && !isHalOpReturn) {
              halInstances.set(varName, instance);
            }
          }
```

- [ ] **Step 5: Run the Finding-B tests to verify they pass**

Run: `npx vitest run tests/packages/transpiler/demo-34-regressions.test.ts -t "stored pin-method return"`
Expected: both PASS — `auto v = analogRead(14)` is emitted and `v` is referenced at use sites.

- [ ] **Step 6: Correct the encoded-bug assertion in hal-adc.test.ts**

In `tests/packages/hal/hal-adc.test.ts`, the test "uses readVoltage result in an expression" (lines 45-58) currently asserts `Serial.println(14)` (the pin number — the bug). After Fix B it must assert the voltage variable. Read the test, then replace lines 54-57:

```ts
    expect(result.cpp).toContain('analogRead(14)');
    expect(result.cpp).toContain('5 / 1023');
    // println receives the resolved pin number, not the voltage variable
    expect(result.cpp).toContain('Serial.println(14)');
```
with:

```ts
    expect(result.cpp).toContain('analogRead(14)');
    expect(result.cpp).toContain('5 / 1023');
    // println receives the voltage variable (the read result), not the pin
    // number — demo #34 Finding B fixed the stored-read substitution bug.
    expect(result.cpp).toContain('Serial.println(v)');
```

- [ ] **Step 7: Run the full HAL + transpiler suites for regressions (especially Preferences/EEPROM value-reads)**

Run: `npx vitest run tests/packages/hal/ tests/packages/transpiler/ tests/peripheral-usage-basics.test.ts`
Expected: all PASS. Pay special attention to any test covering `Preferences.getInt` / `EEPROM.get` / other value-returning HAL reads (demo #33 Finding D's domain) — those go through the same `__hal_op_return__` path and must still capture the value. If one breaks, the fix at Step 4 is too broad; re-read the failing case and narrow the condition (the discriminator is "method returns a value-bearing halOp" = `isHalOpReturn`, which is already precise).

- [ ] **Step 8: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/variables.ts tests/packages/hal/hal-adc.test.ts tests/packages/transpiler/demo-34-regressions.test.ts
git commit -m "fix(ir): capture value-bearing halOp reads into the variable (demo #34 B)"
```

---

## Task 5: Rewrite demo #34 to its natural form and verify end-to-end

**Files:**
- Modify: `demo/src/main.ts`
- Modify: `demo/README.md` (move the four findings from "active workaround" to "fixed in the transpiler")

This task confirms all four fixes together by removing the demo's workarounds.

- [ ] **Step 1: Rewrite demo/src/main.ts to the natural form**

Remove the four workarounds:
- **Finding B workaround gone:** store the read once: `const raw: int32_t = adc.readAnalog();` and build `reading` from `raw` (single ADC conversion).
- **Finding C workaround gone:** factor LED drive into a helper function `function toggleLed(): boolean` declared BEFORE `const led` (the natural order is fine now that resolution is order-independent; if you prefer, keep the function after the const — both work post-fix).
- **Finding A workaround gone:** (optional, AVR-still-correct) you MAY keep owned state as a module-level scalar OR reintroduce `class Blinker { ... }` instantiated inside `run()`. Note: with Fix A, `new Blinker()` is now CONSISTENTLY flagged on AVR, so a class with `new` will be REJECTED on AVR regardless — keep the module-level scalar (it is the genuinely AVR-correct shape, independent of the gate). Do NOT reintroduce `new` on AVR.
- **Finding D workaround gone:** use the ternary inline in the concat: `line = line + 'led=' + (ledOn ? 'on ' : 'off');` (no intermediate `const state`).

Write the rewritten `demo/src/main.ts` with these changes and update the file header comment to note the workarounds are no longer needed (the findings are fixed in the transpiler).

- [ ] **Step 2: Run npm run compile in demo/ and confirm clean**

Run: `cd demo && npm run compile`
Expected: exit 0, Flash/RAM usage reported, no errors/warnings.

- [ ] **Step 3: Inspect the emitted .ino to confirm correctness**

Run: `grep -vE '^\s*$|^\s*//|^\s#' src/out/main/main.ino | head -50` (from `demo/`)

Confirm:
- `const auto raw = analogRead(14);` appears (single read captured).
- The `reading` struct uses `raw`, not a second `analogRead(14)` or literal `14`.
- The toggle helper, if used, inlines to `digitalWrite(13, HIGH/LOW)`.
- The report concat has no `.c_str()` on the ternary.

- [ ] **Step 4: Upload to hardware and confirm real readings**

Run: `cd demo && npm run upload` (then read COM7 via pyserial as in the original demo run, accounting for the Uno's ~2s bootloader reset on port open).

Expected: serial output shows `led=on/off adc=<varying> mV=<adc*5000/1023>`, with `adc` varying across iterations (a floating A0 drifts then settles), confirming the read is captured (not a constant `14`). End the monitor with Ctrl+C.

- [ ] **Step 5: Update demo/README.md**

In `demo/README.md`, move each Finding (A–D) from "active workaround the demo uses" to "fixed in the transpiler by `<commit>`". Update the "Why the program is shaped the way it is" section to reflect that the natural form now works. Keep the Finding write-ups as historical record under a "## Transpilation issues found by Demo #34 (all fixed)" heading.

- [ ] **Step 6: Run the full test suite once more**

Run: `npx vitest run` (from repo root)
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add demo/src/main.ts demo/README.md
git commit -m "demo #34: rewrite to natural form (all four transpiler fixes landed)"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:** Each spec section maps to a task —
- Fix D → Task 1. ✓
- Fix A → Task 2. ✓
- Fix C → Task 3. ✓
- Fix B → Task 4 (+ the hal-adc.test.ts correction the spec flagged). ✓
- "Verification" section (natural demo form compiles + hardware) → Task 5. ✓

**2. Placeholder scan:** Every code step contains real code; every command has expected output. No "TBD"/"add error handling". The one conditional step (Task 2 Step 8, reconciling demo-33 regressions IF they change) gives the exact action to take if the condition fires. ✓

**3. Type/signature consistency:** The `newClassName?: string` marker added in Task 2 Step 3 (`ir-core.ts`) is read in Task 2 Step 5 (`heap-array-validation.ts`) via `(init as { newClassName?: string }).newClassName` — names match. The `isHalOpReturn` flag in Task 4 Step 4 is the existing variable from `variables.ts:474` — no new name introduced. The test helper names (`transpile`, `transpileAVR`, `transpileNative`, `transpileArduino`) all match `tests/setup.ts`. ✓

**4. Order:** D → A → C → B matches the spec's recommended order; Task 5 (integration) is last and depends on all four. ✓
