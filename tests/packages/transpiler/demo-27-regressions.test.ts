// ---------------------------------------------------------------------------
// Demo #27 regressions — transpilation gaps surfaced by a small, idiomatic
// Vigenère-cipher + frequency-analysis demo. All four are now FIXED in the
// transpiler; this file pins the behavior.
//
//   D — String-method calls (`.toLowerCase`, `.substring`, `.charAt`, ...)
//       on a NON-bare-identifier receiver — an indexed element (`ALPHABET[i]`),
//       a pointer chain (`obj->field`), or a member chain (`obj.field`) — were
//       left VERBATIM in the emitted C++ (g++: "no member 'toLowerCase'").
//       Root cause: string methods were lowered by a post-emit text rewrite
//       (`applyStringMethodRewrites`) whose `RECEIVER_PATTERN` only matched
//       bare identifiers and `.member` chains — NOT `X[i]` element access or
//       `X->member` pointer chains. Array mutators were migrated off this same
//       regex family in demo #22 into structural IR lowering
//       (`tryLowerArrayAndStringMethods`); string methods were left behind.
//       Fix: route string methods through the identical structural path so the
//       receiver is rendered via `expressionToIR` (handling bare id /
//       `this.field` / `obj.field` / `X[i]` / chains uniformly). Every string
//       method in `STRING_METHODS` gains correct lowering on every receiver
//       shape in one change. `ir/transformers/array-methods.ts`.
//
//   E — The `__tc_*` string-method helper (e.g. `__tc_toLowerCase`) was emitted
//       at the call site but NEVER DECLARED (g++: "'__tc_toLowerCase' was not
//       declared in this scope"). Root cause: the helper-registration scan in
//       `program-analysis.ts` walked the rendered IR text for `.toLowerCase(`
//       substrings, but when (D) left the call verbatim in a node shape the
//       scan didn't visit, the helper was never registered. Fixed transitively
//       by (D): the structural lowering emits `__tc_toLowerCase(...)` into a
//       `raw` IR node that the existing `expr.value.includes(name)` scan sees.
//
//   C — `.length` on a FUNCTION-LOCAL `std::vector` lowered to the invalid
//       `vector.length()` (g++: "'class std::vector<...>' has no member named
//       'length'"). Two branches in `resolveLengthProperty` emitted `.length()`
//       for a `mutableArrayVars` local and for an `activeArrayLiteralVars`
//       local whose type was `std::vector<...>`/`StaticArray<...>`. The
//       top-level-const-array and `this.field` paths already worked (the latter
//       fixed by demo #22 fix F); only the bare-local-identifier path was
//       broken. Fix: both branches now emit `static_cast<long long>(x.size())`.
//       `ir/expression-to-ir.ts`. (`std::string` keeps `.length()` — valid.)
//
// (Finding A — `Map.has`/`Map.get` narrowing — is pure TS strictness, out of
//  scope. Finding B — `string` indexing yields `char` — is correct C++, not a
//  transpiler gap. Finding F — `TS2CPP_GLOBAL_NAME_COLLISION` over-reach — is
//  pinned in `tests/semantic-gates.test.ts`, not here.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

// ── D: string methods on non-bare-identifier receivers ─────────────────────

describe("D: string methods on indexed/member/pointer receivers", () => {
  it("lowers arr[i].toLowerCase() to __tc_toLowerCase(arr[i]) (indexed receiver)", () => {
    const result = transpileNativeSingle(`
      export function main(letters: string[], i: int32_t): string {
        return letters[i].toLowerCase();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // The receiver must be the full indexed expression, and the call must be
    // rewritten to the helper (not left as `.toLowerCase()`).
    expect(out).toMatch(/__tc_toLowerCase\(letters\[i\]\)/);
    expect(out).not.toMatch(/\.toLowerCase\(\)/);
  });

  it("lowers obj.field.toUpperCase() to __tc_toUpperCase(obj.field) (member receiver)", () => {
    const result = transpileNativeSingle(`
      interface P { name: string; }
      export function main(p: P): string {
        return p.name.toUpperCase();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_toUpperCase\(p\.name\)/);
    expect(out).not.toMatch(/\.toUpperCase\(\)/);
  });

  it("lowers this.field.trim() to __tc_trim(this->field) (this-pointer receiver)", () => {
    const result = transpileNativeSingle(`
      class C {
        private s: string = '';
        public clean(): string { return this.s.trim(); }
      }
      export function main(): void {}
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_trim\(this->s\)/);
    expect(out).not.toMatch(/this->s\.trim\(\)/);
  });

  it("lowers arr[i].substring(0, 2) to __tc_substring2(arr[i], 0, 2) (binary form, indexed receiver)", () => {
    const result = transpileNativeSingle(`
      export function main(words: string[], i: int32_t): string {
        return words[i].substring(0, 2);
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_substring2\(words\[i\], 0, 2\)/);
    expect(out).not.toMatch(/\.substring\(0, 2\)/);
  });

  it("lowers arr[i].charAt(1) to __tc_charAt(arr[i], 1) (unary form, indexed receiver)", () => {
    const result = transpileNativeSingle(`
      export function main(words: string[], i: int32_t): string {
        return words[i].charAt(1);
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_charAt\(words\[i\], 1\)/);
    expect(out).not.toMatch(/\.charAt\(1\)/);
  });

  it("lowers a bare-identifier receiver identically (no regression of the pre-fix path)", () => {
    const result = transpileNativeSingle(`
      export function main(s: string): string {
        return s.toLowerCase();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_toLowerCase\(s\)/);
  });
});

// ── E: __tc_* helper is registered when a string method is used ────────────

describe("E: __tc_* string-method helper registration", () => {
  it("declares __tc_toLowerCase when .toLowerCase() is used (transitive fix via D)", () => {
    const result = transpileNativeSingle(`
      export function main(s: string): string {
        return s.toLowerCase();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // The polyfill definition must be emitted alongside the call (previously
    // the call lowered but the helper was never declared → g++ scope error).
    expect(out).toMatch(/__tc_toLowerCase/);
    expect(out).toMatch(/inline\s+std::string\s+__tc_toLowerCase/);
  });
});

// ── C: .length on a function-local std::vector ─────────────────────────────

describe("C: .length on a function-local std::vector", () => {
  it("lowers .length on a .push-mutated local array to .size() (mutableArrayVars path)", () => {
    const result = transpileNativeSingle(`
      export function main(): int32_t {
        const xs: int32_t[] = [];
        xs.push(1);
        xs.push(2);
        return xs.length;
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // Must be .size() (cast to long long), NOT the invalid vector.length().
    expect(out).toMatch(/static_cast<long long>\(xs\.size\(\)\)/);
    expect(out).not.toMatch(/xs\.length\(\)/);
  });

  it("lowers .length on a local array-literal to .size() (activeArrayLiteralVars path)", () => {
    const result = transpileNativeSingle(`
      export function main(): int32_t {
        const xs: int32_t[] = [1, 2, 3];
        return xs.length;
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/static_cast<long long>\(xs\.size\(\)\)/);
    expect(out).not.toMatch(/xs\.length\(\)/);
  });

  it("still lowers .length on a std::string local to .length() (no over-correction)", () => {
    // std::string DOES have .length() — the BUG-LEN fix must not touch it.
    const result = transpileNativeSingle(`
      export function main(s: string): int32_t {
        return s.length;
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/s\.length\(\)/);
    expect(out).not.toMatch(/s\.size\(\)/);
  });
});
