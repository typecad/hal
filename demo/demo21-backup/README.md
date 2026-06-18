# Number-theory explorer — cuttlefish demo #21

A **mid-complexity, idiomatic TypeScript** program: a tiny number-theory
playground. An `Explorer` class builds a **Sieve of Eratosthenes** over a byte
array, then for each value in a small set of starts it computes the
**Collatz (3n+1) sequence length** (recursively), records the length in a
`Map<number, number>` keyed by start, and collects the **highest value reached**
along each sequence into a `Set<number>`. The driver builds the sieve, runs
each start, prints a per-start report, and prints the aggregate "biggest peak"
plus a prime count. Transpiled to C++ by cuttlefish
(`@typecad/framework-native`).

This is the **twenty-first** demo iteration. Like #15–#20 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. It is a single self-contained `main.ts`. It deliberately picks a
**different data shape** from #18–#20 (which were CRUD-over-struct-array and
`Map<string, number[]>`):

- a **byte-array sieve** (`int8_t[]` → `std::vector<int32_t>`) with indexed
  read/write,
- a **`Map<number, number>` of *primitive* values** — the clean lowering path,
  a deliberate contrast with demo #20's container-valued map (which surfaced
  three gaps),
- a **`Set<number>`** of peak values,
- a **recursive free function** (`collatzLength`), and
- **`for...of` over `Set.values()`** (lowers to `__tc_setValues`).

The first compile attempt surfaced one real transpiler gap — **a typed-array
class field lowered to invalid C++** — which is now **fixed** in the
transpiler (a new `TS2CPP_TYPED_ARRAY_FIELD` semantic gate + a
`no-typed-array-field` lint rule that persists into new `cuttlefish create`
projects). See *Findings*.

The previous iteration (#20, gradebook) is preserved in `demo20-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0** with no diagnostics. `g++` emits no errors and
  no warnings.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans — that is exactly how three of the four findings
  below were discovered on the first compile attempts.
- The binary runs with correct output.

## Sample output

```
prime_2=true
prime_9=false
prime_29=true
---
7: prime, collatz=16, peak=52
19: prime, collatz=20, peak=88
27: composite, collatz=111, peak=9232
---
biggest_peak=9232
primes_below_30=10
done
```

Verified by hand:

- **Primality spot-checks:** 2 prime ✓, 9 (= 3²) composite ✓, 29 prime ✓.
- **`collatz(7)` = 16** steps: 7→22→11→34→17→52→26→13→40→20→10→5→16→8→4→2→1
  (16 transitions). **peak = 52** ✓.
- **`collatz(19)` = 20** steps: 19→58→29→88→44→22→11→34→17→52→26→13→40→20→10
  →5→16→8→4→2→1 (20 transitions). **peak = 88** ✓.
- **`collatz(27)` = 111** steps — the famous long sequence. **peak = 9232** ✓
  (its famously large hailstone high).
- **`biggest_peak = 9232`** — start 27 dominates starts 7 (52) and 19 (88).
- **`primes_below_30 = 10`** — 2, 3, 5, 7, 11, 13, 17, 19, 23, 29.

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width `int32_t`, `int8_t`; `boolean` → `bool`
- §1.5  `int8_t[]` → `std::vector<int32_t>`; `Map<int32_t,int32_t>` →
        `std::map`; `Map.has` → `.count(k) > 0`; `Map.set` → `m[k] = v`;
        `Map.get(k)!` → `m.at(k)` (const-correct); `Set<int32_t>` →
        `std::set`; `Set.add` → `.insert`; `.push` on a local vector
- §1.5  `for...of` over `Set.values()` (→ `__tc_setValues` then `const T&`)
- §1.7  `const enum Kind` (inlined); enum **relational/equality comparison**
        lowered via `static_cast<int>`; numeric `switch` / `default`
- §1.4  template literals with multiple interpolations — incl. a free-function
        call (`kindLabel(k)`) and an enum-returning call (`collatzPeak(start)`)
        interpolated inside a class method
- §3.1  module-scope free functions (`collatzLength`, `collatzPeak`,
        `classify`, `kindLabel`, `buildSieve`)
- §3.1  **recursion** (`collatzLength` calls itself)
- §3.3  a free function **returning a `std::vector` by value** (`buildSieve`) —
        the plain-array path that *is* safe to return (contrast Finding A)
- §4.1  `class Explorer` with private `int8_t[]` / `Map` / `Set` fields +
        initializers
- §4.2  `this.sieve` / `this.lengths` read/write → `this->...`; `new Explorer()`
        → pointer
- §4.3  instance methods; **class methods calling module-scope free functions**
        (`isPrime` → `classify`; `prepare` → `buildSieve`; `printReport` →
        `classify`/`collatzPeak`/`kindLabel`)
- §2.2  classic C-style `for (let i; i < count; i = i + 1)` against a
        fixed-width captured bound; `while` loop with `break`-free termination

---

# Transpilation issues found by Demo #21

Demo #21 was written with the natural, idiomatic choice of a `Uint8Array` for
the sieve. The first compile attempts surfaced **one genuine transpiler gap**
(Finding C) and re-confirmed three **by-design** restrictions (A, A.2, and the
local-`.length` re-check). Finding C is now **fixed** in the transpiler; the
source carries the `int8_t[]` (`std::vector<int32_t>`) workaround with inline
`NOTE` comments.

## Finding A — returning a `Uint8Array` is rejected (by-design gate, re-confirmed)

The most idiomatic sieve shape is `function buildSieve(...): Uint8Array`. This
is rejected at **lint** time before any C++ is emitted:

```
src\main.ts (X,X) error [transpiler] Returning a typed array dangles in C++
  (the array is a stack-local that is destroyed when the function returns; the
  caller gets a wild pointer). Write into a caller-provided output-array
  parameter instead   cuttlefish/no-typed-array-return
```

This is the SUPPORT_MATRIX §3.3 restriction (`TS2CPP_TYPED_ARRAY_RETURN`):
typed arrays lower to pointer-like C++ storage with no safe ownership transfer
on return. It is **by-design** and surfaced as a clear, source-located
diagnostic rather than a raw `g++` error.

**Workaround in this demo:** the sieve is a plain `int8_t[]` (`std::vector`),
which *is* safely returnable by value, so `buildSieve` keeps the idiomatic
"build and return" shape.

## Finding A.2 — mutating a `Uint8Array` (or any array) *parameter* is rejected (by-design gate, re-confirmed)

The natural workaround for Finding A — pass the array in and mutate it in
place (`function buildSieve(sieve: Uint8Array, ...): void { sieve[i] = ... }`)
—is *also* rejected:

```
src\main.ts (75,3) error [transpiler] Index assignment on array parameter
  'sieve' has no effect in C++ (the parameter is a by-value std::vector copy).
  Return a new array, or wrap the parameter in an object/interface field
  cuttlefish/no-array-param-content-mutation
```

This is SUPPORT_MATRIX §3.2 (`TS2CPP_ARRAY_PARAM_MUTATION`): array parameters
lower to by-value `std::vector` copies, so writing `sieve[i] = v` mutates only
the copy. Before this gate the build would have compiled and **run with the
mutation silently lost**. By-design.

**Workaround in this demo:** `buildSieve` returns the new array rather than
mutating a parameter.

## Finding B — `.length` on a local typed array (RETRACTED — already correct)

An earlier draft of this README reported that `.length` on a function-local
typed array lowered to `arr.size()` on a C array (which has no such member),
citing a raw `g++` error. **That diagnosis was wrong.** A focused re-probe
showed that a function-local typed array — both `new Uint8Array([...])` and
`new Uint8Array(n)` — lowers correctly:

```cpp
uint8_t buf[] = { 0, 0, 0, 0, 0, 0, 0, 0 };
const int len = (sizeof(buf) / sizeof(buf[0]));   // ✓ correct
```

The earlier `.size()` output came from a *field* context (Finding C), not a
local. `.length` on a local typed array is ✅ and covered by
`tests/transpiler-type-gaps.test.ts` (Feature 6). No change needed.

## Finding C — a typed-array *field* lowered to invalid C++ (FIXED)

Holding the sieve on the instance is the natural shape:

```ts
class Explorer {
  private sieve: Uint8Array = new Uint8Array(0);
  prepare(limit: number): void {
    this.sieve = new Uint8Array(limit);
  }
}
```

The field type lowered to `uint8_t*` (SUPPORT_MATRIX §1.5: "Typed array type
annotation → pointer"), but the `new Uint8Array(N)` initializer lowered to a
brace-init-list:

```cpp
class Explorer {
  ...
  uint8_t* sieve = {uint8_t(0)};                 // ← cannot init uint8_t* from {uint8_t}
  void prepare(int32_t limit) {
    this->sieve = { 0, 0, 0, 0 };                // ← cannot assign a brace-init to a pointer
  }
};
```

`{uint8_t(N)}` is only valid against a value-typed target (a `uint8_t[N]`),
not a pointer — and a raw `uint8_t*` field has no `new[]`/`delete[]` lifecycle
either. The mismatch cascaded into the call sites that passed the field to a
`uint8_t*`-typed free function:

Raw `g++` errors (mapped to TS source), from the first compile of the
field-based version:

```
src\main.ts (220,7) error [call]: invalid conversion from 'uint8_t' {aka
        'unsigned char'} to 'uint8_t*' {aka 'unsigned char*'} [-fpermissive]
src\main.ts (182,5) error [return]: invalid conversion from 'uint8_t' {aka
        'unsigned char'} to 'uint8_t*' {aka 'unsigned char*'} [-fpermissive]
```

**Fix applied:** typed-array **class fields** are now rejected by a new
semantic gate `TS2CPP_TYPED_ARRAY_FIELD` (`runSemanticGates`) **and** a new
lint rule `cuttlefish/no-typed-array-field`, both source-located, with an
actionable hint. This closes the last ungated storage class for typed arrays
and is consistent with the existing ownership boundary — typed arrays are
supported only as **function-local stack buffers** (✅), never as fields
(`TS2CPP_TYPED_ARRAY_FIELD`), parameters whose `.length` is read
(`TS2CPP_TYPED_ARRAY_PARAM_LENGTH`), or return values
(`TS2CPP_TYPED_ARRAY_RETURN`). The lint rule is added to the boilerplate
template (`eslint-rules-template.ts` + `init-templates.ts`) and the emitted
`eslint-transpiler-rules.mjs`, so it persists into new `cuttlefish create`
projects. Pinned by `tests/semantic-gates.test.ts`
(`TS2CPP_TYPED_ARRAY_FIELD`).

**Workaround in this demo (and the recommended pattern):** the sieve is an
`int8_t[]` field. Plain arrays lower to `std::vector` (a real value type with
a working `=` and `.size()`), so both the field initializer and the
`buildSieve` return value work cleanly.

---

# Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| A   | returning a `Uint8Array` → `no-typed-array-return` / `TS2CPP_TYPED_ARRAY_RETURN` | error (by-design gate) | re-confirmed |
| A.2 | mutating a `Uint8Array`/array *parameter* → `no-array-param-content-mutation` / `TS2CPP_ARRAY_PARAM_MUTATION` | error (by-design gate) | re-confirmed |
| B   | `.length` on a local typed array | n/a | **retracted** — already correct (`sizeof`); the original report confused a field context for a local |
| C   | typed-array *field* → `uint8_t*` initialized from `{uint8_t(N)}` (invalid) | error | **FIXED** — `TS2CPP_TYPED_ARRAY_FIELD` gate + `no-typed-array-field` lint rule (persist into new projects) |

## Build verdict

- **`npm run lint` exits 0** (no warnings).
- **`npm run compile` exits 0** with **zero** diagnostics. `g++` emits no
  errors and no warnings. The binary runs with **all-correct output**,
  verified by hand against the known Collatz lengths for 7/19/27 and the
  prime count below 30.
- **One transpiler fix was applied** for this demo (Finding C: the
  `TS2CPP_TYPED_ARRAY_FIELD` gate + `no-typed-array-field` lint rule). The
  source carries the idiomatic `int8_t[]` workaround with inline `NOTE`
  comments.
