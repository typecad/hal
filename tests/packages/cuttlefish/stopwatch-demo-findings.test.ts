// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-stopwatch demo
// (pot-driven stopwatch sessions: nested record types `Lap`/`Session`, a
// switch state machine, record fields mutated cross-function, an inline
// type-literal return annotation, a trimmed history via .slice()). Also
// covers the printf-specifier CONSOLIDATION — the emit renderer and the HAL
// message ladder used to carry drifting copies of the int/long/uint/float
// decision chain; both now delegate to snprintfTypeFormat (cpp-type-ir.ts).
//
//   1. .slice(n) on a std::vector receiver lowers to __tc_slice1 (the
//      helper ships in the Zephyr vector polyfills; JS negative-index and
//      clamp semantics).
//   2. A module-level `T | null` (object-literal alias) null-compares as a
//      value: `!== null` folds false/true at compile time (never
//      `!= CUTTLEFISH_UNDEFINED` against a struct), `= null` value-inits.
//      Root cause class: a stale `auto` in any threaded type map must not
//      shadow a concrete type through a locals fold.
//   3. The array prescan recurses into switch statements at the SAME loop
//      depth — a push inside `case X:` of a `while` is per-iteration
//      (unbounded), so the module array routes to std::vector everywhere.
//   4. Record-field mutators on alias-record fields (`current.laps.push`)
//      lower through the field's resolved element type — the field lookup
//      consults object-literal type aliases, not just classes.
//   5. An inline type-literal return annotation (`: { totalMs: number }`)
//      synthesizes a named ret struct — the function no longer lowers to
//      void ("return-statement with a value, in function returning void").
//   6. Alias-struct fields drive for-of element types and accumulator
//      widening (`totalMs += lap.ms` keeps double — int truncated every
//      step).
//   7. Record fields interpolated into HAL messages take the unified
//      specifier (%.15g for doubles — the consolidation's canonical
//      spelling).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("stopwatch demo findings (Zephyr)", () => {
  it("vector .slice(n) lowers to __tc_slice1", () => {
    const out = transpile(`
      const items: string[] = [];
      function trim(): void {
        if (items.length > 4) {
          const kept = items.slice(items.length - 4);
          items.length = 0;
          for (const k of kept) { items.push(k); }
        }
      }
      trim();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error' && d.code === 'array-slice-unsupported')).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_slice1\(/);
  });

  it("module-level struct|null null-compares as a value (stale auto never shadows)", () => {
    const out = transpile(`
      type Lap = { ms: number };
      type Session = { laps: Lap[] };
      let current: Session | null = null;
      current = { laps: [] };
      while (true) {
        if (current !== null) { current.laps.push({ ms: 1 }); }
        current = null;
        Time.sleep(10);
      }
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/Session current = \{\}/);
    expect(out.cpp).not.toMatch(/current != CUTTLEFISH_UNDEFINED/);
    expect(out.cpp).not.toMatch(/current = CUTTLEFISH_UNDEFINED/);
    expect(out.cpp).toMatch(/current\.laps\.push_back/);
  });

  it("switch-case pushes count as per-iteration (module array stays vector)", () => {
    const out = transpile(`
      type Session = { ms: number };
      const done: Session[] = [];
      let state = 0;
      while (true) {
        switch (state) {
          case 1:
            done.push({ ms: 5 });
            state = 0;
            break;
          default:
            break;
        }
        Time.sleep(10);
      }
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/std::vector<Session> done/);
    expect(out.cpp).not.toMatch(/__tc_StaticArray<Session/);
    expect(out.cpp).toMatch(/done\.push_back/);
  });

  it("record-field mutators resolve through alias structs (current.laps.push)", () => {
    const out = transpile(`
      type Lap = { index: number; ms: number };
      type Session = { laps: Lap[] };
      function addLap(s: Session, ms: number): void {
        s.laps.push({ index: s.laps.length + 1, ms });
      }
      let sink = 0;
      addLap({ laps: [] }, 100);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    expect(out.cpp).toMatch(/\.push_back\(/);
    expect(out.cpp).not.toMatch(/laps\.push\(/);
  });

  it("inline type-literal return annotation synthesizes a ret struct", () => {
    const out = transpile(`
      function summarize(): { totalMs: number; slowest: number } {
        return { totalMs: 5, slowest: 3 };
      }
      let sink = 0;
      sink = summarize().totalMs;
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/_summarize_ret_t summarize\(\)/);
    expect(out.cpp).toMatch(/struct _summarize_ret_t/);
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
  });

  it("alias fields drive for-of element types and accumulator widening", () => {
    const out = transpile(`
      type Lap = { ms: number };
      type Session = { laps: Lap[] };
      function summarize(s: Session): number {
        let totalMs = 0;
        for (const lap of s.laps) { totalMs += lap.ms; }
        return totalMs;
      }
      let sink = 0;
      sink = summarize({ laps: [{ ms: 1.5 }] });
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/double totalMs = 0/);
    expect(out.cpp).not.toMatch(/int(32_t)? totalMs = 0/);
  });

  it("record fields in HAL messages take the unified %.15g specifier", () => {
    const out = transpile(`
      type Lap = { index: number };
      function label(lap: Lap): void {
        UART0.writeLine(\`L\${lap.index}\`);
      }
      label({ index: 2 });
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/L%.15g/);
    expect(out.cpp).not.toMatch(/L%d/);
  });
});
