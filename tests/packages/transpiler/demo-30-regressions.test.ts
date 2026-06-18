// ---------------------------------------------------------------------------
// Demo #30 regressions — four transpiler gaps surfaced by a markdown flattener
// + word-frequency analyzer demo. All four are now FIXED in the transpiler;
// this file pins the behavior. The demo source carries the natural idiomatic
// forms (a free function called as `.trim()` argument, `string.length`
// interpolated into a template, a `case X: default:` switch fall-through, and
// `new Set([...])` constructor-with-initial-elements) and recompiles clean
// with correct output.
//
//   A — A module-scope free function called from a class method ONLY through a
//       lowered `raw` wrapper (e.g. `freeFn(x).trim()` → `__tc_trim(freeFn(x))`,
//       where `freeFn(x)` is buried in the raw text) was tree-shaken from the
//       class-method visibility set. `setup.ts` had its OWN hand-rolled IR
//       walk that only inspected structured `call`/`method-call` nodes; it did
//       NOT extract identifiers from `raw` IR text (the canonical walk in
//       `identifier-collector.ts` DOES). So the function was emitted `static`
//       with no header prototype, and g++ reported "not declared in this scope"
//       from the inline class-method body. This is the SAME blind spot demo
//       #28 Finding C fixed in the tree-shaking walk: two parallel walks over
//       the same IR diverged. Fix: `setup.ts` now reuses the canonical
//       `collectStatementIdentifiers`, which already handles `raw`/`paren`/
//       `lambda`/`tuple-access`/`hal-expr`. Any free function reached through
//       ANY lowering is now visible. `emit/emitters/setup.ts`.
//
//   B — `.length` on a `std::string` lowered to the bare `s.length()` (which
//       returns `size_type`, an UNSIGNED value), while `.length` on an array/
//       vector lowered to `static_cast<long long>(x.size())` (SIGNED). The two
//       paths diverged. When interpolated into a template literal, the snprintf
//       format specifier for `.length`/`.size` was hardcoded to `%d`, which
//       mismatched the unsigned `size_type` (g++ -Wformat=: "expects int, has
//       size_type"). Fix: `.length` on a `std::string` now ALSO casts to
//       `static_cast<long long>(...)`, making `.length`/`.size` uniform across
//       every receiver; the snprintf specifier for `.length`/`.size` is now
//       `%lld` to match. `ir/expression-to-ir.ts` + `emit/expression-renderer.ts`.
//
//   D — A TS switch with `case X: default: { body }` (the fall-through-into-
//       default idiom) lowered to `if (x==X) {} else { body }` — the `case X`
//       branch was EMPTY and the shared body ran ONLY in the default. TS
//       semantics: `x==X` falls through into `default`'s body, so the body
//       runs for BOTH. The if/else-if chain can't express "X OR default →
//       body", so the fix groups consecutive fall-through cases (empty-body
//       cases) with the next clause that HAS a body; a `default` in a group
//       makes the whole group the catch-all `else` (correct: "X or anything
//       else"). This is the general fix for `case X: default:` AND chained
//       `case A: case B: body`. `emit/emitters/line-appender.ts`.
//
//   E — `new Set([a, b, c])` and `new Map([[k, v]])` (the idiomatic TS
//       constructor-with-initial-elements form) DROPPED the initializer
//       argument and emitted `{}` (an empty container). So a `const STOP_WORDS
//       = new Set([...])` started empty. The Set/Map ctor lowering returned a
//       hardcoded `{}` regardless of arguments. Fix: when an initializer
//       argument is present, it is rendered into the brace-init-list —
//       `argsText` already renders a single array literal as the
//       `{ a, b, c }` (Set) / `{ {k, v}, ... }` (Map) initializer-list form
//       the STL containers accept. `ir/expression-to-ir.ts`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ── A: free fn reached via a raw wrapper is visible from class methods ──────

describe("A: free function called through a lowered raw wrapper is header-visible", () => {
  it("freeFn(x).trim() — freeFn is the arg of a string-method lowering", () => {
    // The natural idiom `freeFn(x).trim()` lowers to `__tc_trim(freeFn(x))`; the
    // `freeFn(x)` call lives INSIDE the raw wrapper text. The class-method
    // visibility walk must extract `freeFn` from the raw text, or it is emitted
    // `static` with no header prototype and g++ rejects the inline method body.
    const result = transpileNativeSplit(`
      function freeFn(s: string): string { return s + "!"; }
      class C {
        public run(s: string): string {
          return freeFn(s).trim();
        }
      }
      export function main(): void {
        const c = new C();
        console.log(c.run("hi"));
      }
    `);
    const header = result.header ?? "";
    // A non-static prototype for freeFn must appear in the header so the
    // inline C::run body (which lives in the header in split mode) can see it.
    expect(header).toMatch(/\bfreeFn\(/);
    expect(header).not.toMatch(/static\s+.*freeFn\(/);
  });

  it("direct call from a class method still works (regression)", () => {
    // The pre-existing shape (demo #18 fix B): a direct `freeFn(val)` call from
    // a method body. Must remain header-visible after the walk was rewritten.
    const result = transpileNativeSplit(`
      function helper(x: int32_t): int32_t { return x + 1; }
      class Processor {
        public process(val: int32_t): int32_t { return helper(val); }
      }
      export function main(): void {
        const p = new Processor();
        console.log(p.process(42));
      }
    `);
    const header = result.header ?? "";
    expect(header).toMatch(/\bhelper\(/);
    expect(header).not.toMatch(/static\s+.*helper\(/);
  });

  it("freeFn(x).toLowerCase().slice(1) — chained string methods wrapping freeFn", () => {
    // A longer chain: the whole chain lowers to nested __tc_* raw wrappers,
    // and freeFn sits at the bottom. Must still be header-visible.
    const result = transpileNativeSplit(`
      function seed(): string { return "SEED"; }
      class C {
        public go(): string {
          return seed().toLowerCase().slice(1);
        }
      }
      export function main(): void {
        const c = new C();
        console.log(c.go());
      }
    `);
    const header = result.header ?? "";
    expect(header).toMatch(/\bseed\(/);
    expect(header).not.toMatch(/static\s+.*seed\(/);
  });
});

// ── B: .length on std::string casts to long long; snprintf uses %lld ───────

describe("B: .length / .size renders as static_cast<long long> with %lld format", () => {
  it("lowers string .length to static_cast<long long>(s.length())", () => {
    const cpp = transpileNativeSingle(`
      export function main(): int32_t {
        const s: string = "hello";
        return s.length;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/static_cast<long long>\(s\.length\(\)\)/);
    // Must NOT be the bare unsigned `s.length()`.
    expect(cpp).not.toMatch(/return\s+s\.length\(\)\s*;/);
  });

  it("lowers this.field.length (std::string field) the same way", () => {
    const cpp = transpileNativeSingle(`
      class C {
        private name: string;
        constructor() { this.name = "abc"; }
        len(): int32_t { return this.name.length; }
      }
      export function main(): int32_t { const c = new C(); return c.len(); }
    `).cpp ?? "";
    expect(cpp).toMatch(/static_cast<long long>\(this->name\.length\(\)\)/);
  });

  it("uses %lld (not %d) for a .length interpolated into a template literal", () => {
    // The previous hardcoded `%d` mismatched the unsigned size_type returned by
    // std::string::length() and the static_cast<long long>(...) rendering.
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const s: string = "hello";
        console.log(\`len=\${s.length}\`);
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/%lld/);
    expect(cpp).not.toMatch(/len=%d/);
  });

  it("uses %lld for an array .length interpolated into a template literal", () => {
    // The array `.length` path was already `static_cast<long long>(x.size())`;
    // the format specifier must match it too (it previously hardcoded %d).
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const xs: int32_t[] = [1, 2, 3];
        console.log(\`n=\${xs.length}\`);
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/n=%lld/);
  });
});

// ── D: switch case X: default: body fall-through ───────────────────────────

describe("D: switch `case X: default:` fall-through runs the body for X too", () => {
  it("case Plain: default: { body } — Plain branch is NOT empty", () => {
    // TS parses `case X: default: { body }` as a `case X` with EMPTY body that
    // falls through into `default`'s body. The naive if/else-if emit produced
    // `if (x==X) {} else { body }` — the X branch ran nothing. The fix groups
    // the empty X case with the default, emitting the shared body as the
    // catch-all else (X OR anything-else → body).
    const cpp = transpileNativeSingle(`
      const enum K { A = 0, B = 1 }
      function classify(k: K): int32_t {
        switch (k) {
          case K.A: {
            return 1;
          }
          case K.B:
          default: {
            return 99;
          }
        }
      }
      export function main(): int32_t { return classify(K.B); }
    `).cpp ?? "";
    // The default body (`return 99;`) must be reachable. It must NOT be gated
    // behind an empty `if (k == K::B) {}` with the body only in a separate
    // else. The body should sit in the final `else` (the catch-all), and there
    // must be NO empty-bodied `else if (k == K::B)` branch.
    expect(cpp).toMatch(/return 99/);
    // No empty `else if (...K::B) { }` followed by a separate `else` carrying
    // the body — that is the buggy shape.
    expect(cpp).not.toMatch(/else if \(k == K::B\)\s*\{\s*\}/);
  });

  it("case A: case B: { sharedBody } — both A and B run sharedBody", () => {
    // Two named cases sharing one body (chained fall-through, no default). The
    // fix joins their conditions with `||`.
    const cpp = transpileNativeSingle(`
      const enum K { A = 0, B = 1, C = 2 }
      function label(k: K): int32_t {
        switch (k) {
          case K.A:
          case K.B: {
            return 1;
          }
          case K.C: {
            return 2;
          }
        }
        return 0;
      }
      export function main(): int32_t { return label(K.A); }
    `).cpp ?? "";
    // The A and B conditions must be OR-joined into one branch carrying the
    // shared body (`return 1;`).
    expect(cpp).toMatch(/k == K::A \|\| .*k == K::B/);
  });

  it("case A: case B: default: { body } — all three share the body", () => {
    // Chained fall-through into default: A, B, AND default all run the body.
    // The fix groups all three and emits the body as the catch-all else.
    const cpp = transpileNativeSingle(`
      const enum K { A = 0, B = 1, C = 2 }
      function pick(k: K): int32_t {
        switch (k) {
          case K.C: {
            return 7;
          }
          case K.A:
          case K.B:
          default: {
            return 9;
          }
        }
      }
      export function main(): int32_t { return pick(K.A); }
    `).cpp ?? "";
    expect(cpp).toMatch(/return 9/);
    // The C case keeps its own branch (`return 7;`), distinct from the shared
    // default body.
    expect(cpp).toMatch(/return 7/);
    // No empty-bodied A or B branches.
    expect(cpp).not.toMatch(/else if \(k == K::A\)\s*\{\s*\}/);
    expect(cpp).not.toMatch(/else if \(k == K::B\)\s*\{\s*\}/);
  });
});

// ── E: new Set([...]) / new Map([...]) initializer is rendered ──────────────

describe("E: new Set([elements]) and new Map([entries]) populate the container", () => {
  it("new Set<string>(['a','b','c']) renders the elements in the brace-init", () => {
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const s: Set<string> = new Set(['a', 'b', 'c']);
        console.log('done');
      }
    `).cpp ?? "";
    // The initializer must carry the elements, NOT be the empty `{}`.
    expect(cpp).toMatch(/"a"/);
    expect(cpp).toMatch(/"b"/);
    expect(cpp).toMatch(/"c"/);
  });

  it("a top-level const Set initialized with new Set([...]) keeps its elements", () => {
    // The demo #30 shape: a top-level `const STOP = new Set([...])`. Previously
    // the elements were dropped and the set started empty.
    const cpp = transpileNativeSingle(`
      const STOP: Set<string> = new Set(['x', 'y']);
      export function main(): void { console.log('ok'); }
    `).cpp ?? "";
    expect(cpp).toMatch(/"x"/);
    expect(cpp).toMatch(/"y"/);
    // Must not be a bare `= {};` with no elements.
    const initLine = cpp.split("\n").find(l => /STOP/.test(l) && /=/.test(l));
    expect(initLine).toBeTruthy();
    expect(initLine).not.toMatch(/=\s*\{\s*\}\s*;/);
  });

  it("new Map<string, number>([['k', 1]]) renders the entry pair", () => {
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const m: Map<string, int32_t> = new Map([['k', 1]]);
        console.log('done');
      }
    `).cpp ?? "";
    // The initializer must carry the key/value pair, NOT be the empty `{}`.
    expect(cpp).toMatch(/"k"/);
    // The 1 must appear as part of the map initializer (not somewhere else).
    expect(cpp).toMatch(/\{\s*"k",\s*1\s*\}/);
  });

  it("new Set() / new Map() with NO args still render as empty {}", () => {
    // Regression: the empty-ctor form must still lower to `{}`.
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const s: Set<string> = new Set();
        const m: Map<string, int32_t> = new Map();
        console.log('done');
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/=\s*\{\s*\}/);
  });
});
