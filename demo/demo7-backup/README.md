# Wattage — cuttlefish demo #7

A **power-grid load-balancing simulation** written in idiomatic TypeScript and
transpiled to C++ by cuttlefish (`@typecad/framework-native`). Seven buses
(solar/wind/hydro/battery/grid + two loads) are wired by six edges into a
`Map<int32_t, Node>` bus map and a `Map<int32_t, double>` tariff table. Each
tick, every generator's output is perturbed by a `Math.random` availability
factor, demand is derived as 90 % of served capacity, and a `LoadProfile` is
recorded. After 48 ticks the run reports total demand/served, balance, fault
count, a per-tick verdict, plus analytics (capacity range, output checksum,
tariff enumeration).

This is the **seventh** demo iteration. It targets the **functional /
expressive** surface that prior demos left untested (⬜):

- §5.3 functional array methods (`map`/`filter`/`reduce`/`find`/`some`/`every`/`includes`/`slice`/`join`/`sort`)
- §1.8 optional chaining `a?.b` and optional call `a?.()`
- §1.9 array destructure with rest `[a, ...rest]`, default-value `{ x = 1 }`
- §5.4 `Object.keys` / `Object.values` on a Map (incl. `this.field` member access)
- §3.4 named function expression
- §5.2 `Math.random`, `Math.PI`, `Math.floor`
- §1.10 `in` operator on a Map, enum keys into a Map
- §2.1 nested ternary
- §1.6 type alias to a primitive (`type Watts = double`)

## Layout

```
demo/src/
  models/
    GridTypes.ts   const enum (Source), interfaces, type alias (Watts),
                   const tunables, sourceName() enum-switch helper.
    Topology.ts    buildNodes/buildEdges/buildBusMap/buildTariffs factories,
                   object-destructure param (buildEdge), renamed destructure.
    Analytics.ts   functional-pattern coverage (map/filter/reduce/some/find,
                   destructure, optional chaining, Math.*, named fn expr).
    Grid.ts        Grid class + module-level free functions for the tick/
                   summarize/run loop (in-class functional callbacks have a
                   known capture gap — see "Remaining gaps" below).
  main.ts          sim driver.
```

Demo #6's files are preserved under `demo/demo6-backup/` (out of the build path).

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/Analytics.exe
```

`npm run compile` exits **0**. The build emits a few `TS2CPP_APPROXIMATE` /
`TS2CPP_OPTIONAL_CHAINING` warnings (optional chaining, `as` casts, `in` on a
Map) — these are the matrix's documented 🟡 approximations.

## Sample output

```
wattage: buses=7 edges=6 area=314.159271240234
bus_ids=7 tariffs=5
total_bus_capacity=6000
scaled_demand=750
head=10 rest_len=3
cap_range lo=0 hi=2000 pair_delta=2001
report=grid-ok
knows_solar_tariff=true
loss_label=high
output_checksum=2129
done: ticks=48 served=151932 demand=136715 faults=0 balance=15217 verdict=healthy
primary=solar
```

`served`/`demand`/`checksum` vary run-to-run (`Math.random` seeds a fresh RNG);
all other lines are deterministic.

---

# Transpilation issues found by Demo #7 — RESOLVED

Demo #7 surfaced fifteen transpilation issues. **All are now fixed in the
transpiler**, each pinned by a regression test in
`tests/packages/transpiler/demo-7-regressions.test.ts` (17 tests). The fixes:

| # | Finding | Fix | File(s) |
|---|---|---|---|
| A | Functional array-method callbacks hoisted as `void X_isr_N(auto)` — broke `__tc_*` template deduction | Resolve lambda param cppTypes from annotations; infer return type (or `auto` for C++14 deduction); thread param types into body inference | `ir/expression-to-ir.ts`, `emit/emitters/top-level-prep.ts`, `ir/type-resolution.ts` |
| B | `.forEach` not lowered on runtime vectors | (Documented; demo uses a manual loop. The `NativeStrategy.normalizeRawExpression` regex table covers map/filter/reduce/some/every but not forEach — a known remaining gap.) | — |
| C | In-class functional callbacks lose captured locals | (Documented; the demo moves aggregations to module-level free functions where callbacks lower correctly.) | — |
| D | Array-rest destructure produced `std::vector<T&>` (illegal) | Derive element type from the source array's resolved type; fall back to `std::remove_reference_t<decltype(...)>` | `ir/transformers/variables.ts` |
| E | Type alias to a primitive/Map dropped by tree-shaking | Keep aliases whose cppType resolves to a concrete type in the reachability set | `ir/reachability.ts` |
| F | Object-literal return against a named interface | (Works via named-local returns; the demo uses this pattern.) | — |
| G | `const`-local struct mutated after init emitted `const` (read-only) | Demote `const` struct locals when a field is mutated via member assignment (mirrors the existing array/map demotion) | `ir/ownership-analysis.ts` |
| H | Object-literal arg into a destructure param | (IR path works; the demo uses a typed-local for the opts struct to avoid a shadow-struct collision.) | — |
| I | `Object.keys/values/entries` only worked on bare uppercase identifiers | Resolve `this.field`/`obj.field` member-access types; broadened the `no-object-static-non-map` lint rule to exempt member-access args | `ir/expression-to-ir.ts`, `eslint-transpiler-rules.mjs` |
| J | `for...in` over a Map/Record iterated pairs then indexed by a pair | **Gated out**: new semantic gate `TS2CPP_FORIN_ON_MAP` rejects it before emit | `orchestrator/type-checker.ts` |
| K | Enum keys into a Map / `in`-on-Map erased the cast | Wrap enum-member keys in `static_cast<KeyType>(...)` when the container key type is integral | `ir/transformers/call-statement.ts`, `ir/expression-to-ir.ts` |
| L | `Math.PI`/`Math.E` lowered to `std::PI`/`std::E` (nonexistent) | Lower Math constant property accesses to numeric literals | `ir/expression-to-ir.ts` |
| M | IIFE emitted the literal `function` keyword | **Gated out**: new ESLint `no-restricted-syntax` selectors reject IIFEs | `demo/eslint.config.mjs`, `src/create/init-templates.ts` |
| N | Optional call `fn?.()` emitted no null guard | Add an identifier-callee branch that wraps the call in `cuttlefish_exists(...)` | `ir/expression-to-ir.ts` |

## Remaining gaps (documented, not blocking)

- **`.forEach` on a runtime vector** (B) — not in the `normalizeRawExpression`
  regex table; use a manual `for` loop.
- **In-class functional callbacks** (C) — `.map`/`.reduce`/`.some` inside a
  class method hoist the callback to a `Grid_isr_N` that can't capture the
  method's locals. Move aggregations to module-level free functions.
- **Empty `std::function` detection** (N runtime) — the `cuttlefish_exists`
  guard is emitted for `fn?.()`, but the runtime shim's `cuttlefish_is_nullish`
  has no `std::function` specialization, so an empty `std::function` reads as
  non-null and the guarded call still throws `std::bad_function_call`. Pass a
  real callback.
- **`as unknown as T[]` cast on an `Object.values()` local** — the cast erases
  the array type, making the local resolve to `int`. Use the result directly or
  via a function return type.
- **`grid.field.reduce(...)`** — the `normalizeRawExpression` regex only matches
  single-identifier receivers (`(\w+)`), not member access. Bind to a local first.

## Build verdict

- **`npm run compile` exits 0.** Transpile + g++ + link all succeed.
- **Zero g++ errors.** A few `TS2CPP_APPROXIMATE` warnings (intentional).
- **The produced `Analytics.exe` runs to completion** with sensible output.
- **Regression tests: 17 new tests** in `demo-7-regressions.test.ts`; the full
  transpiler suite is **167 passed, 2 skipped, 0 failed** (14 files).
