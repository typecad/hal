// ---------------------------------------------------------------------------
// Demo #29 regressions — four transpiler gaps surfaced by a CRC-32 + INI-parser
// demo. All four are now FIXED in the transpiler; this file pins the behavior.
// The demo source has been reverted to its natural idiomatic form (a `'\n'`
// literal as a `.split`/`.join` argument, a `new Array<T>(n)` sized
// constructor, `.size` on a `this.field` Map, and an inline array literal as a
// `.join` receiver) and recompiles clean with byte-for-byte identical, correct
// output.
//
//   A — A string literal containing a control char or backslash, rendered as a
//       method-call argument, was only quote-escaped (not `\n`/`\t`/`\\`-
//       escaped), so it emitted a RAW control char inside the C++ string
//       literal → an unterminated literal → a cascade of ~25 false g++ errors.
//       The standalone renderer now routes through the shared
//       `escapeCppStringLiteral` (the same escaper the template-literal path
//       uses). `ir/render-expr.ts`.
//
//   B — The `new Array<T>(n)` sized constructor was emitted verbatim
//       (`new Array<uint32_t>(256)`) and failed at g++ time ("'Array' does not
//       name a type"); the UNTYPED `new Array(n)` had neither a lowering nor a
//       gate. The typed form now lowers to `std::vector<T>(n)`, and the
//       untyped form is build-time rejected with a clear diagnostic.
//       `ir/expression-to-ir.ts` + `ir/feature-registry.ts`.
//
//   C — `.size` on a `this.field` / `obj.field` Map/Set receiver was not
//       lowered to `.size()`; only bare-identifier receivers were handled, so
//       it emitted the bare member `this->field.size` (g++: "has no member
//       named 'size'"). The receiver type is now resolved via the shared
//       `resolveExprCppType`, which covers bare identifiers AND member
//       receivers — mirroring the `.length` fix from demos #22/#27.
//       `ir/expression-to-ir.ts`.
//
//   D — An INLINE array literal as a `__tc_*` helper receiver
//       (`[...].join(sep)`) rendered as a bare brace-init-list `{...}`, which
//       cannot drive template argument deduction (g++: "couldn't deduce
//       template parameter 'T'"). An inline array literal with a known element
//       type now renders as a typed `std::vector<ElemType>{...}`.
//       `ir/render-expr.ts` + `ir/expression-to-ir.ts`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

// ── A: string literal with control char as method arg is fully escaped ──────

describe("A: string literal with control chars is escaped in standalone rendering", () => {
  it("escapes a '\\n' literal passed to .split (no raw newline in the C++ string)", () => {
    const cpp = transpileNativeSingle(`
      export function main(): int32_t {
        const lines: string[] = "a\\nb".split('\\n');
        return lines.length;
      }
    `).cpp ?? "";
    // The lowered __tc_split delimiter must be the escape sequence "\n", NOT a
    // raw newline inside the string literal (which would break C++ lexing).
    expect(cpp).toMatch(/__tc_split\([^,]+,\s*"\\n"\)/);
    // And there must be NO raw newline sandwiched between quotes.
    expect(cpp).not.toMatch(/"[\r\n]"/);
  });

  it("escapes a '\\t' and '\\\\' in a string literal method argument", () => {
    const cpp = transpileNativeSingle(`
      export function main(): int32_t {
        const parts: string[] = "a\\tb\\\\c".split('\\t');
        return parts.length;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/"\\t"/);
    expect(cpp).not.toMatch(/"[\t]"/);
  });

  // Sibling of A (found looking wider): the SAME partial-escape bug existed in
  // a SECOND renderer — `expression-renderer.ts` `inferFormatSpecifier`, which
  // emits a string-literal template/concat part as a snprintf %s arg. It
  // escaped only `\` and `"` (not `\n`/`\r`/`\t`), so a standalone string-
  // literal interpolation part carrying a control char emitted a RAW control
  // char inside the C++ string literal. Now routes through the shared
  // `escapeCppStringLiteral`, the same fix as the standalone renderer.
  it("sibling: escapes a '\\n' in a standalone ${'literal'} template part", () => {
    const cpp = transpileNativeSingle(`
      export function main(): void { const _log = \`\${'x\\ny'}\`; }
    `).cpp ?? "";
    // Must be the escape sequence "\n" inside the string literal, not a raw
    // newline (which would break C++ lexing of the rest of the file).
    expect(cpp).toMatch(/"x\\ny"/);
    expect(cpp).not.toMatch(/"x[\r\n]/);
  });

  it("sibling: escapes a '\\t' in a ${literal}${var} template (forces %s arg path)", () => {
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const v: int32_t = 5;
        const _log = \`\${'a\\tb'}\${v}\`;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/"a\\tb"/);
    expect(cpp).not.toMatch(/"a[\t]/);
  });
});

// ── B: new Array<T>(n) lowers to std::vector<T>(n); untyped new Array rejected ─

describe("B: new Array<T>(n) sized constructor", () => {
  it("lowers new Array<uint32_t>(256) to std::vector<uint32_t>(256)", () => {
    const cpp = transpileNativeSingle(`
      export function main(): int32_t {
        const table: uint32_t[] = new Array<uint32_t>(256);
        table[0] = 1;
        return table.length;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/std::vector<uint32_t>\(256\)/);
    // Must NOT be the verbatim `new Array<...>(...)` that g++ rejects.
    expect(cpp).not.toMatch(/new Array/);
  });

  it("lowers new Array<T>() (empty) to std::vector<T>()", () => {
    const cpp = transpileNativeSingle(`
      export function main(): int32_t {
        const v: int32_t[] = new Array<int32_t>();
        return v.length;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/std::vector<int32_t>\(\)/);
  });

  it("rejects the UNTYPED new Array(n) with a TS2CPP_NO_EQUIVALENT diagnostic", () => {
    const result = transpileNativeSingle(`
      export function main(): int32_t {
        const v = new Array(256);
        return v.length;
      }
    `);
    const diags = result.diagnostics.filter(
      (d) => d.code === "TS2CPP_NO_EQUIVALENT" && /new Array|element type/i.test(d.message)
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("error");
  });
});

// ── C: .size on a this.field / obj.field Map receiver lowers to .size() ──────

describe("C: .size on a member-receiver Map/Set lowers to .size()", () => {
  it("lowers this.values.size (Map field) to this->values.size()", () => {
    const cpp = transpileNativeSingle(`
      class Cfg {
        private values: Map<string, string>;
        constructor() { this.values = new Map(); }
        size(): int32_t { return this.values.size; }
      }
      export function main(): int32_t { const c = new Cfg(); return c.size(); }
    `).cpp ?? "";
    // Must be the method call with parens, NOT the bare member.
    expect(cpp).toMatch(/this->values\.size\(\)/);
    expect(cpp).not.toMatch(/this->values\.size(?!\()/);
  });

  it("lowers a bare-identifier Map .size (regression — still works)", () => {
    const cpp = transpileNativeSingle(`
      export function main(): int32_t {
        const m: Map<string, int32_t> = new Map();
        m.set('a', 1);
        return m.size;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/\.size\(\)/);
  });
});

// ── D: inline array literal as __tc_* receiver renders typed vector ─────────

describe("D: inline array literal __tc_* receiver deduces template type", () => {
  it("renders [...].join(sep) as __tc_join(std::vector<std::string>{...}, sep)", () => {
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const s: string = ['a', 'b', 'c'].join(',');
      }
    `).cpp ?? "";
    // The receiver must be a TYPED std::vector<...>{...} (deducible), not a
    // bare brace-init-list (which cannot drive template argument deduction).
    expect(cpp).toMatch(/__tc_join\(std::vector<std::string>\{/);
    // The bare `{` form (no std::vector prefix) must not appear as the join
    // receiver.
    expect(cpp).not.toMatch(/__tc_join\(\{/);
  });

  it("renders an inline int32[] literal as std::vector<int32_t>{...}", () => {
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const s: string = [1, 2, 3].join('-');
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/__tc_join\(std::vector</);
  });
});
