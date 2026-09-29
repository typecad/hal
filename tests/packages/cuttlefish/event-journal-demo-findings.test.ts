// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-event-journal
// demo (object RECORDS as the data shape: a `type Reading = {...}` alias,
// shorthand-property factories, a module-level object mutated from
// functions, a Reading[] journal mutated cross-function, async reporter and
// heartbeat tasks, default/rest parameters). Each block pins one formerly
// broken lowering:
//
//   1. A `T | null` local where T is an object-literal TYPE ALIAS value-
//      initializes `{}` (was `Reading best = 0`), and `=== null` folds to a
//      compile-time false (was `best == 0` against a struct).
//   2. `v.toFixed(digits)` with a NON-literal precision passes the
//      expression through (was a silently baked 0 — wrong-code).
//   3. A rest-parameter call flattened at IR time (inside a template
//      literal) collects its args into the braced vector.
//   4. A module-level array mutated from a FUNCTION body stays std::vector
//      everywhere — the declaration used to promote to __tc_StaticArray
//      (capacity counted from static push sites) while the function-body
//      accesses and `T[]` parameters lowered through std::vector.
//   5. A module-level object-literal var emits ONCE in split mode (phase 8
//      owns the struct + extern; phase 5's const stream and extern block
//      defer to it) — was a redefinition plus an extern before the struct.
//   6. A reserved-named local in an async task (`const auto = ...`) keeps
//      its hoisted member rename in pre-rendered raw text (was `auto_`
//      beside `_v_auto`).
//   7. Alias struct fields seed the field-type map — `r.tag` in a template
//      takes %s/.c_str(), not the %d default.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("event-journal demo findings (Zephyr)", () => {
  it("object-literal alias | null local value-inits and null-compares safely", () => {
    const out = transpile(`
      type Reading = { tMs: number; mv: number; tag: string };
      function peak(j: Reading[]): Reading | null {
        let best: Reading | null = null;
        for (const r of j) { if (best === null || r.mv > best.mv) { best = r; } }
        return best;
      }
      const j: Reading[] = [];
      let sink = peak(j);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/Reading best = \{\}/);
    expect(out.cpp).toMatch(/if \(false \|\|/);
    expect(out.cpp).not.toMatch(/best == (0|CUTTLEFISH_UNDEFINED)/);
  });

  it("toFixed with a non-literal precision passes the expression through", () => {
    const out = transpile(`
      function fmt(v: number, digits = 1): string {
        return v.toFixed(digits);
      }
      let sink = '';
      sink = fmt(2.5);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_toFixed\(v, static_cast<int>\(digits\)\)/);
    expect(out.cpp).not.toMatch(/__tc_toFixed\(v, 0\)/);
  });

  it("rest-parameter call inside a template collects into the braced vector", () => {
    const out = transpile(`
      function sum(...vals: number[]): number {
        let total = 0;
        for (const v of vals) { total += v; }
        return total;
      }
      let sink = 0;
      sink = sum(1, 2, 3);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/sum\(std::vector<double>\{1, 2, 3\}\)/);
    expect(out.cpp).not.toMatch(/[^{]sum\(1, 2, 3\)/);
  });

  it("a module array mutated from a function stays std::vector everywhere", () => {
    const out = transpile(`
      type Reading = { mv: number };
      const journal: Reading[] = [];
      function logReading(mv: number): void {
        journal.push({ mv });
      }
      function first(j: Reading[]): number {
        return j.length > 0 ? j[0].mv : 0;
      }
      logReading(1);
      let sink = first(journal);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/std::vector<Reading> journal/);
    expect(out.cpp).not.toMatch(/__tc_StaticArray<Reading/);
    expect(out.cpp).toMatch(/journal\.push_back/);
  });

  it("a module-level object literal emits exactly once (no redefinition)", () => {
    const out = transpile(`
      const bounds = { low: 3300, high: 0 };
      function retune(v: number): void { bounds.low = v; }
      retune(1);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    // One definition, one struct — in any emit mode (single-file inlines the
    // struct into the definition; split mode separates them).
    const varDefs = out.cpp.match(/bounds = \{ 3300, 0 \}/g) ?? [];
    const structDefs = out.cpp.match(/struct _bounds_t /g) ?? [];
    expect(varDefs.length).toBe(1);
    expect(structDefs.length).toBeLessThanOrEqual(1);
  });

  it("a reserved-named async local keeps its member rename in raw text", () => {
    const out = transpile(`
      function total(...vals: number[]): number {
        let total = 0;
        for (const v of vals) { total += v; }
        return total;
      }
      async function reporter() {
        while (true) {
          await Time.sleep(100);
          const auto = total(1, 2);
          UART0.writeLine(\`n=\${auto}\`);
        }
      }
      reporter();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/_v_auto/);
    expect(out.cpp).not.toMatch(/[^_a-zA-Z0-9]auto_[^a-zA-Z0-9]/);
  });

  it("alias struct fields resolve string parts to %s with c_str", () => {
    const out = transpile(`
      type Reading = { tMs: number; mv: number; tag: string };
      function label(r: Reading): string {
        return \`tag=\${r.tag} mv=\${r.mv.toFixed(1)}\`;
      }
      const r: Reading = { tMs: 1, mv: 2.5, tag: 'auto' };
      let sink = label(r);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/tag=%s/);
    expect(out.cpp).toMatch(/r\.tag\.c_str\(\)/);
    expect(out.cpp).not.toMatch(/tag=%d/);
  });

  it("a struct field interpolated into a HAL message resolves %s (async task shape)", () => {
    // The UART writeLine lowering builds its snprintf at IR time with its
    // own part ladder — a hoisted async local's field (`_v_p.tag` after the
    // member rename) took the %d default there (pointer printed as int).
    const out = transpile(`
      type Reading = { tMs: number; mv: number; tag: string };
      const journal: Reading[] = [];
      function peak(j: Reading[]): Reading | null {
        let best: Reading | null = null;
        for (const r of j) { if (best === null || r.mv > best.mv) { best = r; } }
        return best;
      }
      async function reporter() {
        while (true) {
          await Time.sleep(100);
          const p = peak(journal);
          if (p !== null) { UART0.writeLine(\`tag=\${p.tag}\`); }
        }
      }
      reporter();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/tag=%s/);
    expect(out.cpp).toMatch(/_v_p\.tag\)\.c_str\(\)|_v_p\.tag\.c_str\(\)/);
    expect(out.cpp).not.toMatch(/tag=%d/);
  });
});
