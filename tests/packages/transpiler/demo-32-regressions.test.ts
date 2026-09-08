// ---------------------------------------------------------------------------
// Demo #32 regressions — two transpiler gaps surfaced by a Conway's-Game-of-
// Life demo built around a `uint8_t[][]` 2D grid owned by a class, double-
// buffered and stepped with a toroidal (wraparound) neighbor scan. Both gaps
// are now FIXED in the transpiler; this file pins the behavior. The demo
// source carries the natural idiomatic forms (an enum value stored into
// `uint8_t` grid storage, an `uint8_t` cell read back into an enum-typed
// local, an enum value `.push`-ed into a `uint8_t[]`, and a `.join`-only
// program) and recompiles clean with correct output.
//
//   A — The enum↔integral STORAGE boundary was one-way. The transpiler cast
//       `enum → int` for comparisons (demo #28 E) and array-indices (demo #28
//       E) and `enum → int` for `const n: number = enumVal` initializers, but
//       NOT in the other directions a 2D-grid-of-cells demo stresses:
//         • `this->nxt[r][c] = next` (enum value → `uint8_t` storage) emitted
//           `this->nxt[r][c] = next` verbatim → g++ "cannot convert 'Cell' to
//           'unsigned char' in assignment".
//         • `const Cell alive = this->cur[r][c]` (`uint8_t` storage → enum
//           local) emitted `const Cell alive = this->cur[r][c]` → g++ "cannot
//           convert 'unsigned char' to 'const Cell'".
//         • `row.push(Cell.Dead)` (enum value → `uint8_t[]` element) lowered to
//           `row.push_back(Cell::Dead)` (a raw callee) → g++ "no matching
//           function for call to std::vector<unsigned char>::push_back(Cell)".
//       Root cause: a C++ `enum class` has NO implicit conversion to OR from
//       an integral type, and the three emit sites (assign RHS, var_decl
//       initializer reverse direction, push_back raw arg) each lacked the
//       boundary cast. The comparison/index sites already had it (demo #28 E).
//       Fix: a shared target-type-aware `renderValueForTarget` helper on
//       ExpressionRenderer centralizes BOTH directions — enum→integral casts
//       to `int` (delegating to the existing renderEnumSafeValue), integral→
//       enum casts to the enum type. The `assign` statement and the `var_decl`
//       initializer now route through it, and the `.push` IR-build path casts
//       the raw `push_back` argument when the receiver is an integral-element
//       vector. A shared `INTEGRAL_CPP_TYPE_RE` in cpp-helpers.ts replaces the
//       prior divergent inline `isNumericTarget` regex.
//       `emit/expression-renderer.ts` + `emit/statement-renderer.ts` +
//       `ir/transformers/array-methods.ts` + `emit/utils/cpp-helpers.ts`.
//
//   B — A program using `.join` (and ONLY `.join`) emitted the `__tc_join`
//       polyfill (which builds its result through a `std::ostringstream`) but
//       did NOT emit `#include <sstream>`. The `__tc_join` template lives in
//       the `array_methods` polyfill block, whose `requiredIncludes` listed
//       only `<algorithm>` and `<map>`. Prior `.join`-using demos compiled
//       only by accident — some OTHER polyfill (e.g. `__tc_toFixed` in the
//       `math_methods` block) happened to pull in `<sstream>` transitively. A
//       `.join`-only program (no Math.toFixed/random) got `std::ostringstream
//       has incomplete type` + a 16-candidate `operator<<` cascade.
//       Fix: `<sstream>` is now declared on the `array_methods` polyfill
//       block's `requiredIncludes`, so `.join` is self-contained.
//       `typecad-hal/src/frameworks/native/strategy.ts`.
//
// All fixes are pinned below. The demo source carries no workarounds.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

function transpileNativeCpp(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "cpp" });
}

// ── A: enum ↔ integral storage boundary ─────────────────────────────────────

describe("A: enum↔integral storage boundary casts", () => {
  it("casts an enum value assigned to integral element storage (this->field[i] = enumVal)", () => {
    // `this->nxt[r][c] = next` where `nxt` is `vector<vector<uint8_t>>` and
    // `next: Cell`. Must emit `static_cast<int>(next)` (or equivalent) so the
    // enum→integral assignment compiles.
    const src = `
const enum Cell { Dead = 0, Alive = 1 }
class Grid {
  cells: uint8_t[][];
  set(r: int32_t, c: int32_t, v: Cell): void {
    this.cells[r][c] = v;
  }
}
`;
    const res = transpileNativeSplit(src);
    const body = (res.header ?? "") + res.cpp;
    expect(body).toContain("this->cells[r][c] = static_cast<int>(v)");
  });

  it("casts an integral cell read into an enum-typed local (const E x = arr[i])", () => {
    // `const Cell alive = this->cur[r][c]` where `cur` is
    // `vector<vector<uint8_t>>`. Must emit `static_cast<Cell>(...)` so the
    // integral→enum initialization compiles. This is the REVERSE direction
    // from the historical enum→int var_decl cast.
    const src = `
const enum Cell { Dead = 0, Alive = 1 }
class Grid {
  cur: uint8_t[][];
  read(r: int32_t, c: int32_t): Cell {
    const v: Cell = this.cur[r][c];
    return v;
  }
}
`;
    const res = transpileNativeSplit(src);
    const body = (res.header ?? "") + res.cpp;
    expect(body).toContain("static_cast<Cell>(this->cur[r][c])");
  });

  it("casts an enum value pushed into an integral-element vector (row.push(Cell.Dead))", () => {
    // `row.push(Cell.Dead)` where `row: uint8_t[]`. The `.push` lowers to a
    // raw `row.push_back(ARG)` callee; the arg must be `static_cast<int>(...)`.
    const src = `
const enum Cell { Dead = 0, Alive = 1 }
function build(): uint8_t[] {
  const row: uint8_t[] = [];
  row.push(Cell.Dead);
  row.push(Cell.Alive);
  return row;
}
const _log = build().length;
`;
    const res = transpileNativeCpp(src);
    expect(res.cpp).toContain("row.push_back(static_cast<int>(Cell::Dead))");
    expect(res.cpp).toContain("row.push_back(static_cast<int>(Cell::Alive))");
  });

  it("still handles the historical enum→number var_decl initializer (const n: number = enumVal)", () => {
    // Regression guard: the generalized renderValueForTarget must not regress
    // the pre-existing enum→integral var_decl cast that the point-specific
    // isNumericTarget/initializerIsEnumValue block handled before.
    const src = `
const enum Color { Red = 0, Green = 1, Blue = 2 }
const n: number = Color.Green;
const _log = n;
`;
    const res = transpileNativeCpp(src);
    expect(res.cpp).toContain("static_cast<int>(Color::Green)");
  });

  it("does NOT cast an enum stored into enum-typed storage (no spurious cast)", () => {
    // A same-direction assignment (enum → enum field) must NOT gain a cast —
    // the boundary helper only fires across the enum↔integral line.
    const src = `
const enum Cell { Dead = 0, Alive = 1 }
class Holder {
  cell: Cell;
  set(c: Cell): void {
    this.cell = c;
  }
}
`;
    const res = transpileNativeSplit(src);
    const body = (res.header ?? "") + res.cpp;
    expect(body).toContain("this->cell = c");
    expect(body).not.toContain("static_cast");
  });

  it("does NOT cast a string-enum member pushed into a string vector", () => {
    // String enums lower to const char* and are never on the integral
    // boundary. `words.push(Color.Red)` on a `string[]` must stay verbatim.
    const src = `
enum Color { Red = 'red', Green = 'green' }
const words: string[] = [];
words.push(Color.Red);
const _log = words.length;
`;
    const res = transpileNativeCpp(src);
    expect(res.cpp).toContain("words.push_back(Color::Red)");
    expect(res.cpp).not.toContain("static_cast<int>(Color::Red)");
  });

  it("casts an enum-typed ternary result stored into integral storage", () => {
    // `this->cur[r][c] = cond ? Cell.Dead : Cell.Alive` — the ternary's
    // inferred type is `Cell` (both branches enum), the target is `uint8_t`.
    // Required a companion fix: `inferExpressionCppType`'s property-access
    // branch now returns the enum name for a numeric-enum member access
    // (`Cell.Dead`), so the ternary infers to `Cell` and the boundary fires.
    // Without it, `Cell.Dead` inferred to `undefined` and the ternary missed
    // the cast.
    const src = `
const enum Cell { Dead = 0, Alive = 1 }
class Life {
  cur: uint8_t[][];
  toggle(r: int32_t, c: int32_t, on: boolean): void {
    this.cur[r][c] = on ? Cell.Dead : Cell.Alive;
  }
}
const life: Life = new Life();
life.toggle(0, 0, true);
const _log = 'done';
`;
    const res = transpileNativeSplit(src);
    const body = (res.header ?? "") + res.cpp;
    expect(body).toMatch(/this->cur\[r\]\[c\] = static_cast<int>\(\(on \? Cell::Dead : Cell::Alive\)\)/);
  });

  it("end-to-end: a 2D-grid class steps and compiles with all three boundary sites", () => {
    // The full demo #32 shape: assign enum→integral, read integral→enum, and
    // push enum→integral all in one program. If ANY boundary site regresses,
    // g++ would reject the emitted C++; this asserts the emitted shapes.
    const src = `
const enum Cell { Dead = 0, Alive = 1 }
class Life {
  cur: uint8_t[][];
  rows: int32_t;
  cols: int32_t;
  constructor(rows: int32_t, cols: int32_t) {
    this.rows = rows;
    this.cols = cols;
    this.cur = [];
    for (let r: int32_t = 0; r < rows; r = r + 1) {
      const row: uint8_t[] = [];
      for (let c: int32_t = 0; c < cols; c = c + 1) {
        row.push(Cell.Dead);
      }
      this.cur.push(row);
    }
  }
  toggle(r: int32_t, c: int32_t): void {
    const v: Cell = this.cur[r][c];
    this.cur[r][c] = v === Cell.Alive ? Cell.Dead : Cell.Alive;
  }
}
`;
    const res = transpileNativeSplit(src);
    const body = (res.header ?? "") + res.cpp;
    // push enum→integral
    expect(body).toContain("row.push_back(static_cast<int>(Cell::Dead))");
    // read integral→enum
    expect(body).toMatch(/static_cast<Cell>\(this->cur\[r\]\[c\]\)/);
    // assign enum→integral (the ternary result stored into uint8_t storage)
    expect(body).toMatch(/this->cur\[r\]\[c\] = static_cast<int>\(/);
    // No build errors.
    expect(res.diagnostics.filter((d: any) => d.severity === "error")).toEqual([]);
  });
});

// ── B: `.join`-only program emits <sstream> ──────────────────────────────────

describe("B: .join polyfill is self-contained (includes <sstream>)", () => {
  it("a .join-only program emits both __tc_join AND <sstream>", () => {
    // The minimal repro: a `.join` call with no Math.toFixed/random (which
    // would pull <sstream> in via the math_methods block transitively).
    const src = `
const words: string[] = ['a', 'b', 'c'];
const _log = words.join('-');
`;
    const res = transpileNativeSplit(src);
    const header = res.header ?? "";
    expect(header).toContain("__tc_join");
    expect(header).toContain("<sstream>");
  });

  it("a .join inside a class method also emits <sstream>", () => {
    // The demo #32 shape: render() builds a string[] and joins it.
    const src = `
class Renderer {
  parts: string[];
  constructor() {
    this.parts = ['x', 'y', 'z'];
  }
  render(): string {
    return this.parts.join('\\n');
  }
}
const _log = new Renderer().render();
`;
    const res = transpileNativeSplit(src);
    const header = res.header ?? "";
    expect(header).toContain("__tc_join");
    expect(header).toContain("<sstream>");
  });
});
