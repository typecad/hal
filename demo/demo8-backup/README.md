# Strata — cuttlefish demo #8

A **layered-config registry** written in idiomatic TypeScript and transpiled to
C++ by cuttlefish (`@typecad/framework-native`). A `Registry` class holds a
`Map<string, int32_t>` of entries plus `Owned<T>`/`Shared<T>`/`Mutable<T>`
ownership-wrapper fields, a static counter with a static getter/setter, and a
pair-returning accessor. The driver exercises spread-in-array, `ReadonlyArray`,
`satisfies`, the §5.1 operators (comma, `void`, `**` via `Math.pow`, `??=`),
`Map.delete`/`Map.size`, and the destructure variants.

This is the **eighth** demo iteration. It targets a fresh slice of the
SUPPORT_MATRIX that demos #1–#7 left untested (⬜):

- §4.6 ownership wrappers (`Owned<T>` / `Shared<T>` / `Mutable<T>`)
- §1.11 / §4.1 generic class + multiple type params + `extends Generic<T>`
- §1.5 `[T]` tuple, `ReadonlyArray<T>`, spread in array `[...a, b]`, `Record<K,V>`
- §1.6 `satisfies`, plain struct interfaces
- §4.3 static getter/setter
- §5.1 `**`, `??=`, comma operator, `void expr`, `delete obj.key`
- §1.9 array destructure default, mixed destructure + regular params

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/Layers.exe
```

`npm run compile` exits **0**; the binary runs with correct output.

## Sample output

```
spread_len=5
readonly_first=10
satisfies_priority=5
registry_count=1
first_pair=first:1
comma=7
void=5
dm_size=2
nullish_assign=42
array_default=15
mixed=6
exponent=2048
done: spread=5 count=1
```

All values correct.

---

# Transpilation issues found by Demo #8 — RESOLVED

Demo #8 surfaced nine issues. **Six are fixed** (A, B, D, F, H, I); **three are
documented** with workarounds (E, G, C — deeper interaction gaps).

## Fixed

| # | Finding | Fix | File(s) |
|---|---|---|---|
| A | `extends Generic<T>` dropped heritage type args | New `formatHeritageType()` resolves type args via `typeNodeToCppType` | `ir/declaration-builders.ts` |
| B | Static getter/setter emitted `() const` (illegal on static) | Drop the `const` cv-qualifier for static getters | `emit/emitters/class-emitter.ts` |
| D | `m.delete(k)` on a Map param emitted `m.delete_` | Don't `escapeCppKeyword` before the Map/Set method checks; escape only at the generic callee-text build | `ir/expression-to-ir.ts` |
| F | Tuple/container type alias dropped by tree-shaking | Filter keeps aliases whose cppType is a concrete container/primitive | `ir/filter.ts` |
| H | `Map.size` emitted `map->size` (pointer deref) | Lower `.size` on a map/set-typed receiver to `static_cast<long long>(m.size())` | `ir/expression-to-ir.ts` |
| I | `??=` on a property-access left side was dropped | Handle `QuestionQuestionEqualsToken` in the property-access assignment block | `ir/transformers/expressions.ts` |

## Documented (workarounds in the demo)

| # | Finding | Workaround |
|---|---|---|
| E | Same-shape object-literal locals collide on shadow-struct names (`_name_t`) | Give each literal a distinct named-interface type |
| G | Object literal initializing an index-signature interface can't brace-init the std::map | Use a fixed-shape struct interface, or build the map via `.set()` |
| C | Static-getter ACCESS (`Registry.count`) emits `Registry::count` not `Registry::getCount()`; tuple LITERALS (`[a, b]`) lower to an array not a `std::tuple` ctor | Access the static field directly; return an interface instead of a tuple literal |

## Build verdict

- **`npm run compile` exits 0.** Transpile + g++ + link all succeed.
- **The binary runs with all-correct output** (including `nullish_assign=42`
  and `dm_size=2`, which were wrong before the fixes).
- **Regression tests: 7 tests** in `demo-8-regressions.test.ts` (A, B, D, F,
  H, I + a non-generic-extends case); the full transpiler suite is
  **174 passed, 2 skipped, 0 failed** (15 files).
