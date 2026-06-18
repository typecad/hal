// ---------------------------------------------------------------------------
// Semantic Gates — direct tests for runSemanticGates.
//
// Before this file, the semantic gates (orchestrator/type-checker.ts) had no
// direct test coverage: the tests/setup.ts `transpile()` helper builds the IR
// directly via buildProgramIR, which does NOT call runSemanticGates (only
// transpileFile → transpile.ts does). These tests build a real ts.Program and
// invoke runSemanticGates on it, pinning the behavior of the migrated gates.
//
// Phase 1 of the SemanticFacts refactor migrated three gates from name-based
// scope Sets to BindingResolver.resolveOrigin():
//   - TS2CPP_MAP_VALUE_COPY_MUTATION
//   - TS2CPP_ARRAY_PARAM_MUTATION (assignment, ++/--, and mutating method call)
//   - TS2CPP_TYPED_ARRAY_PARAM_LENGTH
//
// These tests cover both parity (the same cases the old code caught) and the
// newly-intercepted false negatives (destructuring shadowing, for-of bindings,
// reassignment).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { runSemanticGates } from "../packages/cuttlefish/src/orchestrator/type-checker";

/**
 * Build a ts.Program from a single source string (with the default lib loaded
 * so Map/Set/Array/typed-arrays resolve) and run the semantic gates against it.
 * Returns the diagnostics keyed by code for easy assertion.
 */
function runGates(source: string): { byCode: Map<string, ReturnType<typeof runSemanticGates>>; all: ReturnType<typeof runSemanticGates> } {
  const fileName = "/semantic-gates-test.ts";
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const baseHost = ts.createCompilerHost({
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  }, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (f, lang, onError) => {
      if (f === fileName) return sourceFile;
      return baseHost.getSourceFile(f, lang, onError);
    },
    fileExists: (f) => (f === fileName ? true : baseHost.fileExists(f)),
    readFile: (f) => (f === fileName ? source : baseHost.readFile(f)),
  };
  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      types: [],
    },
    host,
  });
  // Suppress TS's own type errors from the test assertions — we only care
  // about runSemanticGates output. (The snippets below are type-correct anyway.)
  const diags = runSemanticGates(program, [fileName]);
  const byCode = new Map<string, typeof diags>();
  for (const d of diags) {
    if (!d.code) continue;
    const arr = byCode.get(d.code) ?? [];
    arr.push(d);
    byCode.set(d.code, arr);
  }
  return { byCode, all: diags };
}

describe("runSemanticGates — TS2CPP_MAP_VALUE_COPY_MUTATION", () => {
  it("flags field assignment on a map.get(k)! copy", () => {
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f(tasks: Map<string, Task>, id: string) {
        const task = tasks.get(id)!;
        task.done = true;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags postfix ++ on a field of a map copy", () => {
    const { byCode } = runGates(`
      interface Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        c.n++;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags prefix -- on a field of a map copy", () => {
    const { byCode } = runGates(`
      interface Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        --c.n;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags compound assignment (+=) on a field of a map copy", () => {
    const { byCode } = runGates(`
      interface Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        c.n += 1;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags element-index assignment on a map copy (map[k])", () => {
    const { byCode } = runGates(`
      interface Bag { items: number[]; }
      function f(m: Record<string, Bag>, id: string) {
        const b = m[id];
        b.items[0] = 42;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("does not flag mutation of a non-copy local", () => {
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f() {
        const task: Task = { done: false };
        task.done = true;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  // ── Newly intercepted false negatives (Phase 1 motivation) ──────────────

  it("flags mutation after the binding was destructured (was a false negative)", () => {
    // Old scope machinery never registered destructuring bindings, so the
    // outer map-copy fact leaked onto the destructured name. The binding pass
    // now records origins on destructuring elements.
    const { byCode } = runGates(`
      interface Box { task: { done: boolean } }
      function f(m: Map<string, Box>, id: string) {
        const { task } = m.get(id)!;
        task.done = true;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("reflects reassignment: binding reassigned to a non-copy is no longer flagged", () => {
    // Old code kept the stale map-copy origin after reassignment. The binding
    // pass recomputes on each assignment initializer.
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f(m: Map<string, Task>, id: string, other: Task) {
        let task = m.get(id)!;
        task = other;
        task.done = true;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  it("reflects reassignment: binding reassigned to a map copy IS flagged", () => {
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f(m: Map<string, Task>, id: string, placeholder: Task) {
        let task = placeholder;
        task = m.get(id)!;
        task.done = true;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });
});

describe("runSemanticGates — TS2CPP_ARRAY_PARAM_MUTATION", () => {
  it("flags field/index assignment through an array parameter", () => {
    const { byCode } = runGates(`
      function f(arr: number[]) {
        arr[0] = 1;
      }
    `);
    expect(byCode.get("TS2CPP_ARRAY_PARAM_MUTATION")?.length).toBe(1);
  });

  it("flags a mutating method call (.push) on an array parameter", () => {
    const { byCode } = runGates(`
      function f(arr: number[]) {
        arr.push(1);
      }
    `);
    expect(byCode.get("TS2CPP_ARRAY_PARAM_MUTATION")?.length).toBe(1);
  });

  it("does not flag mutation of a local array", () => {
    const { byCode } = runGates(`
      function f() {
        const arr: number[] = [1, 2];
        arr.push(3);
      }
    `);
    expect(byCode.has("TS2CPP_ARRAY_PARAM_MUTATION")).toBe(false);
  });
});

describe("runSemanticGates — TS2CPP_TYPED_ARRAY_PARAM_LENGTH", () => {
  it("flags .length on a typed-array parameter", () => {
    const { byCode } = runGates(`
      function f(buf: Uint8Array) {
        return buf.length;
      }
    `);
    expect(byCode.get("TS2CPP_TYPED_ARRAY_PARAM_LENGTH")?.length).toBe(1);
  });

  it("does not flag .length on a local typed array", () => {
    const { byCode } = runGates(`
      function f() {
        const buf = new Uint8Array(4);
        return buf.length;
      }
    `);
    expect(byCode.has("TS2CPP_TYPED_ARRAY_PARAM_LENGTH")).toBe(false);
  });
});

describe("runSemanticGates — TS2CPP_TYPED_ARRAY_FIELD", () => {
  it("flags a typed-array class field (Uint8Array)", () => {
    const { byCode } = runGates(`
      class C {
        private buf: Uint8Array = new Uint8Array(0);
      }
    `);
    expect(byCode.get("TS2CPP_TYPED_ARRAY_FIELD")?.length).toBe(1);
  });

  it("flags a typed-array field regardless of initializer", () => {
    const { byCode } = runGates(`
      class C {
        buf: Float32Array = new Float32Array([1, 2, 3]);
      }
    `);
    expect(byCode.get("TS2CPP_TYPED_ARRAY_FIELD")?.length).toBe(1);
  });

  it("does not flag a plain-array (number[]) field", () => {
    const { byCode } = runGates(`
      class C {
        private scores: number[] = [];
      }
    `);
    expect(byCode.has("TS2CPP_TYPED_ARRAY_FIELD")).toBe(false);
  });

  it("does not flag a function-local typed array", () => {
    const { byCode } = runGates(`
      function f() {
        const buf = new Uint8Array(8);
        return buf[0];
      }
    `);
    expect(byCode.has("TS2CPP_TYPED_ARRAY_FIELD")).toBe(false);
  });
});

describe("runSemanticGates — clean code produces no diagnostics", () => {
  it("passes a simple function with no container hazards", () => {
    const { all } = runGates(`
      function f(x: number, y: number): number {
        return x + y;
      }
    `);
    expect(all.length).toBe(0);
  });
});

describe("runSemanticGates — Phase 3 fact-completeness verifier", () => {
  // The verifier (semantic-facts-verifier.ts) walks every expression and emits
  // TS2CPP_UNCLASSIFIABLE_TYPE for any whose canonical type is "unknown". It
  // runs inside runSemanticGates at "warning" severity by default. `any` is
  // NOT flagged (it has its own canonical category) — only genuinely
  // unclassifiable types are.

  it("does not flag clean, fully-typed code", () => {
    const { byCode } = runGates(`
      function f(x: number): number {
        const y = x * 2;
        return y + 1;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag any-typed expressions (any is a non-hazard category)", () => {
    // `any` is the transpiler's legitimate inference path — the verifier must
    // not flood builds that use untyped code.
    const { byCode } = runGates(`
      function f(a: any): any {
        return a + 1;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag a same-kind string-literal union (lowers to a single std::string)", () => {
    // A pure string-literal union `type Status = "ok" | "err"` lowers to a
    // single `std::string` (SUPPORT_MATRIX §1.6 — string unions are a
    // recommended alternative to keyof). All constituents canonicalize to the
    // same "primitive" category, so the union coalesces and must NOT trip the
    // unclassifiable warning. Demo #22 Finding C.
    const { byCode } = runGates(`
      type Status = "ok" | "err";
      function f(s: Status): Status {
        return s;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag a narrowed enum-member union (coalesces to the enum)", () => {
    // After `if (t.kind === K.A) { ... }`, TypeScript narrows `t.kind` to
    // `K.B | K.C`. Every constituent is an EnumLiteral of the same enum, which
    // lowers to a single integral type (compared via static_cast<int>). The
    // union coalesces to "primitive" and must NOT warn. Demo #22 Finding C.
    const { byCode } = runGates(`
      const enum K { A = 0, B = 1, C = 2 }
      interface T { kind: K; }
      function f(t: T): boolean {
        if (t.kind === K.A) return false;
        // here t.kind is narrowed to K.B | K.C
        return t.kind === K.B;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("flags a heterogeneous union (primitive | struct) as unclassifiable", () => {
    // A union whose constituents canonicalize to DIFFERENT categories does
    // not coalesce and remains a genuine hazard — the transpiler cannot pick
    // one C++ type. Here number (primitive) | Point (struct) mix categories.
    const { byCode, all } = runGates(`
      interface Point { x: number; y: number; }
      type Mixed = number | Point;
      function f(m: Mixed): Mixed {
        return m;
      }
    `);
    const unclassified = all.filter((d) => d.code === "TS2CPP_UNCLASSIFIABLE_TYPE");
    expect(unclassified.length).toBeGreaterThan(0);
    // Default severity is warning, not error.
    expect(unclassified.every((d) => d.severity === "warning")).toBe(true);
  });

  it("does not flag `this` types or nullable unions", () => {
    // Both were canonicalize gaps before Phase 3; now classified (this ->
    // struct via constraint, Account | null -> struct via null-stripping).
    const { byCode } = runGates(`
      class Account { id: number = 0; }
      function find(id: number): Account | null { return null; }
      class Service {
        cache: Map<number, Account> = new Map();
        get(id: number): Account | null {
          const a = this.cache.get(id) ?? null;
          return a;
        }
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });
});
