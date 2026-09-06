// ---------------------------------------------------------------------------
// Demo #18 regressions — three transpilation gaps surfaced by a small,
// idiomatic bank-ledger demo. All three are now FIXED in the transpiler;
// this file pins the behavior.
//
//   A — `Account | null` returned from a function/method and compared with
//       `=== null`. Previously this emitted the invalid `struct == 0` (g++
//       "no match for 'operator==' (operand types are 'Account' and 'int')").
//       Root cause: the value-type null-comparison guard in
//       expression-to-ir.ts only recognized *class* names (always pointer/
//       reference types) as value types, never *interface* names (which lower
//       to value-typed structs). Fix: track top-level interface names
//       (build-ir-state.ts / build-ir.ts) and recognize them in the guard;
//       also resolve an inline-call operand's return type so
//       `find(1) === null` and `this.find(1) === null` lower to `false`.
//
//   B — a module-scope free function called from a class METHOD body in split
//       mode. Previously the only forward declaration was `static` in the .cpp,
//       emitted AFTER `#include "main.h"`, so the inline method body (which
//       lives in the header) saw "'fn' was not declared in this scope".
//       Fix: setup.ts now walks class method/getter/setter/constructor bodies
//       to find free-function call sites; those functions are emitted with a
//       non-static prototype in the HEADER (in emitFunctionForwardDeclarations,
//       which precedes class emission) and a non-static definition in the .cpp.
//
//   C — struct-field interpolation inside a template literal in a class
//       method produced wrong snprintf format specifiers (`%lld` for an
//       int32_t/enum field, `%lld` + missing `.c_str()` for a std::string
//       field) → silent runtime corruption. Root cause: emitting an object
//       literal with an explicit named type (`const a: Account = {...}`)
//       clobbered the authoritative interfaceFieldTypes entry (registered in
//       setup.ts from the declaration) with types inferred from the
//       initializer values, which — after the native strategy's
//       normalizeCppType (`int` → `long long`) — collapsed every field to
//       `long long`. Fix: don't overwrite an existing declared field-type map.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ── A: nullable struct === null ─────────────────────────────────────────────

describe("A: struct (interface) returned from a function and compared to null", () => {
  it("lowers `s === null` to a compile-time false (no `== nullptr` / `== CUTTLEFISH_UNDEFINED` on a struct)", () => {
    const result = transpileNativeSplit(`
      interface Account { id: int32_t; name: string; cents: int32_t; }
      export function findAccount(id: int32_t): Account | null { return null; }
      export function ok(id: int32_t): boolean {
        const a: Account | null = findAccount(id);
        if (a === null) return false;
        return true;
      }
    `);
    const cpp = result.cpp ?? "";
    // Must NOT emit a struct-vs-int comparison.
    expect(cpp).not.toMatch(/a\s*==\s*(nullptr|CUTTLEFISH_UNDEFINED|0)/);
    expect(cpp).not.toMatch(/(nullptr|CUTTLEFISH_UNDEFINED)\s*==\s*a/);
  });

  it("lowers `this.method(id) === null` (inline method call) to a compile-time false", () => {
    const result = transpileNativeSplit(`
      interface Account { id: int32_t; name: string; cents: int32_t; }
      class Bank {
        find(id: int32_t): Account | null { return null; }
        ok(id: int32_t): boolean {
          if (this.find(id) === null) return false;
          return true;
        }
      }
      export function main(): void {}
    `);
    const header = result.header ?? "";
    // The inline-call comparison must not produce a struct-vs-int compare.
    expect(header).not.toMatch(/find\([^)]*\)\s*==\s*(nullptr|CUTTLEFISH_UNDEFINED)/);
  });

  it("lowers `findAccount(1) === null` (inline free-fn call) to a compile-time false", () => {
    const result = transpileNativeSplit(`
      interface Account { id: int32_t; name: string; cents: int32_t; }
      function findAccount(id: int32_t): Account | null { return null; }
      export function ok(id: int32_t): boolean {
        if (findAccount(1) === null) return false;
        return true;
      }
    `);
    const cpp = result.cpp ?? "";
    expect(cpp).not.toMatch(/findAccount\([^)]*\)\s*==\s*(nullptr|CUTTLEFISH_UNDEFINED)/);
  });
});

// ── B: free function called from a class method (split mode) ───────────────

describe("B: free function called from a class method body is visible in the header", () => {
  it("emits a non-static forward declaration in the header BEFORE the class definition", () => {
    const result = transpileNativeSplit(`
      function helper(x: number): number { return x + 1; }
      class Processor {
        public process(val: number): number {
          return helper(val);
        }
      }
      export function main(): void {
        const p = new Processor();
        const _log = p.process(42);
      }
    `);
    const header = result.header ?? "";
    // A reachable prototype exists...
    expect(header).toMatch(/helper\(/);
    // ...and it appears BEFORE the class DEFINITION (the inline method body
    // needs the symbol in scope at the point it is parsed). Match the
    // definition `class Processor {`, not the forward declaration
    // `class Processor;` which precedes both.
    const declIdx = header.indexOf("helper(");
    const classIdx = header.indexOf("class Processor {");
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(classIdx);
    // The header prototype must be non-static (a `static` decl in a header
    // included by multiple TUs would not satisfy the call).
    const declLine = header.split("\n").find(l => /helper\(/.test(l) && !l.includes("class"));
    expect(declLine).toBeDefined();
    expect(declLine!.trim().startsWith("static")).toBe(false);
  });

  it("does not emit a `static` definition for a class-method-called free function (avoids extern/static clash)", () => {
    const result = transpileNativeSplit(`
      function tag(s: string): string { return s; }
      class Box {
        public label(): string { return tag('x'); }
      }
      export function main(): void {}
    `);
    const cpp = result.cpp ?? "";
    // The definition must not be `static` (it has a non-static header prototype).
    expect(cpp).not.toMatch(/static\s+std::string\s+tag\s*\(/);
  });

  it("keeps a free function `static` when it is NOT called from any class method", () => {
    const result = transpileNativeSplit(`
      function internal(x: number): number { return x; }
      export function main(): void { const _log = internal(3); }
    `);
    const cpp = result.cpp ?? "";
    // Not referenced from a class body → stays static + no header prototype.
    const header = result.header ?? "";
    expect(header).not.toMatch(/internal\(/);
    expect(cpp).toMatch(/static.*internal\(/);
  });
});

// ── C: struct-field interpolation in a class-method template literal ────────

describe("C: struct fields interpolated in a template literal use correct snprintf formats", () => {
  it("emits %d for an int32_t field and %s + .c_str() for a std::string field", () => {
    const result = transpileNativeSplit(`
      interface Account { id: int32_t; name: string; cents: int32_t; }
      class Bank {
        private accounts: Account[] = [];
        public show(): void {
          for (const a of this.accounts) {
            const _log = \`#\${a.id} \${a.name}\`;
          }
        }
      }
      export function main(): void {}
    `);
    const header = result.header ?? "";
    // id (int32_t) → %d, name (std::string) → %s with .c_str().
    expect(header).toMatch(/%d %s/);
    expect(header).toMatch(/a\.id,\s*a\.name\.c_str\(\)/);
    // Must NOT collapse both to %lld (the bug: object-literal emission
    // clobbered interfaceFieldTypes so every field resolved to `long long`).
    expect(header).not.toMatch(/%lld %lld/);
  });

  it("preserves correct field types after a named-typed object literal is constructed (the clobber regression)", () => {
    // This is the exact shape that triggered Finding C: a method constructs an
    // `Account` literal (which used to overwrite interfaceFieldTypes['Account']
    // with value-inferred, strategy-normalized types), then another method
    // interpolates Account fields. Both must see the DECLARED field types.
    const result = transpileNativeSplit(`
      interface Account { id: int32_t; name: string; cents: int32_t; }
      class Bank {
        private accounts: Account[] = [];
        public open(name: string): int32_t {
          const a: Account = { id: 1, name: name, cents: 0 };
          this.accounts.push(a);
          return 1;
        }
        public show(): void {
          for (const a of this.accounts) {
            const _log = \`#\${a.id} \${a.name} \${a.cents}\`;
          }
        }
      }
      export function main(): void {}
    `);
    const header = result.header ?? "";
    // After `open()` constructs an Account literal, `show()` must still see
    // the declared field types (id/cents → %d, name → %s + .c_str()).
    expect(header).toMatch(/%d %s %d/);
    expect(header).toMatch(/a\.name\.c_str\(\)/);
    expect(header).not.toMatch(/%lld %lld %lld/);
  });
});
