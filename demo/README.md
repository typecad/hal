# Verdant — cuttlefish demo

A deterministic ecosystem/population simulator written in idiomatic TypeScript
and transpiled to C++ by cuttlefish (`@typecad/framework-native`). Species
across four trophic levels (producer, herbivore, carnivore, apex) grow,
predate, and migrate across a biome. The sim runs a fixed number of ticks
and reports population dynamics, biodiversity, and a ranked final census.

This is the **third** demo iteration. Each iteration targets a different
SUPPORT_MATRIX slice to surface and fix transpiler gaps. This demo exercises
tuple-like coordinates (via interface), `readonly` fields, static-factory
patterns, logistic-growth math, and enum arithmetic.

## Layout

```
demo/src/
  models/
    Types.ts        numeric + string enums, interfaces (Species, Population,
                    Point), tunables
    Species.ts      Organism class (readonly fields, instance methods),
                    Ecosystem class (logistic growth, predation, migration,
                    insertion-sort ranking)
  services/
    Rng.ts          seeded xorshift32
  main.ts           sim driver (for, for...of, top-level -> main())
```

## Running

```bash
npm run compile      # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

## Sample output

```
=== Verdant Ecosystem Sim ===
ticks=16 biome=forest
t0 pop=461 species=4
...
t15 pop=758 species=4
--- sim complete ---
  #1 grass count=522 fitness=102
  #2 rabbit count=160 fitness=112
  #3 fox count=57 fitness=89
  #4 wolf count=19 fitness=79
final biodiversity=4
done biodiversity=4
```

Population grows logistically toward carrying capacity; the trophic pyramid
holds (grass > rabbit > fox > wolf); all four species survive.

## SUPPORT_MATRIX patterns exercised

| Area | Pattern | Source |
|---|---|---|
| §1.5 | `Array<T>`, `.length`, `.push()` | `Ecosystem.organisms`, `.ranked()` |
| §1.6 | `interface` → `struct` | `Species`, `Population`, `Point` |
| §1.7 | numeric + string enums, enum arithmetic (`-`) | `Trophic`, `Biome` |
| §2.1 | `if` / `else if` / `else` | control logic throughout |
| §2.2 | `for`, `for...of`, `while` | `Ecosystem.step`, `.ranked` (insertion sort) |
| §4.1 | class, `readonly` fields, visibility | `Organism`, `Ecosystem` |
| §4.3 | instance methods | `Organism.grow`, `.loseTo`, `.migrate` |
| §4.5 | `Organism*` / `Ecosystem*` pointer types | throughout |
| §5.1 | arithmetic, compound assign | `Organism.grow` (logistic model) |
| §5.2 | `Math.floor` | logging, population rounding |
| §6.1 | top-level → `main()` | `main.ts` tail |
| §6.2 | multi-file local imports | every file |

---

# Transpilation issues encountered (Demo #3) + fixes

## ✅ Fix: enum arithmetic (`Trophic - 1`) fails — no `operator-` for `enum class`

**Gap:** `predator.def.trophic - 1` (where `trophic` is a `Trophic` enum
field) emitted as `predator->def.trophic - 1`, producing
`no match for 'operator-' (operand types are 'Trophic' and 'int')`. The
existing enum `static_cast<int>` wrapping only covered comparison operators
(`==`, `>=`, etc.) and declaration initializers — not arithmetic.

**Fix:** `packages/cuttlefish/src/emit/expression-renderer.ts` —
`renderBinary` now wraps enum-class operands in `static_cast<int>(...)` for
arithmetic operators (`-`, `*`, `/`; `+` is excluded because it may be
string concatenation). Mirrors the existing comparison-operator enum
handling and the declaration-initializer cast from Demo #1 (G10).

## Documented limitations (worked around in the demo)

- **Tuple types (`readonly [number, number]`)** — not lowered to a struct.
  The type alias `type Point = readonly [number, number]` emitted as
  `Point` but no struct definition, causing `'Point' does not name a type`.
  Worked around by using a plain `interface Point { x: number; y: number; }`
  (more idiomatic TS for named-field data anyway).
- **`Math.floor(expr)` nested in a string concat** picks `%d` instead of
  `%.15g` (the type-guard doesn't propagate `double` through the
  `std::floor(...)` wrapping in the snprintf specifier picker). Worked
  around by flooring into a local variable first.
- **String enum (`Biome`)** — emits a `TS2CPP_NO_EQUIVALENT` warning (C++
  enums are integer-only). The string label is recovered via an
  `if`/`else` chain at log time. Known limitation, documented since Demo #1.

## Build verdict

- **`npm run compile` exits 0.** Only cosmetic `-Wformat=` and
  `-Wsign-compare` warnings remain (enum-typed fields in snprintf, loop
  counter vs `size()`). No errors.
- **The produced exe runs correctly** with deterministic output:
  population grows logistically (461 → 758), trophic pyramid holds
  (grass 522 > rabbit 160 > fox 57 > wolf 19), all 4 species survive.
- **Full test suite: 970 passed, 0 failed, 19 skipped** — no regressions.
