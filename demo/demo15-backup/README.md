# Inventory Stock Tracker — cuttlefish demo #15

A **simple, idiomatic TypeScript** program: build a small catalog of inventory
items in a `Map`, compute the total stock value with `Map.values()` iteration,
look an item up by SKU via `Map.get()`, and print a per-category count summary
using a `Set`. Transpiled to C++ by cuttlefish (`@typecad/framework-native`).

This is the **fifteenth** demo iteration. Unlike the prior kitchen-sink and
scheduler demos, this one is deliberately **small and readable** — its purpose
is to look like real, everyday TypeScript and see how cleanly the transpiler
handles it. It is **not** a feature-exhaustion test.

The source uses the natural idiomatic form throughout — `Map.values()`, `const`
catalog reads, `const enum`, a `Set` — with no workarounds, because all four
transpilation gaps this demo surfaced are now **fixed in the transpiler**.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/Item.exe  (named after the main module)
```

`npm run lint` exits **0**. `npm run compile` exits **0** with **no diagnostics**.
The binary runs with correct output.

## Sample output

```
lookup=A1 hammer x4 @12.5
total_value=130.25
tools=2
food=2
other=1
done
```

Verified by hand: `total_value = 4·12.5 + 0·8 + 20·2.5 + 15·0.5 + 7·3.25 =
130.25`. Category counts: tools=2 (Hammer, Wrench), food=2 (Bread, Apple),
other=1 (Notebook).

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width ints (`int32_t`) and `double` annotations
- §1.4  template literals; string method (`.toLowerCase()`)
- §1.5  `Map<string, Item>` → `std::map`; `Map.values()` → `__tc_mapValues`
- §1.5  `Map.get(k)!` → const-correct `m.at(k)`; `Map.has()`/`.set()`
- §1.5  `Set<string>` → `std::set`; `.has()`/`.add()` (on a demoted const binding)
- §1.6  interface → C++ struct (`Item`); object-literal return from a factory
- §1.7  `const enum` with explicit integer values; numeric `switch` / `default`
- §3.1  multi-file module structure (`models/Item` + driver)
- §5.1  arithmetic / comparison; `+=` compound assignment

---

# Transpilation issues found by Demo #15 — RESOLVED

Demo #15 surfaced **four** issues. **Three are fixed in the transpiler** (A, B,
C) and **one is a documented design choice** (D). All pinned by
`tests/packages/transpiler/demo-15-regressions.test.ts` (12 tests).

## Fixed in the transpiler

| # | Finding | Fix | File(s) |
|---|---|---|---|
| A | `Map.values()` / `.keys()` / `.entries()` (and `Set.*`) were **dropped** — `expression-to-ir` returned the bare receiver, so a `for...of` iterated the underlying `std::map`'s `std::pair` entries instead of the values (`'std::pair<...>' has no member named 'stock'`). | These now lower to the existing runtime helpers `__tc_mapValues` / `__tc_mapKeys` / `__tc_mapEntries` (Map) and new `__tc_setValues` / `__tc_setEntries` (Set), returning `std::vector<V/K/pair>` so a `for...of` iterates the values/keys/pairs. The broken bare-receiver short-circuit was removed. | `ir/expression-to-ir.ts`, `framework-native/src/strategy.ts`, `api/shared/polyfill-helper-registry.ts` |
| B | `Map.get(k)` lowered to non-const `operator[]`, which (1) fails on a `const`-bound Map (`discards qualifiers`) and (2) silently inserts a default entry on a miss. | `Map.get(k)` now lowers to const-correct `m.at(k)` (has a `const` overload, throws on miss). The idiomatic `map.get(k)!` asserts presence, matching `.at()`'s contract. A read-only `const` Map now compiles unchanged. | `ir/expression-to-ir.ts` |
| C | (1) A `const`-bound `Set`/`Map` mutated via `.add()`/`.delete()` was **not demoted** — those lower to `.insert()`/`.erase()`, which weren't in the mutation set, so the binding stayed `const` and failed g++. (2) The `ownership-suggest-const` warning then told the author to make it `const` — the opposite of what works (a contradiction). | `insert`/`erase` added to the const-demotion `MUTATING_METHODS` set; and index-assignment (`.set()` lowers to `m[k]=v`) now marks the corresponding `let` var `everAssigned`, so `ownership-suggest-const` no longer fires for a collection mutated via a method. | `ir/ownership-analysis.ts` |

## Documented design choice

| # | Finding | Resolution |
|---|---|---|
| D | A plain `enum` is lint-gated in scaffolded projects (`TSEnumDeclaration[const!=true]`) — `const enum` is required so members are inlined. | By design (non-const enums aren't inlined). The fix is the `const` keyword. Noted in SUPPORT_MATRIX §1.7. Demo #14's plain `enum TaskKind` predates this rule being enabled. |

## New ESLint rule (persists into new projects)

**`no-mutating-method-on-const-collection`** (warn) — fires at lint time when a
`const`-bound `Map`/`Set`/`ReadonlyMap`/`ReadonlySet` is mutated via
`.set()`/`.add()`/`.delete()`/`.clear()`, surfacing the auto-demotion early with
a clear, source-located message so the author can express intent with `let`.
Emitted into every scaffolded project's `eslint-transpiler-rules.mjs` and
enabled in its `eslint.config.mjs`.

## Build verdict

- **`npm run lint` exits 0.** **`npm run compile` exits 0** with no diagnostics.
- **The binary runs with all-correct output**, verified by hand.
- **Full transpiler suite: 1097 passed, 1 failed (pre-existing, unrelated
  `null as any` fixture), 19 skipped** (80 files). The 12 new demo-15 tests pass.
