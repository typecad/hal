// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-task-scanner
// demo (a cooperative scheduler simulation: a Task table scanned with
// continue, per-task do-while step loops with break, a Set<string> run
// ledger, and a step(t: Task) helper that mutates its record parameter):
//
//   1. Set declarations ship <set> — the declared-type analysis only
//     recognized std::map<, so the include arm never fired ("'set' in
//     namespace 'std' does not name a template type").
//   2. A body that writes fields through a record-typed parameter demotes
//     the const& borrow to a mutable reference — the parameter twin of the
//     ownership analysis's const-local demotion (was "assignment of member
//     in read-only object" at g++).
//   3. `continue` inside a CLASSIC for loop keeps the increment (the
//     silent-wrong-code risk: a continue lowered as goto-top would skip
//     `i += 1` and hang the loop).
//   4. do-while executes its body at least once and `break` exits before
//     the condition is tested.
//   5. Set.has/.add/.size/.clear lower (count/insert/size/clear).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("task-scanner demo findings (Zephyr)", () => {
  it("a Set declaration ships the <set> include", () => {
    const out = transpile(`
      const seen = new Set<string>();
      export function mark(name: string): void {
        if (!seen.has(name)) { seen.add(name); }
      }
      mark('a');
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    expect(out.cpp).toMatch(/#include <set>/);
    expect(out.cpp).toMatch(/std::set<std::string> seen/);
  });

  it("field writes through a record param demote const& to a mutable ref", () => {
    const out = transpile(`
      type Counter = { hits: number };
      function bump(c: Counter): void {
        c.hits += 1;
      }
      const ctr: Counter = { hits: 0 };
      bump(ctr);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    // The parameter is a non-const reference in BOTH declaration and body.
    expect(out.cpp).toMatch(/void bump\(Counter& c\)/);
    expect(out.cpp).not.toMatch(/const Counter& c/);
    expect(out.cpp).toMatch(/c\.hits \+= 1/);
  });

  it("a read-only record param keeps its const& borrow", () => {
    const out = transpile(`
      type P = { v: number };
      function read(p: P): number {
        return p.v;
      }
      let sink = 0;
      sink = read({ v: 2 });
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/const P& p/);
  });

  it("continue in a classic for loop keeps the increment", () => {
    const out = transpile(`
      export function countEvens(limit: number): number {
        let n = 0;
        for (let i = 0; i < limit; i += 1) {
          if (i % 2 === 1) { continue; }
          n += 1;
        }
        return n;
      }
      let sink = 0;
      sink = countEvens(10);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    // The for statement keeps all three clauses AND the continue — a
    // continue lowered as goto-top would skip the increment and hang.
    expect(out.cpp).toMatch(/for \(int(32_t)? i = 0; i < limit; i \+= 1\)/);
    expect(out.cpp).toMatch(/continue;/);
  });

  it("do-while runs at least once and break exits before the condition", () => {
    const out = transpile(`
      export function spin(start: number): number {
        let x = start;
        let ticks = 0;
        do {
          ticks += 1;
          if (x > 100) { break; }
          x = x * 2;
        } while (x < 64);
        return ticks;
      }
      let sink = 0;
      sink = spin(200);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    // do { body } while (cond); — the body precedes the condition.
    const doIdx = out.cpp.indexOf('do');
    const bodyIdx = out.cpp.indexOf('ticks += 1;');
    const whileIdx = out.cpp.indexOf('} while (');
    expect(doIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThan(doIdx);
    expect(whileIdx).toBeGreaterThan(bodyIdx);
    expect(out.cpp).toMatch(/break;/);
  });

  it("Set.has/.add/.size/.clear lower to count/insert/size/clear", () => {
    const out = transpile(`
      const s = new Set<string>();
      export function run(names: string[]): void {
        for (const n of names) { s.add(n); }
        if (s.size >= 2) { s.clear(); }
      }
      let sink = 0;
      sink = s.size;
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/s\.insert\(/);
    expect(out.cpp).toMatch(/s\.size\(\) >= 2|static_cast<long long>\(s\.size\(\)\) >= 2/);
    expect(out.cpp).toMatch(/s\.clear\(\)/);
  });
});
