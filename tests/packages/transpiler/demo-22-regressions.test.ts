// ---------------------------------------------------------------------------
// Demo #22 regressions — three transpilation gaps surfaced by a small,
// idiomatic infix→RPN (shunting-yard) demo. All three are now FIXED in the
// transpiler; this file pins the behavior.
//
//   A — Array mutator methods (`.pop`, `.push`, `.shift`, ...) called on an
//       INSTANCE-FIELD receiver (`this.ops.pop()`) lowered to a member call
//       `this->__tc_pop(ops)` — the native strategy's regex used `(\w+)` for
//       the receiver, which stopped at the `>` in `this->ops`, capturing only
//       `ops` and emitting `__tc_pop` as a member of `this`. g++ reported
//       "'class C' has no member named '__tc_pop'". The same `(\w+)` pattern
//       applied to every array/string-mutator regex, so `.push`/`.shift`/
//       `.unshift`/`.sort`/`.map`/etc. on a member receiver were all broken.
//       Fix: a shared `RECV` pattern (`[\w$]+(?:->\w+|\.\w+)*`) that matches
//       the full member-access chain, in `cuttlefish/src/frameworks/native/strategy.ts`
//       `normalizeRawExpression`.
//
//   B — A free function called from a class-method body — but only when the
//       call site sits inside a parenthesized sub-expression (e.g. the right
//       side of `||`, wrapped in `(...)`) — was tree-shaken out entirely,
//       producing g++ "'fn' was not declared in this scope". Root cause: the
//       `paren` IR node (added to preserve explicit TS grouping) had NO case
//       in `collectExpressionIdentifiers`, so any identifier nested inside
//       parentheses was invisible to the call-graph/reachability pass. The
//       function was correctly forward-declared (the forward-decl walker has
//       its own traversal) but then removed as "unreachable". Fix: added
//       `paren` (plus `lambda`, `tuple-access`, `hal-expr`) cases to
//       `ir/identifier-collector.ts`.
//
//   C — `TS2CPP_UNCLASSIFIABLE_TYPE` fired on narrowed enum-member unions
//       (`t.kind` after `if (t.kind === K.A)` narrows to `K.B | K.C`) and on
//       same-kind string-literal unions (`"+" | "-" | "*"`). Both lower to a
//       single primitive C++ type, so the warning was a false positive. Root
//       cause: `canonicalize()` only handled nullish unions; a non-nullish
//       union fell through to `unknown`. Fix: coalesce a non-nullish union
//       when every constituent canonicalizes to the SAME category, in
//       `orchestrator/semantic-facts.ts`. Heterogeneous unions
//       (`number | Point`) still classify as `unknown`.
//
//   F — `.length` on a **Map/Set instance field** (`this.m.length`) lowered to
//       `strlen(this->m)` — the `resolveLengthProperty` member-receiver path
//       only recognized `std::string`/`std::vector`/`StaticArray` field types
//       and fell through to the C-string `strlen()` default for everything
//       else, emitting `strlen` on a `std::map`/`std::set` struct (invalid or
//       silently-miscompiling C++). A bare-identifier `Map.length` was already
//       correct; only the `this.field` path was broken. Surfaced by the demo
//       #22 adjacency probe (not by the demo itself). Fix: route every STL
//       container field type to `.size()` and keep `strlen` only for explicit
//       C-string fields, in `ir/expression-to-ir.ts` `resolveLengthProperty`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

// ── A: array mutators on an instance-field receiver ─────────────────────────

describe("A: array mutator methods on a this.field receiver", () => {
  it("lowers this.ops.pop() to __tc_pop(this->ops), not this->__tc_pop(ops)", () => {
    const result = transpileNativeSingle(`
      class C {
        private ops: string[] = [];
        public m(): string {
          const top: string = this.ops.pop()!;
          return top;
        }
      }
      export function main(): void {}
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // The free helper must receive the FULL member-access receiver.
    expect(out).toMatch(/__tc_pop\(this->ops\)/);
    // Must NOT emit the broken member-call form.
    expect(out).not.toMatch(/this->__tc_pop/);
  });

  it("lowers this.ops.push(x) to this->ops.push_back(x)", () => {
    const result = transpileNativeSingle(`
      class C {
        private ops: string[] = [];
        public m(): void {
          this.ops.push('x');
        }
      }
      export function main(): void {}
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/this->ops\.push_back\(/);
    // No mangled helper-member form.
    expect(out).not.toMatch(/this->__tc_push|this->push_back\(/);
  });

  it("lowers obj.field.pop() for a non-this member-access receiver", () => {
    // A struct/value field (not this->) — the receiver chain `obj.items` must
    // be captured whole.
    const result = transpileNativeSingle(`
      class Inner { public items: int32_t[] = []; }
      class C {
        public m(i: Inner): int32_t {
          const v: int32_t = i.items.pop()!;
          return v;
        }
      }
      export function main(): void {}
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_pop\(i->items\)/);
    expect(out).not.toMatch(/i->__tc_pop/);
  });

  it("still lowers bare-identifier receivers (no regression)", () => {
    const result = transpileNativeSingle(`
      export function main(): void {
        const s: int32_t[] = [1, 2, 3];
        const v: int32_t = s.pop()!;
        console.log(v);
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_pop\(s\)/);
  });
});

// ── B: free function called from a class method, nested in parens ───────────

describe("B: free function called from a class method body (parenthesized)", () => {
  it("does NOT tree-shake a free function whose only call is inside (parens) in a class method", () => {
    // The exact demo #22 shape: isRightAssoc(op) called as !isRightAssoc(op)
    // inside the right side of an ||, wrapped in (...). Before the fix the
    // function was removed by the reachability pass and g++ failed.
    const result = transpileNativeSingle(`
      function helper(x: int32_t): boolean { return x > 0; }
      class C {
        public m(a: int32_t, b: int32_t): int32_t {
          if (a > b || (a === b && !helper(a))) {
            return 1;
          }
          return 0;
        }
      }
      export function main(): void {
        const c: C = new C();
        console.log(c.m(1, 2));
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // The function definition MUST survive tree-shaking.
    expect(out).toMatch(/bool\s+helper\s*\(/);
    // And it must be forward-declared before the class (the call is in an
    // inline method body in the header).
    const declIdx = out.indexOf("bool helper(");
    const classIdx = out.indexOf("class C {");
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(classIdx);
  });

  it("does NOT tree-shake a free function called inside nested parens in a return", () => {
    // Another parenthesized call site: return (fn(x));
    const result = transpileNativeSingle(`
      function dbl(x: int32_t): int32_t { return x * 2; }
      class C {
        public m(x: int32_t): int32_t {
          return (dbl(x));
        }
      }
      export function main(): void {
        const c: C = new C();
        console.log(c.m(5));
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/int32_t\s+dbl\s*\(/);
  });
});

// ── C: narrowed enum / same-kind literal unions no longer warn ──────────────

describe("C: same-kind unions coalesce (no false TS2CPP_UNCLASSIFIABLE_TYPE)", () => {
  it("does not warn on a narrowed enum-member union (K.B | K.C)", () => {
    // After the first `if`, t.kind is narrowed to a union of enum members of
    // the SAME enum. Each lowers to the enum's integral type, so the union
    // coalesces to "primitive" and must NOT trip the verifier.
    const diags = transpileNativeSingle(`
      const enum K { A = 0, B = 1, C = 2 }
      interface T { kind: K; }
      class C {
        public check(t: T): boolean {
          if (t.kind === K.A) return false;
          return t.kind === K.B;
        }
      }
      export function main(): void {}
    `).diagnostics ?? [];
    const unclassified = diags.filter((d: any) => d.code === "TS2CPP_UNCLASSIFIABLE_TYPE");
    expect(unclassified.length).toBe(0);
  });

  it("does not warn on a same-kind string-literal union (operator set)", () => {
    // A string-literal union like the set of operators narrows to a union of
    // string literals — all canonicalize to "primitive" (std::string).
    const diags = transpileNativeSingle(`
      class C {
        public isOp(op: string): boolean {
          if (op === '+' || op === '-' || op === '*' || op === '/') {
            return true;
          }
          return false;
        }
      }
      export function main(): void {}
    `).diagnostics ?? [];
    const unclassified = diags.filter((d: any) => d.code === "TS2CPP_UNCLASSIFIABLE_TYPE");
    expect(unclassified.length).toBe(0);
  });
});

// ── F: .length on a Map/Set instance field (pre-existing bug, surfaced by the
//      demo #22 adjacency probe) ──────────────────────────────────────────────

describe("F: .length on a Map/Set instance field lowers to .size(), not strlen", () => {
  it("this.m.length on a std::map field → this->m.size()", () => {
    // Previously the this->field.length path only recognized std::vector/
    // StaticArray/std::string field types and fell through to the C-string
    // strlen() default for everything else — emitting strlen(this->m) on a
    // std::map struct (invalid C++: g++ rejects strlen on a non-pointer, or
    // worse, silently miscompiles). A bare-identifier Map.length was already
    // correct (type-aware resolveLengthProperty); only the member-receiver
    // path was broken.
    const result = transpileNativeSingle(`
      class C {
        private m: Map<int32_t, int32_t> = new Map();
        public n(): int32_t { return this.m.length; }
      }
      export function main(): void {}
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/this->m\.size\(\)/);
    expect(out).not.toMatch(/strlen\(this->m\)/);
  });

  it("this.s.length on a std::set field → this->s.size()", () => {
    const result = transpileNativeSingle(`
      class C {
        private s: Set<int32_t> = new Set();
        public n(): int32_t { return this.s.length; }
      }
      export function main(): void {}
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/this->s\.size\(\)/);
    expect(out).not.toMatch(/strlen\(this->s\)/);
  });
});
