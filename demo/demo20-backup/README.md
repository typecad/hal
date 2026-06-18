# Gradebook — cuttlefish demo #20

A **mid-complexity, idiomatic TypeScript** program: a `Gradebook` class keeps a
`Map<string, number[]>` of scores per student, computes each student's average,
maps it to a letter grade (`A`–`F`) via threshold comparisons, supports a
"drop one lowest score" policy, and prints a class report plus the top student.
The driver enrolls three students, records a handful of scores each, drops each
one's lowest score, and prints the report. Transpiled to C++ by cuttlefish
(`@typecad/framework-native`).

This is the **twentieth** demo iteration. Like #15–#19 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. It is a single self-contained `main.ts`.

Unlike #19 (which transpiled cleanly on the first attempt), this demo was
written around a `Map<string, number[]>` and **deliberately surfaced four
transpiler gaps**, three of which are new. They are documented in *Findings*
below; the source carries the idiomatic workarounds and inline `NOTE` comments
pointing at each finding.

The previous iteration (#19, library book tracker) is preserved in
`demo19-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0** with one info diagnostic (`ownership-suggest-const`,
  a hint — see *Findings*). `g++` emits no errors and no warnings.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans — that is exactly how the four findings below were
  discovered on the first compile attempt.
- The binary runs with correct output.

## Sample output

```
reenroll_refused=false
unknown_refused=false
---
Alice: 3 scores, avg 92, grade A
Bob: 3 scores, avg 75, grade C
Cara: 1 scores, avg 100, grade A
---
top=Cara
done
```

(`avg 92` rather than `avg 92.0` is correct — the emitted `%.15g` format for a
`double` strips the trailing `.0`.)

Verified by hand:

- 3 students enrolled: Alice, Bob, Cara. Re-enrolling Alice → `false`.
- **Alice**: 88, 92, 50, 96 → drop lowest (50) → 88, 92, 96 → avg = 276/3 =
  **92.0** → grade **A**.
- **Bob**: 70, 75, 40, 80 → drop lowest (40) → 70, 75, 80 → avg = 225/3 =
  **75.0** → grade **C**.
- **Cara**: 100, 98 → drop lowest (98) → 100 → avg = **100.0** → grade **A**.
- Recording a score for unknown "Zed" → `false`.
- **top = Cara** (100.0 > 92.0 > 75.0).

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width `int32_t`, `double`, `boolean` → `bool`
- §1.4  template literals with multiple interpolations — incl. struct-free
        field-of-`Map.get` reads (`scores.length`) and a **free-function call**
        (`gradeLabel(letterFor(avg))`) interpolated inside a class method
- §1.5  `Map<string, double[]>` → `std::map<std::string, std::vector<double>>`;
        `Map.has` → `.count(k) > 0`; `Map.set` → `m[k] = v`; `Map.get(k)!` →
        `m.at(k)` (const-correct)
- §1.5  `array.splice(i, 1)` → `__tc_splice2` polyfill (→ `std::vector::erase`)
- §1.7  `const enum Grade` (inlined); enum **relational comparison** lowered
        via `static_cast<int>`; numeric `switch` / `default`
- §3.1  module-scope free functions (`letterFor`, `gradeLabel`)
- §4.1  `class Gradebook` with a private `Map` field + initializer
- §4.2  `this.scores` read/write → `this->scores`; `new Gradebook()` → pointer
- §4.3  instance methods; **class methods calling module-scope free functions**
        (re-exercises the demo #18 fix B)
- §2.2  classic C-style `for (let i; i < count; i = i + 1)`; read-only
        `for...of` over a `vector` (→ `const T&`)

## Semantic gates showcase (`src/semantic-gates-showcase.ts`)

A companion documentation file (not part of the transpile graph) demonstrating
the **semantic gates** the transpiler now enforces — the bug classes that,
before these gates, either leaked raw `g++` errors or compiled and ran with
silently-wrong behavior. Each block is a commented-out snippet that, if
uncommented and transpiled, produces a clear source-located `TS2CPP_*`
diagnostic:

- **`TS2CPP_MAP_VALUE_COPY_MUTATION`** — mutating a field on a value fetched
  from `Map.get`/`Record[k]` (the value is a copy, so the write is lost).
  Now catches every binding form, including **destructuring** (a false
  negative in the older detector) and every write operator (`=`, `+=`, `++`,
  `--`) via a single rule.
- **`TS2CPP_ARRAY_PARAM_MUTATION`** — mutating an array parameter (by index
  or via `.push`/`.splice`/...), which writes only the by-value `std::vector`
  copy.
- **`TS2CPP_TYPED_ARRAY_PARAM_LENGTH`** — `.length` on a typed-array
  parameter, which has no valid lowering.
- **`TS2CPP_UNCLASSIFIABLE_TYPE`** — a completeness check (warning severity)
  that flags types the classifier cannot map to a C++ concept. Note what it
  deliberately does *not* flag: `any`, `this` types, nullable unions
  (`T | null`), and the cuttlefish C++ aliases (`double`, `int32_t`, ...) all
  classify cleanly.

These gates are powered by the **SemanticFacts** layer
(`packages/cuttlefish/src/orchestrator/semantic-facts.ts`): a precomputed,
node-keyed fact map that resolves every binding to its value origin so the
gates reason about *what a value is* rather than re-deriving it from syntax at
every use site. See the showcase file for the exact snippets and the inline
rationale for each.

---

# Transpilation issues found by Demo #20

Demo #20 was written against a `Map<string, number[]>` and a `for...of` over a
Map. The **first** compile attempt failed with four distinct `g++` errors. They
are reproduced verbatim below (as the CLI surfaced them, mapped to TS spans).
The source was then adjusted to the idiomatic workarounds and now compiles and
runs cleanly; each workaround carries an inline `NOTE` comment. **None of these
gaps are fixed in the transpiler** — they are open findings, notated here.

## Finding A — `Array.from(map.entries())` is not lowered (NEW)

The idiomatic way to snapshot a Map's key/value pairs into an array is:

```ts
const entries: [string, double[]][] = Array.from(this.scores.entries());
```

`Map.prototype.entries()` lowers correctly to the `__tc_mapEntries` helper
(returns `std::vector<std::pair<K,V>>`), but **`Array.from(...)` has no
lowering** — it is emitted verbatim:

```cpp
const std::vector<std::tuple<std::string, std::vector<double>>> entries =
    Array.from(__tc_mapEntries(this->scores));
```

Raw `g++` error (mapped to TS source):

```
src\main.ts (xxx,7) error [call]: 'Array' was not declared in this scope
        console.log(`${name}: ${scores.length} scores, ...`);
```

`Array.from` is not listed in the SUPPORT_MATRIX at all (neither ✅ nor ❌). It
is an unhandled expression that falls straight through to verbatim emit.

**Workaround in this demo:** keep the roster in a parallel `string[]` and
iterate it by index, reading each student's array back through a guarded
`Map.get`. This is the `roster: string[]` parameter on `topStudent` /
`printReport` and the `const roster: string[] = [...]` in `main`.

## Finding B — destructuring a Map entry tuple is unsupported (aborts the build)

Even with `Array.from` removed, the idiomatic per-entry destructuring does not
lower:

```ts
for (const entry of entries) {
  const name: string = entry[0]!;        // → TS2CPP_UNSUPPORTED_EXPR
  const scores: double[] = entry[1]!;    // → TS2CPP_UNSUPPORTED_EXPR
```

Indexed access into a `std::tuple`/`std::pair` is not lowered. This previously
emitted a silent `0 /* unsupported_expr */` placeholder into the C++ (which
then caused a follow-on `g++` error on `scores.length`); it now fails closed —
the transpiler reports `TS2CPP_UNSUPPORTED_EXPR` and aborts before emission.

Raw `g++` error (mapped to TS source):

```
src\main.ts (xxx,5) error [return]: conversion from 'int' to non-scalar type
        'const std::vector<double>' requested
        return sum / current.length;
```

(`current` here was the `0 /* unsupported_expr */` value that flowed through the
return type's deduction, before this case was made to fail closed — see
Finding B above.)

The matrix §1.5 already warns that tuple *literals* don't lower to a
`std::tuple` constructor; Finding B is the inverse direction — destructuring an
element produced by `__tc_mapEntries` (a `std::pair`) into two named bindings.

**Workaround in this demo:** same as Finding A — iterate a `string[]` roster and
read values via guarded `Map.get`, so no tuple/pair is ever destructured.

## Finding C — `=== undefined` on a `Map.get` whose value is a container emits an invalid comparison (NEW)

`Map.get` in TypeScript returns `T | undefined`. The natural guard is:

```ts
const current: double[] | undefined = this.scores.get(name);
if (current === undefined || current.length === 0) {
  return -1.0;
}
```

When `T` is a **primitive**, this lowers fine (the §1.8 null-strip path). But
when `T` is a **container** (here `double[]`), the transpiled `m.at(k)` returns
the element **by value** (a `std::vector<double>`, never a pointer) and the
`=== undefined` guard lowers to a value comparison against the
`CUTTLEFISH_UNDEFINED` macro:

```cpp
std::vector<double> current = this->scores.at(name);
if (current == CUTTLEFISH_UNDEFINED || current.size() == 0) {   // ← invalid
  return -1;
}
```

`CUTTLEFISH_UNDEFINED` is `0`, so this becomes `std::vector<double> == int`,
which has no `operator==`. This produced the largest single error block in the
run — 26 candidate `operator==` overloads, all rejected:

```
src\main.ts (xxx,5) error [return]: no match for 'operator==' (operand types are
        'std::vector<double>' and 'int')
        return sum / current.length;
src\main.ts (xxx,5) note [return]: there are 26 candidates
...
```

There is a related, already-documented guard in the matrix: `TS2CPP_GET_NULLISH_COMPARE`
rejects `map.get(k) ?? fallback` and `map.get(k) === undefined` on the **result
of `.get()` directly**. Finding C is the adjacent case where the `.get()` result
is **stored in a `let`/`const` local first** (`let s = map.get(k); s === undefined`)
*and* `T` is a container — the existing null-comparison guard (demo #18 fix A)
recognizes struct/interface value types but not `std::vector`/container value
types, so the invalid `==` slips through to `g++`.

**Separately**, `m.at(k)` also **throws** `std::out_of_range` on a missing key
rather than returning a sentinel, so even if the comparison compiled it would
not guard correctly. **Workaround in this demo:** every method that reads a
student's array guards with `Map.has(name)` *first* and never compares the
container to `undefined`. (This is also the SUPPORT_MATRIX §1.5 value-copy
workaround: read the array out, mutate, `.set()` it back.)

## Finding D — `.length` not widened in a numeric `for`-loop bound (`-Wsign-compare`) (NEW)

A C-style loop with a fixed-width counter:

```ts
for (let i: int32_t = 1; i < current.length; i = i + 1) { ... }
```

lowers to:

```cpp
for (int32_t i = 1; i < current.size(); i = i + 1) { ... }
```

The matrix §1.5 documents that `.length` is "widened from `size_t` to `long long`
via `static_cast`" — and that *is* what happens for `for...of` ranges and in
boolean expressions like `scores.length === 0` (which correctly emits
`static_cast<long long>(scores.size()) == 0`). But in the **C-style `for`-loop
condition** the widening is dropped, leaving `int32_t` vs `size_t`:

```
src\main.ts (114,5) warning [return]: comparison of integer expressions of
        different signedness: 'int32_t' {aka 'int'} and
        'std::vector<double>::size_type' {aka 'long long unsigned int'}
        [-Wsign-compare]
        return true;
```

This is a warning, not an error, but it is the kind of diagnostic this demo's
scaffolding aims to keep at zero.

**Workaround in this demo:** capture the bound once into a fixed-width local
(`const count: int32_t = current.length;`) and loop against `count`. (The
emitter then does widen that single capture.)

## One info diagnostic (not a gap)

```
warning [ownership-suggest-const] (135,11): 'current' is never reassigned.
  ↳  const current = ...;  // or annotate with Shared to also enforce const T& at the C++ level
```

This is the transpiler's ownership-analysis **hint** that `current` could be
`const` (it is read but not reassigned). It is informational; the binding
already lowers to a value `std::vector<double>`, so it is left as `let`-shaped
in the TS source for readability. Not a transpilation issue.

---

# Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| A | `Array.from(map.entries())` emits verbatim → `'Array' was not declared` | error | open |
| B | destructuring a `__tc_mapEntries` pair → `TS2CPP_UNSUPPORTED_EXPR` (fails closed) | error | open |
| C | `=== undefined` on a container-typed `Map.get` local → invalid `vector==int` | error | open |
| D | `.length` not widened in a C-style `for` bound → `-Wsign-compare` | warning | open |

All four were reproduced from the first `npm run compile` of the naive
idiomatic source; all four are worked around in the current `main.ts`, which
**lints clean, compiles clean (one info diagnostic), and runs with correct
output**.

## Build verdict

- **`npm run lint` exits 0** (no warnings).
- **`npm run compile` exits 0** with one info diagnostic (`ownership-suggest-const`,
  a hint). `g++` emits no errors and no warnings. The binary runs with
  **all-correct output**, verified by hand.
- **No transpiler fixes were applied** for this demo — the four findings are
  open and documented above; the source carries the idiomatic workarounds.
