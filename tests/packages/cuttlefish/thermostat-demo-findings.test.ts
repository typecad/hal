// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-thermostat demo
// (a deliberately SIMPLE single-file program: a numeric enum cycled by a
// button, a Ring class over a `number[]` field, hysteresis control, and
// toFixed/bar console reports). Everyday-TS paths, each formerly broken:
//
//   1. `.shift()` on a `this.field` vector receiver lowers to __tc_shift
//      (was verbatim `this->data.shift()` — std::vector has no shift).
//   2. JS vector mutators (pop/shift/unshift/reverse) lower on
//      identifier receivers through the helpers, keeping JS return
//      contracts (pop/shift return the removed element).
//   3. Enum arithmetic (`mode = (mode + 1) % 3 as Mode`) casts the enum
//      operand in IR-flattened binaries (`static_cast<int>(mode) + 1`).
//   4. `let sum = 0` + `sum += v` (double for-of element) widens the
//      accumulator to double — int truncated every step (JS numbers are
//      f64), and an early `return` inside an if-branch must not lose the
//      widening (nested statement-list lowerings used to wipe it).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("thermostat demo findings (Zephyr)", () => {
  it("shift on a this.field vector lowers to __tc_shift", () => {
    const out = transpile(`
      class Ring {
        private data: number[] = [];
        push(v: number): void {
          if (this.data.length >= 4) { this.data.shift(); }
          this.data.push(v);
        }
      }
      const r = new Ring();
      r.push(1);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_shift\(this->data\)/);
    expect(out.cpp).not.toMatch(/this->data\.shift/);
    expect(out.cpp).toMatch(/this->data\.push_back/);
  });

  it("vector mutators on identifier receivers keep JS return contracts", () => {
    const out = transpile(`
      export function run(a: number[]): number {
        a.push(1);
        const first = a.shift();
        const last = a.pop();
        const n = a.unshift(9);
        a.reverse();
        return first + last + n;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_shift\(a\)/);
    expect(out.cpp).toMatch(/__tc_pop\(a\)/);
    expect(out.cpp).toMatch(/__tc_unshift\(a, 9\)/);
    expect(out.cpp).toMatch(/__tc_reverse\(a\)/);
  });

  it("enum arithmetic inside an as-cast casts the enum operand", () => {
    const out = transpile(`
      enum Mode { Off, Heat, Cool }
      let mode: Mode = Mode.Off;
      mode = ((mode + 1) % 3) as Mode;
      let sink = mode;
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/static_cast<int>\(mode\) \+ 1/);
    expect(out.cpp).not.toMatch(/\(mode \+ 1\)/);
  });

  it("let sum = 0 widened when a for-of double is added (early return present)", () => {
    const out = transpile(`
      class Ring {
        private data: number[] = [];
        avg(): number {
          if (this.data.length === 0) { return 0; }
          let sum = 0;
          for (const v of this.data) { sum += v; }
          return sum / this.data.length;
        }
      }
      const r = new Ring();
      let sink = r.avg();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/double sum = 0/);
    expect(out.cpp).not.toMatch(/int(32_t)? sum = 0/);
  });

  it("pure-int accumulators stay int (no spurious widening)", () => {
    const out = transpile(`
      export function count(): number {
        let total = 0;
        const vals: number[] = [1, 2, 3];
        for (const v of vals) { total += v; }
        return total;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/int(32_t)? total = 0/);
    expect(out.cpp).not.toMatch(/double total = 0/);
  });
});
