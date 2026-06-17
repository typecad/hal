# KitchenSink — cuttlefish demo #13

A **comprehensive test of ALL remaining untested TypeScript features** from
DEMO_COVERAGE. Exercises ~30 features across types, classes, collections,
modules, and expressions.

## Findings summary

### Correctly gated by existing lint rules (confirmed working)
- `obj["key"]` dynamic property access → `no-dynamic-property-access`
- `instanceof` → `no-restricted-syntax` (no RTTI)
- `async`/`await`/`Promise` → lint rejects (no event loop)
- `function*`/`yield` → lint rejects (no coroutine runtime)
- `var` → lint rejects

### Correctly working (newly exercised)
- §1.5 Associative access via `Map.get()` at call sites ✅
- §4.1 Empty class `class C {}` ✅
- §3.1 Nested class (hoisted to module level) ✅
- §3.2 Object/array destructure params (with named interfaces) ✅
- §1.10 `typeof` type guard (simplified) ✅
- §3.4 Sort with module-level comparator ✅
- §4.6 Borrowed constructor param ✅
- §4.6 Owned<T> field (direct, not via alias) ✅

### Documented gaps (compile but wrong runtime or need workaround)
| # | Finding | Workaround |
|---|---|---|
| A | Inline object-type params (`{ a: int32_t }`) emit `auto` (C++20 extension, fails under `-Werror`) | Use named interfaces |
| B | `static { ... }` initializer block not lowered (Counter.count stays 0) | Initialize in the field declaration or constructor |
| C | `||=`/`&&=` on property access not lowered (val stays unchanged) | Use explicit `if (!x) x = v;` |
| D | Conditional type `T extends X ? A : B` leaks generic `T` into generated code | Don't use in value positions |
| E | Mapped type `{ [K in keyof T]: string }` leaks generic `T` | Don't use in value positions |
| F | `ReturnType<typeof fn>` / `Parameters<typeof fn>` — `typeof` in type position broken | Don't use |
| G | Re-exports `export { ... } from './mod'` — re-exported symbols not visible to importer | Import directly from source |
| H | `Map.get(key)!` in a function return resolves to `auto` | Access at call sites where type resolves from context |
| I | Wrapper-on-alias (`type X = Owned<T>`) resolves to `auto` field | Use `Owned<T>` directly on field |
| J | Nested class inside function body emits `auto` params | Hoist to module level |

## Sample output

```
assoc_alpha=10
empty_created
counter_init=0
nested=42
destructured=7
first_two=30
isstring_num=false
logical_assign=5
forEach_expr=6
forEach_block=12
sorted_0=1
borrowed=99
wrapper_created
sample=5
mode_a=0
done
```

`counter_init=0` (should be 10 — static block gap), `logical_assign=5` (should
be 99 — `||=`/`&&=` gap). All other values correct.

## Build verdict
- `npm run compile` exits 0. Binary runs.
- Full transpiler suite: **186 passed, 2 skipped, 0 failed** (19 files).
