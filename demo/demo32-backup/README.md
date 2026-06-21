# Conway's Game of Life on a toroidal 2D grid — cuttlefish demo #32

A **mid-complexity, idiomatic TypeScript** program built around one cellular
automaton — a `class Life` that steps a 2D grid of cells forward one
generation at a time using the classic Conway rules:

1. A live cell with 2 or 3 live neighbors stays alive.
2. A live cell with fewer than 2 or more than 3 neighbors dies
   (underpopulation / overpopulation).
3. A dead cell with exactly 3 live neighbors becomes alive (birth).

`class Life` owns TWO parallel `uint8_t[][]` grids — `cur` (the current
generation) and `nxt` (the buffer the next generation is written into) — and
swaps them after each `step()`. The grid is **toroidal**: the neighbor scan
wraps around the edges with modular arithmetic
(`(r + dr + rows) % rows`), so every cell has exactly eight neighbors. Classic
patterns (block, blinker, glider) are seeded from compact `number[][]` shape
literals stamped onto the grid at an offset.

This is the **thirty-second** demo iteration. Like #15–#31 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. It deliberately picks a **different data shape** from #15–#31 (parallel
arrays, Maps, struct arrays, tries, heaps, linked lists, union-finds, ciphers,
interpreters, CRC/INI parsers, markdown flatteners, Roman-numeral converters):

- **a `uint8_t[][]` 2D nested-array FIELD on a class** — the genuinely
  under-tested shape (SUPPORT_MATRIX §1.5 marked 2D arrays 🟡 "lowered but
  uncommon"; no prior demo exercised them). The class owns TWO of them and
  swaps them.
- **double-buffered `cur`/`nxt` swap** — `const tmp = this.cur; this.cur =
  this.nxt; this.nxt = tmp;` reassigning a whole `T[][]` field through a local
  alias (a 3-way value swap; semantically correct, just 3 deep copies instead
  of `std::swap`).
- **a `number[][]` shape literal stamped onto the grid** — a small 2D pattern
  literal iterated with a nested `for` loop and written through
  `this.cur[r][c] = v` (2D index assignment through a class field).
- **a toroidal neighbor scan** — modular wraparound index arithmetic inside a
  nested `for` over `dr`/`dc` in `[-1, 0, 1]`, reading `this.cur[rr][cc]`.
- **a `const enum Cell`/`Transition` + numeric `switch`** driving the
  birth/survival transition.
- **a `render()` that builds a multi-line frame** by `parts.push`-ing one
  string per grid row, each row a hand-built `'.'`/`'#'` run, then
  `parts.join('\n')`.

Transpiled to C++ by cuttlefish (`@typecad/framework-native`).

The previous iteration (#31, Roman numerals + English number words) is
preserved in `demo31-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0**. `g++` emits **no errors and no warnings**.
  (Three `ownership-suggest-const` info hints and one `TS2CPP_APPROXIMATE`
  info hint for the `as Cell` cast fire — all info-level, matching the
  convention of prior demos which accept `ownership-suggest-const` hints.)
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans — that is exactly how the two findings below were
  discovered on the first compile attempt.
- The binary runs with correct output (verified against a reference JS
  implementation).

## Sample output

```
--- Conway Game of Life demo ---
[seed] population = 12
[gen 1] population = 11
[frame 1]
.....#.
.#...##
.#...##
.......
#.#....
#.#....
[gen 2] population = 10
[gen 3] population = 13
[gen 4] population = 6
[frame 4]
.#...#.
#...#..
....#..
#......
.......
.......
done
```

Verified against a reference JavaScript implementation of the same algorithm
on the same 6×7 toroidal grid with the same seeded patterns. The population
sequence (12, 11, 10, 13, 6) and both rendered frames are byte-for-byte
identical. The population is NOT constant because the 6×7 toroidal grid is
small enough that the three seeded patterns (block, blinker, glider) interact
within a few steps — the toroidal wrap brings the glider's leading edge back
into the blinker's neighborhood and they collide.

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width `int32_t`, `uint8_t`, `boolean` → `bool`
- §1.5  **2D `uint8_t[][]` / `number[][]` arrays** → `std::vector<std::vector<...>>`,
  as a class field with indexed read/write (`this->cells[r][c]`), iterated
  with nested `for` loops over `g[i].length`, double-buffer-swapped, and
  stamped from a `number[][]` literal.
- §1.7  `const enum Cell`/`Transition` + numeric `switch`, AND the
  **enum↔integral storage boundary** in both directions (enum value stored
  into `uint8_t` grid storage, `uint8_t` cell read back into an enum-typed
  local, enum value `.push`-ed into a `uint8_t[]`).
- §2.2  C-style `for (let i; i < N; i = i + 1)`, nested `for` over a 2D grid,
  `for` over `dr`/`dc` with modular wraparound.
- §3.1  a module-scope free function (`makeGrid`) called from a class ctor.
- §4.1  a `class` with instance fields (two `uint8_t[][]`, two `int32_t`),
  instance methods, and a ctor.
- §5.3  `.push`, `.join('\n')` on a `.push`-built `string[]`.

---

# Transpilation issues found by Demo #32

Demo #32 was written around a `class Life` owning a `uint8_t[][]` 2D grid whose
cells are read and written as a `const enum Cell`. The **first** compile
attempt failed with two distinct `g++` error families. They are reproduced
verbatim below (as the CLI surfaced them, mapped to TS spans). Both were traced
to root cause, **fixed in the transpiler** (not worked around in source), and
the demo now compiles and runs cleanly in its natural idiomatic form.

## Finding A — the enum↔integral storage boundary was one-way (NEW)

A C++ `enum class` has **no implicit conversion to OR from an integral type**.
The transpiler already cast `enum → int` for comparisons (demo #28 E), array
indices (demo #28 E), Map/Set keys (demo #28 E review), and `const n: number =
enumVal` initializers. But a 2D-grid-of-cells demo stresses the boundary in
the directions those casts did NOT cover:

- `this->nxt[r][c] = next` (enum value → `uint8_t` storage):

  ```
  src\main.ts (175,9) error [var_decl]: cannot convert 'Cell' to
      '__gnu_cxx::__alloc_traits<...>::value_type' {aka 'unsigned char'}
      in assignment
          let n: int32_t = 0;
          ^
  ```

- `const Cell alive = this->cur[r][c]` (`uint8_t` storage → enum local):

  ```
  src\main.ts (149,9) error [switch]: cannot convert 'unsigned char' to
      'const Cell' in initialization
          switch (transition) {
          ^
  ```

- `row.push(Cell.Dead)` (enum value → `uint8_t[]` element via a raw
  `push_back` callee):

  ```
  src\main.ts (230,7) error [call]: no matching function for call to
      'std::vector<unsigned char>::push_back(Cell)'
          row.push(Cell.Dead);
          ^
  ```

**Root cause (generalizable):** three distinct emit/IR-build sites each
under-applied the enum↔integral boundary cast:

1. The `assign` statement RHS (`emit/statement-renderer.ts`) rendered the
   value with plain `render()`, never type-aware — so `this->cells[i] =
   enumVal` emitted the raw enum value.
2. The `var_decl` initializer path handled ONLY the enum→numeric direction
   (via a point-specific `isNumericTarget`/`initializerIsEnumValue` inline
   check), NOT the reverse numeric→enum direction.
3. The `.push` IR-build path (`ir/transformers/array-methods.ts`) lowered
   `row.push(arg)` to a raw `row.push_back(ARG)` callee with the argument
   baked into the text — so the emit layer never saw the argument as a
   structured value and could not cast it.

A fourth related case — a ternary `(c ? Cell.Dead : Cell.Alive)` stored into
integral storage — surfaced a **deeper root cause**: `inferExpressionCppType`'s
`property-access` branch returned `undefined` for a numeric-enum member access
(`Cell.Dead`), because `Cell` is an enum name (not in the known-variable map
nor the interface-field map). So the ternary inferred to `undefined`, the
boundary helper saw a non-enum value, and no cast fired.

**Fix (the widest generalization):** a single target-type-aware
`renderValueForTarget` helper on `ExpressionRenderer` centralizes BOTH
directions of the boundary:

- enum value → integral target → delegates to the existing `renderEnumSafeValue`
  (`static_cast<int>(...)`).
- integral value → enum target → `static_cast<EnumType>(...)`.

The `assign` statement RHS and the `var_decl` initializer now route through
it. The `.push` IR-build path casts the raw `push_back` argument when the
receiver is an integral-element vector (`renderPushArgForElement`). A shared
`INTEGRAL_CPP_TYPE_RE` (`emit/utils/cpp-helpers.ts`) replaces the prior
divergent inline `isNumericTarget` regex — the single source of truth for
"integral C++ scalar type". And `inferExpressionCppType`'s `property-access`
branch now returns the enum name for a numeric-enum member access, so wrapping
expressions (ternary, paren) whose branches are enum members infer to the enum
and the boundary fires.

The idiomatic source uses the natural `this->cells[i] = enumVal`,
`const E x = arr[i]`, `row.push(enumVal)`, and `cond ? Cell.A : Cell.B` forms.

## Finding B — a `.join`-only program emitted `__tc_join` without `<sstream>` (NEW)

```
src\main.ts (81,1) error [function_declaration: ruleFor]: 'std::ostringstream
    oss' has incomplete type
    function ruleFor(alive: Cell, neighbors: int32_t): Transition {
    ^
```

(The `ruleFor` source span is a `-Wtemplate-body` cascade artifact — g++
reports the first error in the translation unit against the nearest template
body, which was the `__tc_join` template just above `ruleFor`. The real error
is the `incomplete type` for `std::ostringstream`.)

`render()` builds a frame via `parts.join('\n')`. The `__tc_join` polyfill
builds its result through a `std::ostringstream`:

```cpp
template<typename T> std::string __tc_join(const std::vector<T>& v,
    const std::string& delim) { std::ostringstream oss; ... }
```

— but the `array_methods` polyfill block's `requiredIncludes` listed only
`<algorithm>` and `<map>`. The `__tc_join` template needs `<sstream>`, which
was NOT declared on its block.

**Root cause (generalizable):** a polyfill block's `requiredIncludes` is the
contract for "what standard headers this block's helpers need". The
`array_methods` block added `__tc_join` (which uses `<sstream>`) without
adding `<sstream>` to its own `requiredIncludes`. Prior `.join`-using demos
(#29, #30, #31) compiled only **by accident** — some OTHER polyfill they
pulled in (e.g. `__tc_toFixed` in the `math_methods` block, which correctly
declares `<sstream>`) transitively satisfied the include. A `.join`-only
program (no `Math.toFixed`/`Math.random`) had no such transitive source, so
`<sstream>` was missing and `std::ostringstream` was an incomplete type.

**Fix:** `<sstream>` is now declared on the `array_methods` polyfill block's
`requiredIncludes`, so `.join` is self-contained
(`framework-native/src/strategy.ts`).

---

## Why no eslint / transpiler-check was added

Both findings were **transpiler bugs on fully-supported, idiomatic TypeScript
patterns** — not unsupported user code. An enum value stored into an
integral-typed array, a `.join` call, and a 2D array are all legitimate,
documented-as-supported patterns. A lint gate or build-time rejection would
**wrongly reject** correct user code. The fixes are purely transpiler-internal
(cast insertion + include declaration), so no end-user-facing check is
appropriate. This is documented here so a future maintainer does not add one
by mistake.

## What lowered correctly (the point of this demo)

With A/B fixed in the transpiler, every data shape the demo was written to
stress lowers and runs correctly from its natural idiomatic source:

- **2D `uint8_t[][]` class field** — `vector<vector<uint8_t>>` with indexed
  read/write `this->cells[r][c]` (Finding A made the enum↔integral boundary
  work at this site).
- **double-buffer swap** — `const tmp = this.cur; this.cur = this.nxt;
  this.nxt = tmp;` (a 3-way value swap; correct, just 3 deep copies).
- **`number[][]` literal stamped** — `BLOCK`/`BLINKER`/`GLIDER` iterated and
  written through `this.cur[r][c] = Cell.Alive`.
- **toroidal neighbor scan** — modular wraparound reads `this.cur[rr][cc]`.
- **`const enum Cell`/`Transition` + numeric `switch`**, **nested `for`
  loops**, **`parts.push` + `parts.join('\n')`** (Finding B made `.join`
  self-contained) all lower cleanly.

---

## What this demo intentionally does NOT cover

To keep the program mid-complexity and idiomatic rather than a
feature-exhaustion test, demo #32 deliberately does **not** exercise:

- `extends` / `super` inheritance (covered by earlier demos),
- `try`/`catch` (no exception path in a cellular automaton),
- `Map`/`Set` (the grid is array-backed; #15/#30 covered containers),
- multi-file modules (the whole program is one `main.ts`),
- higher-rank generics.

Each of those is its own future demo with its own data shape.
