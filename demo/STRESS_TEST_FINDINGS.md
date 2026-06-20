# Destructuring stress test — findings (cuttlefish, Arduino AVR)

A maximal destructuring showcase (no end-state goal) hammered the
destructuring surface (SUPPORT_MATRIX §1.9, §5.8–5.10 — all claimed ✅) to find
where the claims break on AVR. The source is `demo/src/main.ts`. It covers
object/array/nested destructuring, rest element, defaults, rename, swap,
class-field destructuring, destructuring a generic, for...of over a
destructured element, and parameter destructuring (object/array/nested/mixed).

After working around the findings below, the showcase compiles clean (Flash
18%) and the 10 remaining destructuring forms lower correctly — so the broad
destructuring surface is solid. The errors cluster in **two families**:
for...of + destructure (a crash), and AVR's lack of std::vector (rest elements,
array params, and struct-element array literals).

---

## Finding A — `for...of` with a destructuring loop variable CRASHES the transpiler

```
✗ Cannot read properties of undefined (reading 'kind')
```

```ts
for (const { x, y } of pts) { ... }
```

throws an uncaught `TypeError` and aborts transpilation — no diagnostic, no
source location. A plain `for (const p of pts)` (non-destructured) works.

**Root cause:** `ir/transformers/control-flow.ts:283-298` (the for...of
lowerer) calls `forInitializerToIR` (`control-flow.ts:60-69`), which builds the
loop variable as a `var_decl` reading `declaration.name.text`. That assumes the
name is an identifier; for a binding pattern (`{ x, y }`), `declaration.name`
is a `BindingPattern` and `.text` is `undefined`. The resulting `var_decl` has
`name: undefined`, so the destructure bindings are never established as locals,
and the body's references to `x`/`y` reach something that reads `.kind` off an
undefined node → throw.

This is **not in SUPPORT_MATRIX §1.9** at all — for...of is listed generally
but the destructured-loop-variable case is unmentioned.

**Demo fix (workaround):** use a plain loop variable + field access
(`for (const p of pts) { ... p.x ... }`).

**Large fix:** the for...of lowerer must detect a binding-pattern initializer
and desugar it the same way a top-level `const { x, y } = item` is desugared —
introduce a synthetic loop variable (e.g. `__forof_N`) bound to the iterable
element, then emit the per-field extraction statements at the top of the loop
body. This is the same "synthetic name + extraction" pattern parameter
destructuring (§5.9) already uses (`__param_N`).

---

## Finding B — array rest-element destructuring lowers to `std::vector` (fails on AVR)

```
src\main.ts(71,16) error [var_decl]: 'vector' is not a member of 'std'
      const [head, ...tail]: int32_t[] = arr;
```

```ts
const [head, ...tail] = arr;
```

`tail` lowers to `std::vector<int32_t>` (a slice), which does not exist on AVR.

**Root cause:** SUPPORT_MATRIX §1.9 line 198 explicitly documents this:
*"Rest element `const [a, ...rest]` ✅ → `std::vector<T>` slice"*. That lowering
is correct for **native** (which has `<vector>`) but is **incompatible with
AVR**, which has no `<vector>` (§1.5 AVR note). The rest element genuinely
needs a runtime-sized slice, which AVR's fixed-size `__tc_StaticArray` can't
express without a recoverable size.

This is a **matrix-accuracy gap**, not a transpiler bug per se: the ✅ in §1.9
should be qualified "(native only; 🚫 on AVR)" — like §5.9 already does for
rest params.

**Demo fix (workaround):** fixed-index extraction (`const head = arr[0]`).

**Large fix (debate):** rest-on-AVR is fundamentally at odds with AVR's
no-dynamic-storage model. The honest fix is (1) qualify §1.9 row 198 as
native-only, and (2) emit a clean `TS2CPP_NO_VECTOR_STORAGE` diagnostic for
rest elements on AVR (like array params get — see Finding C) instead of letting
it reach avr-g++ as a raw `'vector' is not a member of 'std'`. The current
behavior lets it through transpilation and fails at the C++ compile with an
unfriendly message.

---

## Finding C — array-typed PARAMETER destructuring fails on AVR (NO_VECTOR_STORAGE)

```
ERROR: src\main.ts(108,1): [TS2CPP_NO_VECTOR_STORAGE] Parameter
'sumFirst(__param_0)' of type 'std::vector<int32_t>' lowers to 'std::vector<...>',
which is not available on this target ...
```

```ts
function sumFirst([a, b]: int32_t[]) { ... }
```

An array-typed **parameter** lowers to `std::vector<int32_t>` (no compile-time
size is recoverable from a parameter), tripping `TS2CPP_NO_VECTOR_STORAGE` on
AVR. SUPPORT_MATRIX §5.10 marks "Array destructure param `f([a, b])` ✅" — but
that's native-only; on AVR it's unsupported.

**Root cause:** a bare array type as a function parameter (`int32_t[]`) has no
recoverable literal size (unlike a function-local array initialized from a
literal, which lowers to `__tc_StaticArray`). So the param form takes the
vector path. The `TS2CPP_NO_VECTOR_STORAGE` gate correctly fires here (unlike
Finding D, which is silent) — the issue is just that §5.10's ✅ doesn't capture
the AVR caveat.

**Demo fix (workaround):** destructure a function-local array literal instead
of an array parameter.

**Large fix:** qualify §5.10's array-destructure-param row as native-only
(matching how rest params are already marked), so the matrix reflects reality.

---

## Finding D — struct-element array literals silently lower to `std::vector` on AVR (no diagnostic)

```
src\main.ts(151,9) error [var_decl]: 'vector' in namespace 'std' does not name
a template type
      const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
```

```ts
const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
```

lowers to `std::vector<P> pts = { ... }` on AVR — and the
`TS2CPP_NO_VECTOR_STORAGE` diagnostic **does not fire** (verified: 0
diagnostics). So this is a **silent miscompilation**: it produces C++ that
cannot compile, with no transpiler-side warning. By contrast, a primitive
array (`int32_t[]`) on the same target lowers correctly to a C array
(`int32_t arr[] = { ... }`).

**Root cause (confirmed by isolation):**
- `int32_t[]` literal → `int32_t arr[] = { ... }` (C array — AVR-correct).
- `P[]` literal (struct element) → `std::vector<P> pts = { ... }` (AVR-broken).

The array-literal lowerer's StaticArray-vs-vector decision keys off the element
type: primitive elements take the C-array path; struct/interface elements take
the vector path. The AVR guard (`TS2CPP_NO_VECTOR_STORAGE`) only fires for
*parameters and fields* with a vector type — it does not cover a *function-local
array literal* lowered to vector, so the bad lowering slips through silently.

This is the most severe of the four findings because it is **silent** (no
diagnostic at all) and produces non-compiling C++. A struct-element array is a
common, reasonable construct.

**Demo fix (workaround):** parallel primitive arrays + manual indexing.

**Large fix:** two parts —
1. The array-literal lowerer should lower a struct-element array literal to
   `__tc_StaticArray<P, N>` (which IS AVR-supported and was the whole point of
   that type), not `std::vector<P>`. The size IS recoverable (the literal has N
   elements), so the StaticArray path is available. The element-type-based fork
   that sends structs to vector is the defect.
2. Until/unless that lands, the `TS2CPP_NO_VECTOR_STORAGE` gate should also
   fire for a function-local array literal that lowered to vector, so the
   failure is at least surfaced as a diagnostic rather than a silent
   miscompile.

---

# Categorization — two families

## Family I — `for...of` does not support a destructuring loop variable (Finding A)

A single isolated crash. The for...of lowerer assumes an identifier loop
variable and throws on a binding pattern. Fix: desugar the binding pattern to a
synthetic loop var + extraction statements (the same pattern parameter
destructuring already uses). Self-contained; no interaction with the others.

## Family II — AVR has no `std::vector`, and several array constructs lower to it (Findings B, C, D)

Three distinct array constructs all reduce to `std::vector<T>` and fail on AVR:

- **B:** rest-element destructuring (`...tail`) — documented in §1.9 but not
  AVR-qualified; reaches avr-g++ as a raw error (no transpiler diagnostic).
- **C:** array-typed parameter destructuring (`[a, b]: int32_t[]`) — correctly
  gated by `TS2CPP_NO_VECTOR_STORAGE` (the gate fires), but §5.10's ✅ doesn't
  note the AVR caveat.
- **D:** struct-element array literals (`P[] = [...]`) — **silently** lower to
  `std::vector` with NO diagnostic (the gate doesn't cover function-local
  literals), producing non-compiling C++.

The shared defect: AVR's no-`<vector>` constraint is enforced **inconsistently**.
`TS2CPP_NO_VECTOR_STORAGE` catches parameters and fields that lower to vector,
but misses rest elements (B) and function-local array literals (D). And the
SUPPORT_MATRIX ✅s in §1.9/§5.10 are native-only truths presented as universal.

**The large fixes:**
1. **D (most important):** lower struct-element array literals to
   `__tc_StaticArray<P, N>` (size is recoverable from the literal) instead of
   `std::vector`. This makes a common, reasonable construct actually work on AVR.
2. **Coverage:** extend `TS2CPP_NO_VECTOR_STORAGE` to fire for ANY construct
   that lowers to `std::vector` on AVR — including rest elements (B) and
   function-local literals (D) — so failures are always surfaced as a clean
   diagnostic, never a silent miscompile or a raw avr-g++ error.
3. **Matrix accuracy:** qualify §1.9 row 198 (rest element) and §5.10 (array
   destructure param) as native-only / 🚫-on-AVR, matching the existing rest-
   param qualification.

Finding A (Family I) is independent of the vector family and can be fixed on
its own.

---

## What the stress test confirmed WORKS

Once the four findings are worked around, the remaining 10 destructuring forms
compile and (per the emitted C++) lower correctly on AVR:

- **Object destructure** (`const { x, y } = p`) → `auto x = p->x; auto y = p->y;`.
- **Nested object destructure** (`const { origin: { x, y }, w } = r`).
- **Array destructure** (`const [a, b, c] = arr`) → index extraction.
- **Array destructure with default** (`const [first, second = 99] = arr`).
- **Object destructure with rename** (`const { x: px } = p`).
- **Swap** (`[a, b] = [b, a]`).
- **Class-field destructure** (`const { value } = instance`).
- **Generic destructure** (`const { v } = box<T>`).
- **Object / nested-object parameter destructure** (`f({ x, y })`,
  `f({ origin: { x } })`).
- **Mixed destructure + regular params** (`f({ x }, scale)`).

So the destructuring lowering is broadly sound; the gaps are for...of+destructure
(one crash) and the AVR-no-vector family (rest elements, array params,
struct-element literals).
