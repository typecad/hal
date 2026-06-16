# Conduit — cuttlefish demo #9

A **message-processing pipeline** written in idiomatic TypeScript and transpiled
to C++ by cuttlefish (`@typecad/framework-native`). Higher-order function
factories return scaling/predicate transforms, a `Stage` class processes
values, `parseInt`/`parseFloat` parse strings, and a 2D-grid processor exercises
labeled loops and `do...while`.

This is the **ninth** demo iteration. It targets a fresh slice of the
SUPPORT_MATRIX that demos #1–#8 left untested (⬜):

- §3.4 returning a function
- §1.8 `T | null` / `T | undefined`
- §1.6 discriminated union of object literals → `std::variant`
- §5.3 `parseInt` / `parseFloat`
- §1.5 2D arrays `T[][]`
- §2.5 labeled continue, empty statement, standalone block
- §2.3 switch without default
- §2.2 `do...while`

## Layout

```
demo/src/
  models/
    Pipeline.ts   higher-order factories, parseInt/parseFloat, null/undefined,
                  Message struct dispatch.
    Grid.ts       2D arrays, labeled continue, do...while.
  main.ts         driver.
```

Demo #8's files are preserved under `demo/demo8-backup/`.

## Running

```bash
npm run lint && npm run compile   # exits 0; binary in demo/src/out/.build/
```

## Sample output

```
scale_5=15
above10_15=1
stage_apply=105
parse_len=42
parse_val=3.14
safe_head=7
or_default=99
msg_value=5
grid_sum=18
countdown=5
done: scale=15 grid=3
```

All values correct.

---

# Transpilation issues found by Demo #9 — RESOLVED

Demo #9 surfaced six issues. **All are now fixed or gated.**

## Fixed

| # | Finding | Fix | File(s) |
|---|---|---|---|
| A | Discriminated union → `std::variant` emitted without `#include <variant>` | `setup.ts` scans type aliases AND function signatures for `std::variant` and adds the include | `emit/emitters/setup.ts` |
| B | Nested function declaration's return reference emitted the bare name (`return dbl` → `'dbl' not declared`) | Apply `nestedFunctionAliases` mangling when lowering a bare identifier expression | `ir/expression-to-ir.ts` |
| C | `parseInt(s)`/`parseFloat(s)` → `atoi(s)`/`atof(s)` failed (arg is `std::string`) | Emit `atoi((s).c_str())`/`atof((s).c_str())` | `ir/expression-to-ir.ts` |
| D | `T \| null` comparison emitted `valueType == nullptr` (invalid for vectors/structs) | Resolve `valueType === null` to a compile-time `false` (value types are never null) | `ir/expression-to-ir.ts` |

## Gated out (rejected before compile with a clear diagnostic)

| # | Finding | Gate |
|---|---|---|
| E | Discriminated-union member access (`m.kind`/`m.payload` on `A \| B`) — `std::variant` has no direct member access | New semantic gate `TS2CPP_UNION_MEMBER_ACCESS` in `runSemanticGates` |

## Documented (existing lint rules / design limits)

| # | Finding | Status |
|---|---|---|
| F | The `bind\|call\|apply` lint selector bans ANY method named `apply`/`call`/`bind` | Kept as a guardrail (these names are rare and the selector protects against the unsupported `this`-rebinding); rename the method |
| — | Nested functions that **capture** enclosing params can't be hoisted to module level (C++ free functions don't capture) | Existing §3.4 closure limitation; use module-level state or capture-free helpers |
| — | Function-type aliases (`type Fn = () => void`) and `.bind()/.call()/.apply()` | Correctly gated by existing lint rules |

## Build verdict

- **`npm run compile` exits 0.** The binary runs with all-correct output.
- **Regression tests: 6 tests** in `demo-9-regressions.test.ts` (parseInt,
  parseFloat, variant-include, nested-fn alias, null-comparison,
  union-member-access gate); the full transpiler suite is
  **180 passed, 2 skipped, 0 failed** (16 files).
