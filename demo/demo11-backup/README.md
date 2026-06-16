# Atlas — cuttlefish demo #11

A **spatial region manager** written in idiomatic TypeScript and transpiled to
C++ by cuttlefish (`@typecad/framework-native`). Exercises namespace-like
grouping (via static class methods), nested switch, infinite `for(;;)` with
break, try/catch/finally + throw, object spread, `keyof` types, and a nested
class reference.

This is the **eleventh** demo iteration. It targets a fresh slice of the
SUPPORT_MATRIX that demos #1–#10 left untested (⬜):

- §4.7 `namespace X {}` (gated out → use static class methods)
- §2.6 `try / catch / finally` + `throw`
- §2.4 nested switch
- §2.2 infinite `for (;;)` with break
- §1.5 object spread `{ ...a, b }`
- §1.6 `keyof T`, indexed access type
- §1.7 `unknown` type (catch param)

## Layout

```
demo/src/
  models/Regions.ts   region math, Grid class, try/catch, throw.
  main.ts             driver.
```

Demo #10's files are preserved under `demo/demo10-backup/`.

## Running

```bash
npm run lint && npm run compile   # exits 0; binary in demo/src/out/.build/
```

## Sample output

```
merged=0,0,20,20
overlap=overlap
first_hit=2
grid_dim_x=8 cell_size=16
safe_div=5
attempt_div_zero=-1
dim_key=w
done: merged_w=20 overlap=overlap hit=2
```

All values correct (including `attempt_div_zero=-1` — the catch works).

---

# Transpilation issues found by Demo #11

Demo #11 surfaced five issues. **Two are fixed** (D, E); **three are gated out** (A, B, C).

## Fixed

| # | Finding | Fix | File(s) |
|---|---|---|---|
| D | Array-of-objects literals `[{x:1,y:2}, ...]` generated a shadow `_pts_t` struct even when the declared type was `Point[]`, causing collisions | (1) `variables.ts` no longer overrides a named-element-type vector with a shadow struct; (2) `statement-renderer.ts` uses the named element type directly for object init | `ir/transformers/variables.ts`, `emit/statement-renderer.ts` |
| E | `try/catch` emitted `catch (const std::exception& e)` which didn't catch a thrown `RegionError*` → `terminate called after throwing` | Emit `catch (...)` (catch-all) | `emit/emitters/line-appender.ts` |

## Gated out

| # | Finding | Gate |
|---|---|---|
| A | Object spread `{ ...base, w, h }` has no C++ aggregate equivalent | New lint `ObjectExpression > SpreadElement` |
| B | `keyof T` / indexed access `T[K]` have no C++ type equivalent | New lint `TSTypeOperator[type='keyof']` + `TSIndexedAccessType` |
| C | `namespace X {}` has no transpiler lowering | New lint `TSModuleDeclaration` |

All three lint selectors are mirrored in `init-templates.ts` for new projects.

## Build verdict

- **`npm run compile` exits 0.** The binary runs with all-correct output.
- **Regression tests: 2 tests** in `demo-11-regressions.test.ts` (catch-all,
  array-of-objects named element type); the full transpiler suite is
  **186 passed, 2 skipped, 0 failed** (18 files).
