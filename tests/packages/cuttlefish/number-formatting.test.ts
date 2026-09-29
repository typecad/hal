// ---------------------------------------------------------------------------
// number-formatting.test.ts — snprintf specifier picking for JS numbers.
//
// Regressions covered:
//   • (3.14).toFixed(2) — the Zephyr string-method polyfill ships
//     __tc_toFixed, and every classifier that sees it picks %s (it returns
//     a C string), never the %d default that printed pointer-length garbage.
//   • Function-local doubles in HAL-call template literals — the IR-time
//     snprintf prebuilder has no scope types, and its %d default was a
//     -Wformat mismatch on every double local. Unrecorded numeric
//     identifiers now take %g (JS Number semantics); recorded integrals and
//     enums keep %d.
//   • Time.sleep(<non-literal>) — the timing op carried a numeric-only
//     resolver, so a variable duration dropped the op entirely and the
//     method's trailing `return Promise.resolve();` surfaced alone.
//   • new Array<E>(n) lowers to std::vector — the <vector> include must
//     follow it on Zephyr (full libstdc++ builds).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy } from '../../setup';

describe('toFixed lowering', () => {
  it('emits the __tc_toFixed polyfill and classifies it as a string (%s)', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const t = 21.5678;
      UART0.writeLine(\`t=\${t.toFixed(2)}C\`);
    `);

    // The shim is defined (framework string_methods polyfill).
    expect(r.cpp).toMatch(/const char\* __tc_toFixed\(double val, int digits\)/);
    // The snprintf arg is %s — the helper returns a C string.
    expect(r.cpp).toMatch(/"t=%sC", __tc_toFixed\(t, 2\)/);
    // Never the %d-on-a-pointer garbage form.
    expect(r.cpp).not.toMatch(/%d[^\n]*__tc_toFixed/);
  });
});

describe('function-local numbers in template literals', () => {
  it('picks %g for an unrecorded double local (was %d garbage)', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function report(): void {
        const ratio = 2.5;
        UART0.writeLine(\`ratio is \${ratio}\`);
        UART0.writeLine(\`half is \${ratio / 2}\`);
      }
      report();
    `);

    // %g for the double local, with a static_cast<double> wrapper so the
    // varargs call stays type-correct even when the emitted type is narrower
    // than the recorded double (an un-annotated integer-literal const).
    expect(r.cpp).toMatch(/"ratio is %g", static_cast<double>\(ratio\)/);
    expect(r.cpp).toMatch(/"half is %g", static_cast<double>\(ratio\) \/ static_cast<double>\(2\)/);
  });

  it('keeps %d for locals the scope records as integral', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      let count: int32_t = 3;
      function report(): void {
        const idx: int32_t = 7;
        UART0.writeLine(\`c=\${count} i=\${idx}\`);
      }
      report();
    `);

    expect(r.cpp).toMatch(/"c=%d i=%d"/);
  });
});

describe('Time.sleep with a runtime duration', () => {
  it('lowers the op (k_msleep carries the expression) instead of dropping it', () => {
    const r = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      function waitScaled(): void {
        const period = 250;
        Time.sleep(period);
      }
      waitScaled();
    `);

    // The op survives with the variable interpolated — the former
    // numeric-only resolver emitted nothing but `Promise.resolve();`.
    expect(r.cpp).toMatch(/k_msleep\(period\);/);
    expect(r.cpp).not.toContain('Promise.resolve');
  });

  it('splits an awaited variable-duration sleep on the member name', () => {
    const r = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      async function pulse() {
        let period = 250;
        while (true) {
          period = period + 10;
          await Time.sleep(period);
        }
      }
      pulse();
    `);

    expect(r.cpp).toMatch(/_waitUntil = __tc_now_ms\(\) \+ _v_period;/);
    expect(r.cpp).not.toContain('Promise.resolve');
  });
});

describe('typed array constructors include <vector> on Zephyr', () => {
  it('emits #include <vector> for new Array<number>(n)', () => {
    const r = transpileZephyrStrategy(`
      class Window {
        private readonly _temps: number[];
        constructor() { this._temps = new Array<number>(4); }
        setAt(v: number): void { this._temps[0] = v; }
      }
      const w = new Window();
      w.setAt(1.5);
    `);

    expect(r.cpp).toMatch(/#include <vector>/);
    expect(r.cpp).toMatch(/std::vector<double>\(4\)/);
  });
});
