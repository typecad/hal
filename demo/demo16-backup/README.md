# Unit Converter — cuttlefish demo #16

A **simple, idiomatic TypeScript** program: a small unit-converter. Build a
`const enum` of units, an `interface` describing a `Measurement`, a couple of
pure conversion helpers, and a lookup table built with a `Map`. The driver
converts a handful of seed measurements and prints each before → after pair.
Transpiled to C++ by cuttlefish (`@typecad/framework-native`).

This is the **sixteenth** demo iteration. Like #15 it is deliberately **small
and readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. The source uses its natural idiomatic form throughout, with no
workarounds: both transpilation gaps this demo surfaced are now **fixed in the
transpiler**.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe  (named after the main module)
```

- `npm run lint` exits **0**.
- `npm run compile` exits **0** with **no diagnostics** (no warnings, no errors).
  When `g++` does emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans.
- The binary runs with correct output.

## Sample output

```
25C -> 77F
98.5999984741211F -> 36.9999991522895C
100m -> 328.083992004395ft
5280ft -> 1609.34398772168m
roundtrip=0
done
```

Verified by hand:
- 25 °C → 25 · 9/5 + 32 = **77 °F** ✓
- 98.6 °F → (98.6 − 32) · 5/9 = **37 °C** ✓
- 100 m → 100 · 3.28084 = **328.084 ft** ✓
- 5280 ft → 5280 / 3.28084 = **1609.34 m** ✓
- round-trip 0 °C → °F → °C = **0** ✓

The `98.599998…` / `36.999999…` tails are expected `double` representation
(the template literal lowers to `snprintf` with `%.15g`); the values are
correct to full `double` precision.

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  `double` annotations; arithmetic with `9.0 / 5.0` float literals
- §1.4  template literals (`${m.value}${suffix}`) → `snprintf`
- §1.5  `Map<Unit, string>` → `std::map`; `.set()` population; `Map.get()!`
        → const-correct `.at()` (demo #15 fix B)
- §1.6  `interface Measurement` → C++ `struct`; object-literal returns
- §1.7  `const enum Unit` (inlined); equality `===`/`if` on enum members
- §2.4  `switch` on an enum-valued **struct field** (`switch (m.unit)`) —
        now lowers correctly (demo #16 fix A)
- §3.1  multi-file module structure (`units` + driver); pure free functions
- §5.1  comparison `===`; compound float arithmetic

---

# Transpilation issues found by Demo #16 — RESOLVED

Demo #16 surfaced **two** issues. **Both are fixed in the transpiler**, pinned
by `tests/packages/transpiler/demo-16-regressions.test.ts`.

## Fix A — `switch` on a struct field mis-lowered to `std::string(field)`

| Finding | Fix | File(s) |
|---|---|---|
| A `switch` whose discriminant is a **property-access** (e.g. `switch (m.unit)`, where `unit` is a `const enum` field) wrapped the discriminant in `std::string(m.unit)` unconditionally, producing invalid C++ (`no matching function for call to 'std::string::basic_string(const Unit&)'`). | The `std::string(...)` wrap is now decided by the discriminant's **resolved C++ type**, not by its syntactic form. The switch emitter consults the renderer's type inference (`inferCppType`, which resolves struct/interface field types via the `interfaceFieldTypes` map) and wraps **only** when the discriminant is genuinely string-like (`std::string`/`const char*`). For an enum/numeric field it emits a plain comparison; when the type is unknown it defaults to **no wrap** (always valid C++). A new public `inferCppType` method exposes the renderer's existing private type inference for this. | `emit/emitters/line-appender.ts`, `emit/expression-renderer.ts` |

**Before:** `if (std::string(m.unit) == Unit::Celsius)` — illegal.
**After:**  `if (m.unit == Unit::Celsius)` — correct.

This is a concrete use of the newly-added TypeScript-API/type-resolution
plumbing: the emit layer now resolves real field types rather than guessing
from syntax.

## Fix B — `ownership-const-content-mutated` false-positive across function scopes

| Finding | Fix | File(s) |
|---|---|---|
| The ownership pass ran two **separate** global passes (collect decls, then scan mutations) over flat name-keyed maps shared across all functions. A read-only `const labels` in one function collided with a same-named `let labels` mutated in a sibling function, so the read-only binding was wrongly demoted to non-const with a misleading "mutated via index assignment" info diagnostic. | The pass now walks each lexical scope (top-level / each function body) in a **single combined pass** with **scope-local** declaration/mutation maps, so a mutation in one function can never demote a same-named `const` in another. The `ownership-suggest-const` check was preserved for cross-scope reassignment (a top-level `let` reassigned inside a function) by collecting program-wide bare-identifier assignment targets and suppressing the suggestion for any name assigned anywhere. | `ir/ownership-analysis.ts` |

**Before:** `std::map<Unit, std::string> labels = buildLabels();` (`const` dropped) + a false `info` diagnostic.
**After:**  `const std::map<Unit, std::string> labels = buildLabels();` (const preserved) + no diagnostic.

## Build verdict

- **`npm run lint` exits 0.** **`npm run compile` exits 0** with no diagnostics.
- **The binary runs with all-correct output**, verified by hand.
- **Full transpiler suite: 1097 passed, 1 failed (pre-existing, unrelated
  `null as any` fixture), 19 skipped** (80 files). The new demo-16 tests pass.
