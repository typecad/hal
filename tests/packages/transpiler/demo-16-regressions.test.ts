// ---------------------------------------------------------------------------
// Demo #16 regressions — type-aware switch discriminant lowering and
// scope-local ownership demotion.
//
// Fixes pinned here:
//   A — A `switch` whose discriminant is a property-access (e.g.
//       `switch (m.unit)` where `unit` is a `const enum` field) must NOT wrap
//       the discriminant in `std::string(...)`. The wrap is decided by the
//       discriminant's resolved C++ type (string-like → wrap; enum/numeric →
//       plain comparison; unknown → no wrap, always valid C++). Previously the
//       property-access form wrapped unconditionally, producing invalid C++
//       (`std::string` has no constructor from a scoped enum).
//   B — The ownership pass must resolve const-content-mutation per lexical
//       scope, not across all functions via a flat name-keyed map. A read-only
//       `const labels` in one function must not be demoted because a same-named
//       `let labels` is mutated in a sibling function. Cross-scope `let`
//       reassignment (suggest-const suppression) is still honored.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile, findDiagnostics } from "../../setup";

function transpileNative(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "cpp" });
}

// ── A: type-aware switch discriminant ───────────────────────────────────────

describe("A: switch on a property-access discriminant is type-aware", () => {
  it("switch on an enum-valued struct field emits a plain comparison (no std::string wrap)", () => {
    const result = transpileNative(`
      const enum Unit { Celsius = 1, Fahrenheit = 2 }
      interface Reading { unit: Unit; value: double; }
      function label(r: Reading): string {
        switch (r.unit) {
          case Unit.Celsius: return 'C';
          case Unit.Fahrenheit: return 'F';
          default: return '?';
        }
      }
      console.log(label({ unit: Unit.Celsius, value: 25.0 }));
    `);
    // Must compare the field directly — NOT wrap it in std::string(...).
    expect(result.cpp).toMatch(/r\.unit == Unit::Celsius/);
    expect(result.cpp).not.toMatch(/std::string\(r\.unit\)/);
  });

  it("switch on an enum field does not produce the illegal std::string(enum) ctor", () => {
    const result = transpileNative(`
      const enum Kind { A = 1, B = 2 }
      interface Item { kind: Kind; }
      function isA(i: Item): boolean {
        switch (i.kind) {
          case Kind.A: return true;
          default: return false;
        }
      }
      console.log(isA({ kind: Kind.A }));
    `);
    expect(result.cpp).toMatch(/i\.kind == Kind::A/);
    expect(result.cpp).not.toContain("std::string(i.kind)");
  });

  it("switch on a numeric struct field still compares directly", () => {
    // All-numeric case values lower to a real C++ `switch` on the field — no
    // std::string(...) wrap either way. (Numeric cases take the real-switch
    // path; the point of this case is that the field discriminant is never
    // wrapped regardless of which switch path is taken.)
    const result = transpileNative(`
      interface Pair { code: int32_t; }
      function name(p: Pair): string {
        switch (p.code) {
          case 1: return 'one';
          case 2: return 'two';
          default: return 'many';
        }
      }
      console.log(name({ code: 1 }));
    `);
    // Either a real `switch (p.code)` / `case 1:` or a direct comparison —
    // both are valid. What must NOT happen is the illegal std::string() wrap.
    expect(result.cpp).toContain("p.code");
    expect(result.cpp).not.toContain("std::string(p.code)");
  });

  it("a genuine string-field switch still wraps correctly (regression guard)", () => {
    // A string-typed field discriminant SHOULD still compare via std::string so
    // the const char* literal is compared by value. This guards the type-aware
    // branch against over-correcting (never wrapping a real string field).
    const result = transpileNative(`
      interface Rec { key: string; }
      function val(r: Rec): int32_t {
        switch (r.key) {
          case 'a': return 1;
          case 'b': return 2;
          default: return 0;
        }
      }
      console.log(val({ key: 'a' }));
    `);
    expect(result.cpp).toMatch(/std::string\(r\.key\) == "a"/);
  });
});

// ── B: scope-local ownership demotion ───────────────────────────────────────

describe("B: ownership demotion is resolved per lexical scope", () => {
  it("a read-only const Map is NOT demoted when a same-named binding is mutated in a sibling function", () => {
    const result = transpileNative(`
      function build(): Map<string, int32_t> {
        let m: Map<string, int32_t> = new Map();
        m.set('a', 1);
        return m;
      }
      function read(): int32_t {
        const m: Map<string, int32_t> = build();
        return m.get('a')!;
      }
      console.log(read());
    `);
    // No false "const-content-mutated" diagnostic should fire on `read`'s `m`.
    const mutated = findDiagnostics(result, "ownership-const-content-mutated");
    expect(mutated).toHaveLength(0);
  });

  it("a const Map that IS mutated in its own scope via .set() is still demoted", () => {
    // Regression guard: per-scope analysis must still catch a genuine
    // const-collection mutation within the same function.
    const result = transpileNative(`
      function f(): void {
        const m: Map<string, int32_t> = new Map();
        m.set('a', 1);
        console.log(m.get('a'));
      }
      f();
    `);
    const mutated = findDiagnostics(result, "ownership-const-content-mutated");
    expect(mutated.length).toBeGreaterThanOrEqual(1);
  });

  it("suggest-const is suppressed for a top-level let reassigned in another function", () => {
    // A top-level `let counter` reassigned inside `main()` must NOT be flagged
    // as "never reassigned" — cross-scope reassignment still counts.
    const result = transpileNative(`
      let counter: int32_t = 0;
      function main(): void {
        counter = 10;
        console.log(counter);
      }
      main();
    `);
    const suggest = findDiagnostics(result, "ownership-suggest-const");
    expect(suggest.filter((d: any) => /'counter' is never reassigned/.test(d.message ?? ""))).toHaveLength(0);
  });

  it("a genuinely never-reassigned let in its own scope is still suggested const", () => {
    // Regression guard for the suggest-const path itself.
    const result = transpileNative(`
      function main(): void {
        let x: int32_t = 5;
        console.log(x);
      }
      main();
    `);
    const suggest = findDiagnostics(result, "ownership-suggest-const");
    expect(suggest.length).toBeGreaterThanOrEqual(1);
  });
});
