# Design: fix the four transpiler gaps surfaced by demo #34

**Date:** 2026-06-19
**Source:** demo #34 (blink + ADC), `demo/README.md` Findings A–D
**Status:** awaiting implementation plan

## Goal

Fix the four transpiler bugs surfaced by demo #34, in the cuttlefish package
(`packages/cuttlefish/src`). All four were verified against the actual source;
none should be disallowed — each is an idiomatic TS pattern that the
SUPPORT_MATRIX either supports or that no reasonable lint rule would reject.
The fixes are structural (per the user's "large fixes, not point-for-point"
instruction), each addressing a root cause rather than a symptom.

## Verified root causes (all confirmed in source)

### A — `heap-allocation-avr` gate coverage depends on a HAL `import` being present

- **Validator:** `ir/heap-array-validation.ts:46-74`. It flags a `var_decl`
  whose initializer is a `raw` IR node matching `/^new\s+\w/`.
- **Why inconsistent:** a user-class `new` *always* lowers to a `raw` node
  (`ir/expression-to-ir.ts:1503`). Whether the validator *sees* that node
  depends on the program IR structure, which changes when a HAL/board
  `import` is present. Verified: demo #33's `new Accumulator()` (no import)
  compiles; the same shape with `import { LED }` is rejected. Bisected to the
  import statement itself.

### B — storing the return of a pin read miscompiles (`raw` → `14`)

- **Site:** `ir/transformers/variables.ts:466-561` (the HAL var-init path).
- **Mechanism:** for `const raw = adc.readAnalog()`, the HAL resolver returns a
  value-bearing halOp (`adc.read`) with no string `returnValue`. The var-init
  path emits the read as a side-effect statement but, at line 508
  (`!result.returnValue || ... === "this" || isHalOpReturn`), **registers `raw`
  as the receiver InputPin instance**. Later, every reference to `raw` resolves
  it as a pin and substitutes the pin number (`14`); the actual `var_decl`
  capturing the read is never emitted. Result: the `analogRead(14)` call is
  dropped and `raw` becomes the literal `14` at every use site.
- **Inline use works:** `console.log(adc.readAnalog())` emits
  `snprintf(..., "%d", analogRead(14))` correctly via the *expression* path
  (`tryResolveHALExpression`), so the divergence is purely in the var-init
  path.
- **Encodes the bug as correct:** `tests/packages/hal/hal-adc.test.ts:50-58`
  asserts `Serial.println(14)` (the pin number) and treats it as passing.

### C — a pin method call from a function declared *before* the pin const fails

- **Mechanism:** `halInstances` (the map that lets `resolveHALReceiver` find a
  pin) is populated **as top-level statements are lowered in source order**
  (`ir/build-ir.ts`, single forward pass; reset once at
  `resetHALResolver()`). A function body is lowered when the function
  declaration is reached. If the function appears *before* the `const led =
  LED.asOutput()` that registers `led`, the function body is lowered while
  `halInstances` has no `led`, so `tryResolveHALMethod` fails and emits
  `led.high()` literally → avr-g++ `'led' was not declared in this scope`.
- **Verified:** the *same* function works if moved *after* `const led`
  (`digitalWrite(13, HIGH)`). It is an ordering/forward-reference bug, not a
  scope-model limitation.

### D — inline ternary of two string literals as a `+` operand → invalid `.c_str()`

- **Site:** `emit/expression-renderer.ts:381-388` (ternary type inference) +
  `:355-358` (string literal infers `std::string`).
- **Mechanism:** a `string` literal infers to `"std::string"` (`:358`), so a
  ternary of two string literals infers `std::string` (`:384`). The
  concat/snprintf path then applies `.c_str()`
  (`needsCStrForStringLike("std::string")` → true). But the ternary *renders*
  as `(cond ? "on " : "off")` — a `const char[4]` — which has no `.c_str()`
  member. avr-g++ rejects it.
- **Workaround already works:** assigning the ternary to a typed
  `const s: string` first resolves correctly.

## Fix-vs-disallow decision

| # | Pattern | Decision | Why not disallow |
|---|---|---|---|
| A | `new MyClass()` on AVR | **FIX** detection | The rule ("no heap on AVR") is correct and intentional (mirrors §2.5 `try/catch`, §1.5 `NO_VECTOR_STORAGE`). The bug is *inconsistent detection*. Disallowing more would reject demo #33's correct code. |
| B | `const x = pin.read()` | **FIX** to work | The most natural sensor-read idiom. The workaround (inline twice = double conversion) is a real cost. |
| C | `pin.method()` in a function before the pin decl | **FIX** pre-scan | TS naturally hoists this; the pattern is legitimate. Forward references are normal. |
| D | `'x=' + (cond ? 'a' : 'b')` | **FIX** inference | String concat + ternary is core, idiomatic TS. |

**No eslint rule or transpiler "disallow" is warranted for any of the four.**
Each pattern is correct TypeScript; the failures are transpiler defects.

## Proposed fixes

All in `packages/cuttlefish/src`. Each is surgical and ships with a test.

### Fix A — structural heap-alloc detection

Tag the lowered `new` so the validator keys off the **construct**, not `raw`
text. In `ir/expression-to-ir.ts:1503`, change:

```ts
return { kind: "raw", value: `new ${resolvedCtorText}(${argsText})` };
```
to also carry a marker, e.g.
```ts
return { kind: "raw", value: `new ${resolvedCtorText}(${argsText})`,
         newClassName: resolvedCtorText };
```

(`ExpressionIR.raw` gains an optional `newClassName?: string`.)

Then in `ir/heap-array-validation.ts:50-55`, detect the heap alloc by the
marker (`init.newClassName`) instead of the `/^new\s+\w/` regex. This makes
detection independent of import structure: demo #33's `new Accumulator()` and
a HAL demo's `new Blinker()` are now both consistently flagged on AVR (or both
allowed if the rule is later relaxed).

**Alternative considered (rejected):** a dedicated `new-class` IR kind. More
invasive for the same payoff; the marker reuses the existing `raw` shape.

**Test:** `tests/packages/transpiler/demo-34-regressions.test.ts` —
`new Accumulator()` inside a function is flagged on AVR *with and without* a
HAL import (both must agree). Today the no-import case is silently allowed.

### Fix B — capture value-bearing halOps into the variable

In `ir/transformers/variables.ts`, when a HAL method returns a value-bearing
halOp (the `adc.read` family), the var-init path must:
1. **not** register the variable as the receiver pin instance (the line-508
   condition must exclude "method returns a value-bearing halOp"), and
2. emit a real `var_decl` capturing the read, mirroring the inline-expression
   path: `auto raw = analogRead(14);`.

The discriminator is "the HAL method's `return` is a semantic call that
resolved to a halOp" — the `__hal_op_return__` sentinel already exists in
`ir/hal/hal-emitter.ts:431` for exactly this case. The var-init path must
route value-bearing halOps through the same capture used for inline
expressions (`tryResolveHALExpression` produces `{ kind: "hal-expr", operation
}`, which renders correctly). The fix is to make the var-init path emit
`var_decl { initializer: { kind: "hal-expr", operation: lastOp } }` for
value-bearing halOps and *skip* the receiver-instance registration.

**Test (and fix the encoded-bug assertion):** correct
`tests/packages/hal/hal-adc.test.ts:50-58` to expect the *voltage variable*,
not `Serial.println(14)`. Add a stored-read test: `const v = adc.readAnalog();
console.log(v)` must emit `auto v = analogRead(14)` and reference `v` (not
`14`) at the use site. This is the demo-34 Finding B pin.

### Fix C — HAL pre-scan pass (order-independent resolution)

In `ir/build-ir.ts`, add a **HAL pre-scan phase** (alongside the existing
Phase 0 class/interface pre-scan at lines 153-187): before lowering any
function or top-level-executable body, walk the top-level declarations once
and populate `halInstances` for every pin/bus constant
(`const x = Pin.fromPort(...)` / `LED.asOutput()` / `new Pin(n)` /
`A0.asInput()` / bus singletons). This makes `halInstances` complete before
function bodies are lowered, so HAL resolution is order-independent.

The pre-scan mirrors what `variables.ts:416-571` already does at
lowering time; it just runs it once *up front* for the declaration-registration
subset (className + fieldValues), without emitting statements. Existing
per-statement lowering stays (it emits the side-effects); it just no longer
*first-discovers* the instance.

**Test:** a function referencing a pin declared *later* in the file inlines
correctly. Today it emits the bare `led.high()` and fails. This is the
demo-34 Finding C pin.

### Fix D — ternary of string-literal operands infers `const char*`

In `emit/expression-renderer.ts:381-388`, the ternary branch: when **both**
operands are `string`-literal IR (the case that renders as bare `"..."`,
i.e. `const char*`), infer `const char*`, not `std::string`. Concretely, add
to the `case "ternary"`:

> If `whenTrue` and `whenFalse` both resolve via the `string`-literal path
> (i.e. the operands are `string` IR nodes), the inferred type is
> `const char*`.

This makes `needsCStrForStringLike("const char*")` return `false`
(`cpp-type-ir.ts:736`), so the concat path skips the invalid `.c_str()`.

An explicitly-annotated `const s: string = cond ? 'a' : 'b'` still works: the
declared `string` type drives storage (`__tc_str_ptr` on AVR), independent of
the ternary's inferred operand type.

**Test:** `'x=' + (cond ? 'a' : 'b')` compiles and emits a valid snprintf
(no `.c_str()` on the ternary). This is the demo-34 Finding D pin.

## Implementation order (recommended)

1. **Fix D** (ternary inference) — fully isolated in the expression renderer;
   no interaction with the others. Ship first to unblock the natural demo form.
2. **Fix A** (heap marker) — isolated IR-tag change + one validator. Ship
   second.
3. **Fix C** (HAL pre-scan) — adds a pass in build-ir.ts. Ship third; it must
   land *before* B because B's correctness depends on `halInstances` being
   complete (and Fix B's test uses functions that reference pins).
4. **Fix B** (value-bearing halOp capture) — the most involved; lands last so
   it can rely on C's complete `halInstances`. Requires re-verifying
   Preferences/EEPROM value-reads still behave.

Each fix is independently testable and mergeable; the order is about minimizing
rework, not a hard dependency (only B-benefits-from-C).

## What is NOT changed

- The SUPPORT_MATRIX AVR rules (no vector/heap/exceptions) — correct as-is.
- The `heap-allocation-avr` rule itself — only its detection mechanism (Fix A).
- The HAL inlining model (top-level pins as compile-time phantoms) — Fix C
  makes it work *consistently*; it does not replace it with real C++ pin
  variables.
- The string-literal-infers-`std::string` convention in general — Fix D only
  narrows it for the ternary-operand case in concat context.

## Verification

- `npm run compile` in `demo/` exits 0 with the workarounds removed (demo #34
  rewritten to the *natural* form: `const raw = adc.readAnalog()` stored once,
  ternary inline in concat, owned state as a class, pin calls from a helper
  function).
- All existing transpiler tests pass.
- The four new regression tests (one per finding) pass.
- The corrected `hal-adc.test.ts:50-58` passes.
- Hardware upload of the un-worked-around demo #34 prints real, varying ADC
  readings (not a constant `14`), confirming Fix B end-to-end.

## Risk

- **Fix A** is low-risk: a marker on an existing IR node, read by one
  validator. The only behavior change is *more consistent* flagging on AVR.
- **Fix B** is the highest-value and touches the var-init path; the
  `__hal_op_return__` machinery already exists for the inline case, so the fix
  is aligning the var-init path with it, not new logic. Must re-verify
  Preferences/EEPROM value-returning reads (demo #33 Finding D's domain) still
  behave.
- **Fix C** adds a pre-scan pass; risk is double-registration if the pre-scan
  and lowering-time registration disagree — mitigated by having the pre-scan
  only populate `halInstances` and not emit, and by the existing test suite.
- **Fix D** is a one-branch type-inference change; risk is a concat that
  *needs* `.c_str()` now skipping it — guarded by checking both operands are
  literal `string` IR, and by the existing concat tests.
