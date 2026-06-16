# Ledger — cuttlefish demo #10

A **numeric-utilities library** written in idiomatic TypeScript and transpiled
to C++ by cuttlefish (`@typecad/framework-native`). Exercises array mutation
methods (`shift`/`unshift`/`reverse`/`fill`/`concat`), `forEach`, utility types
(`Partial`/`Pick`/`NonNullable`), `typeof`, angle-bracket assertion, `int`→`double`
promotion, nested template literals, switch-without-default, and uninitialized
typed locals.

This is the **tenth** demo iteration. It targets a fresh slice of the
SUPPORT_MATRIX that demos #1–#9 left untested (⬜):

- §5.3 `shift`/`unshift`/`reverse`/`fill`/`concat`
- §3.5 `forEach` as a statement
- §1.7 `Partial<T>` / `Pick<T,K>` / `NonNullable<T>`
- §1.10 `typeof x`, `<T>x` angle-bracket assertion
- §1.3 `int` promoted to `double` (float init)
- §1.4 nested template literals
- §2.4 switch without default
- §1.1 uninitialized typed local (`let x: number`)

## Layout

```
demo/src/
  models/NumericUtils.ts   array methods, utility types, typeof, cast, promotion.
  main.ts                  driver.
```

Demo #9's files are preserved under `demo/demo9-backup/`.

## Running

```bash
npm run lint && npm run compile   # exits 0; binary in demo/src/out/.build/
```

## Sample output

```
shifted=1
prepended=4
rev_0=1
filled_0=9
concat_len=4
forEach_sum=60
typeof=object
cast=3
average=4
ledger[n=7]
classify_a=1
patch_id=7
done: shifted=1 concat=4 acc=0
```

All values correct except `typeof=object` (should be `"number"` — Finding C).

---

# Transpilation issues found by Demo #10

Demo #10 surfaced three issues. **Two are fixed** (A, C); **one is documented** (B).

## Fixed

| # | Finding | Fix | File(s) |
|---|---|---|---|
| A | Utility-type aliases (`Partial<T>`/`Pick`/`Omit` → `T`) were dropped by tree-shaking, AND when rescued, emitted BEFORE the interface they referenced (`using Patch = Entry;` before `struct Entry`) | (1) Broadened `filter.ts` to keep aliases whose cppType is a simple user-type identifier; (2) Reordered `type-decl-emitter.ts` to emit interfaces BEFORE type aliases | `ir/filter.ts`, `emit/emitters/type-decl-emitter.ts` |
| C | `typeof x` on an `int32_t` returned `"object"` (the static fallback) instead of `"number"` | Broadened the typeof handler to match the `intNN_t`/`uintNN_t` family and check `activeGlobalTypes` as a fallback | `ir/expression-to-ir.ts` |

## Documented

| # | Finding | Workaround |
|---|---|---|
| B | `Partial<T>`/`Pick<T,K>`/`Omit<T,K>` resolve to the FULL struct `T` (C++ structs have fixed shape — no "partial struct"). A value of these types must provide all of T's fields; TS narrowing (fewer fields) and C++ (full struct) disagree. | Provide all fields, or use a concrete interface matching the desired shape. |

## Build verdict

- **`npm run compile` exits 0.** The binary runs with correct output for all
  exercised features.
- **Regression tests: 3 tests** in `demo-10-regressions.test.ts` (utility-type
  alias ordering, typeof-number, typeof-string); the full transpiler suite is
  **183 passed, 2 skipped, 0 failed** (17 files).
