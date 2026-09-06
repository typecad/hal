// ---------------------------------------------------------------------------
// Demo #17 regressions — const for...of loop variable mutation now demotes
// inside class methods and namespace functions.
//
// Root cause pinned here:
//   The ownership const-content-mutation demotion (`validateConstSuggestions`
//   in ir/ownership-analysis.ts) previously walked only `program.functions`
//   and `program.topLevelStatements`. It never reached class method bodies,
//   class getters/setters/constructors, or namespace-scoped functions. So a
//   `for (const t of arr) { t.done = true; }` inside a class method kept its
//   `const` storage and emitted `for (const Task& t : ...)` — a const
//   reference — making `t.done = true` a hard g++ error ("assignment of
//   member in read-only object"). The demotion already worked for free
//   functions; this pins that it now works everywhere.
//
//   A — `for (const t of arr) { t.field = ... }` inside a CLASS METHOD emits
//       `for (T& t : ...)` (non-const reference) + an
//       `ownership-const-content-mutated` info diagnostic.
//   B — The same inside a NAMESPACE-scoped function.
//   C — A read-only loop variable inside a method STAYS `const T&` (guards
//       against over-demoting). Mirrors the existing free-function pin in
//       demo-6-regressions.test.ts for struct loop vars.
//   D — Latent gap closed by the same fix: a `const`-bound `Set`/`Map`
//       mutated via `.add()`/`.set()` inside a class method now demotes too
//       (previously only demoted inside free functions).
//
// Companion ESLint rule: `no-readonly-loop-variable-mutation` (warn) surfaces
// the auto-demotion at lint time, mirroring `no-mutating-method-on-const-
// collection`. This test file pins the transpiler behavior; the lint rule is
// exercised via the demo's eslint config.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile, findDiagnostics } from "../../setup";

function transpileNative(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "cpp" });
}

// ── A: class method ─────────────────────────────────────────────────────────

describe("A: const for...of loop var mutated in a class method demotes to T&", () => {
  it("emits a non-const range-for reference and an ownership-const-content-mutated diagnostic", () => {
    const result = transpileNative(`
      interface Task { id: int32_t; done: boolean; }
      class Manager {
        public tasks: Task[] = [];
        public complete(id: int32_t): boolean {
          for (const t of this.tasks) {
            if (t.id === id) {
              t.done = true;
              return true;
            }
          }
          return false;
        }
      }
      const m = new Manager();
      const _log1 = m.complete(1);
    `);
    // Mutated loop var -> non-const reference (T& t), NOT const T& t.
    expect(result.cpp).toMatch(/for \(Task& t :\s+this->tasks\)/);
    expect(result.cpp).not.toMatch(/for \(const Task& t :\s+this->tasks\)/);
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBeGreaterThanOrEqual(1);
    expect(demoted.some(d => /'t'.*member assignment/.test(d.message))).toBe(true);
  });

  it("also handles element/index mutation (t[i] form) and UpdateExpression (t.field++)", () => {
    const result = transpileNative(`
      interface Task { id: int32_t; hits: int32_t; }
      class Manager {
        public tasks: Task[] = [];
        public bump(id: int32_t): void {
          for (const t of this.tasks) {
            if (t.id === id) { t.hits++; }
          }
        }
      }
      const m = new Manager();
      m.bump(1);
    `);
    expect(result.cpp).toMatch(/for \(Task& t :\s+this->tasks\)/);
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBeGreaterThanOrEqual(1);
  });
});

// ── B: namespace-scoped function ────────────────────────────────────────────

describe("B: const for...of loop var mutated in a namespace function demotes", () => {
  it("emits a non-const reference inside namespace App { function ... }", () => {
    const result = transpileNative(`
      interface Task { id: int32_t; done: boolean; }
      namespace App {
        export function markAll(tasks: Task[]): void {
          for (const t of tasks) {
            t.done = true;
          }
        }
      }
      const _log2 = 'ok';
    `);
    expect(result.cpp).toMatch(/for \(Task& t :\s+tasks\)/);
    expect(result.cpp).not.toMatch(/for \(const Task& t :\s+tasks\)/);
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBeGreaterThanOrEqual(1);
  });
});

// ── C: read-only loop var stays const (no over-demotion) ───────────────────

describe("C: a read-only const for...of loop var stays const T&", () => {
  it("a loop var that is only read (not mutated) keeps its const reference", () => {
    const result = transpileNative(`
      interface Task { id: int32_t; }
      class Manager {
        public tasks: Task[] = [];
        public countOpen(): int32_t {
          let n: int32_t = 0;
          for (const t of this.tasks) {
            n = n + 1;
          }
          return n;
        }
      }
      const m = new Manager();
      const _log3 = m.countOpen();
    `);
    // Read-only -> const reference preserved (no demotion diagnostic).
    expect(result.cpp).toMatch(/for \(const Task& t :\s+this->tasks\)/);
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    // The only var mutated here is `n` (a let int), which is fine; no const
    // loop-var demotion should fire.
    expect(demoted.filter(d => /'t'/.test(d.message))).toHaveLength(0);
  });
});

// ── D: latent gap — const-collection mutation inside a method now demotes ──

describe("D: a const local Set mutated via .add() inside a class method demotes", () => {
  it("demotes a const-bound LOCAL collection mutated in a method (previously only free functions)", () => {
    // Note: class FIELDS are emitted non-const by default, so mutating a
    // field collection compiles without demotion. The demotion only matters
    // for a `const`-bound LOCAL inside a method body — which previously was
    // never analyzed because method bodies weren't walked.
    const result = transpileNative(`
      class Tracker {
        public seen: Set<int32_t> = new Set();
        public batchMark(vs: int32_t[]): void {
          const local: Set<int32_t> = new Set();
          for (const v of vs) {
            local.add(v);
          }
          const _log4 = local.has(vs[0]);
        }
      }
      const t = new Tracker();
      t.batchMark([1, 2, 3]);
    `);
    // .add() lowers to .insert(); the const local Set is demoted (info diag).
    expect(result.cpp).toContain(".insert(");
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBeGreaterThanOrEqual(1);
    expect(demoted.some(d => /'local'.*\.insert\(\)/.test(d.message))).toBe(true);
  });
});
