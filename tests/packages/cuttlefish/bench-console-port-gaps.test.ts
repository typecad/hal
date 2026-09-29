// ---------------------------------------------------------------------------
// Port-gap regression tests — transpiler fixes surfaced by the
// zephyr-bench-console demo (a UART command shell with an ADC sampler and a
// breathing PWM LED). Each block pins one formerly broken lowering:
//
//   1. String methods on NON-identifier receivers (pointer member, element
//      access, chained call results) lower structurally on every target —
//      the strategy-side regex mangled them (`c->__tc_padEnd(name, 7)`).
//   2. `.length` on a `string` binding lowers to the native .length()
//      string targets (was `.length()` on a non-class type).
//   3. for-of over a StaticArray types the loop var from the element type —
//      even when the array is declared AFTER the class iterating it.
//   4. A class instance declared after the class using it arrows member
//      calls (`stats->count()`), promotes across bodies, and externs reach
//      the header.
//   5. A top-level `const` collection mutated from another function or
//      method is demoted to non-const (was `const std::map` + operator[]).
//   6. The padStart/padEnd/repeat/lastIndexOf polyfills ship on Zephyr.
//   7. Unlowerable array methods (filter/map/reduce/sort/join) and
//      string.split fail the transpile with a targeted diagnostic.
//   8. The ADC init emits a device handle only for USED controllers.
//   9. Division inside IR-rendered text promotes to double (JS semantics).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";
import { adcInitLines } from "../../../packages/framework-zephyr/src/lowering/adc";
import type { ZephyrChipDescriptor } from "../../../packages/framework-zephyr/src/chips/types";

const zephyr = () => new ZephyrStrategy();

describe("string methods on non-identifier receivers (Zephyr)", () => {
  it("lowers padEnd on a class-pointer member without mangling", () => {
    const out = transpile(`
      class Cmd { nm: string = 'x'; }
      const CMDS: Cmd[] = [];
      let sink = '';
      class Runner {
        go(): boolean {
          for (const c of CMDS) { sink = '  ' + c.nm.padEnd(7); }
          return true;
        }
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_padEnd_default\(c->nm, 7\)/);
    expect(out.cpp).not.toMatch(/__tc_padEnd_default\(nm,/);
    expect(out.cpp).not.toMatch(/c\.__tc_padEnd/);
  });

  it("lowers toLowerCase on an array element receiver", () => {
    const out = transpile(`
      const parts: string[] = ['a'];
      const s = parts[0].toLowerCase();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_toLowerCase\(parts\[0\]\)/);
    expect(out.cpp).not.toMatch(/parts\[0\]\.toLowerCase/);
  });

  it("lowers a string method chained onto toString(16)", () => {
    const out = transpile(`
      const v = 255;
      const s = v.toString(16).toUpperCase();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_toUpperCase\(__tc_num_radix\(/);
    expect(out.cpp).not.toMatch(/__tc_num_radix\([^)]*\)\.toUpperCase/);
  });

  it("startsWith lowers to the std::string prefix idiom (rfind at 0)", () => {
    // One string model: `s: string` params are std::string, and the native
    // prefix test is compare-at-0 (rendered via rfind). The old strncmp
    // form assumed const char* locals.
    const out = transpile(`
      function go(s: string): boolean { return s.startsWith('0x'); }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/s\.rfind\("0x", 0\) == 0/);
  });
});

describe(".length on string bindings (std::string model)", () => {
  it("parameter .length lowers to the native .length()", () => {
    const out = transpile(`
      function nlen(s: string): number { return s.length; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/s\.length\(\)/);
  });

  it("a toFixed-initialized local's .length is native (was sizeof)", () => {
    const out = transpile(`
      function pad(v: number): number {
        const s = v.toFixed(0);
        return s.length;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/s\.length\(\)/);
    expect(out.cpp).not.toMatch(/sizeof\(s\)/);
  });
});

describe("declare-after-use across the module (legal TS)", () => {
  it("for-of over a StaticArray declared after the class types the loop var", () => {
    const out = transpile(`
      class Cmd { nm: string = 'x'; }
      class Runner {
        go(): boolean {
          for (const c of CMDS) { sink = c.nm; }
          return true;
        }
      }
      let sink = '';
      const CMDS: Cmd[] = [];
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/Cmd\* c : CMDS/);
    expect(out.cpp).toMatch(/c->nm/);
    expect(out.cpp).not.toMatch(/c\.nm/);
  });

  it("a class instance declared after the class arrows its member calls", () => {
    const out = transpile(`
      class Stats { n = 0; count(): number { return this.n; } }
      class Runner {
        go(): number { return stats.count(); }
      }
      function poke(): number { return stats.count(); }
      const stats = new Stats();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/stats->count\(\)/);
    expect(out.cpp).not.toMatch(/stats\.count\(\)/);
  });

  it("a string-helper-initialized local keeps strlen length when the local is hoisted into an async task", () => {
    const out = transpile(`
      let sink = '';
      async function t(): Promise<void> {
        let line = 'a';
        line = line + 'b';
        sink = line;
        await Time.sleep(10);
        sink = line;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    // One string model: the hoisted member IS std::string (an owned
    // buffer — the const char* ring model is gone).
    expect(out.cpp).toMatch(/std::string _v_line/);
  });
});

describe("top-level const collections mutated from other bodies", () => {
  it("demotes a const Map mutated inside a function (was const std::map + operator[])", () => {
    const out = transpile(`
      const counts = new Map<string, number>();
      function bump(k: string): void { counts.set(k, 1); }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toMatch(/const std::map<std::string, double> counts/);
    expect(out.cpp).toMatch(/std::map<std::string, double> counts/);
  });

  it("demotes a const array pushed inside a function", () => {
    const out = transpile(`
      const order: string[] = [];
      function add(nm: string): void { order.push(nm); }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toMatch(/const __tc_StaticArray<[^>]*> order/);
  });
});

describe("honest diagnostics for unlowerable methods on StaticArray targets", () => {
  it("array.filter fails the transpile with a targeted diagnostic", () => {
    const out = transpile(`
      const a = [1, 2, 3];
      const b = a.filter((v) => v > 1);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const diags = (out.diagnostics ?? []).filter((d: any) => d.severity === 'error');
    expect(diags.some((d: any) => d.code === 'array-filter-unsupported')).toBe(true);
  });

  it("array.join lowers instead of diagnosing (one string model)", () => {
    // The old "folded result exceeds the fixed-size string model" diagnostic
    // is obsolete: std::string by value carries the fold, and the
    // __tc_StaticArray wrapper grew a join member (sentence-router demo).
    const out = transpile(`
      const a = [1, 2, 3];
      const s = a.join('-');
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const diags = (out.diagnostics ?? []).filter((d: any) => d.severity === 'error');
    expect(diags.some((d: any) => d.code === 'array-join-unsupported')).toBe(false);
  });

  it("string.split lowers to __tc_split (one string model)", () => {
    // The old "tokenize with a loop" hint is obsolete: under the one string
    // model every vector-capable target lowers split to the helper, which
    // returns std::vector<std::string>.
    const out = transpile(`
      const parts = 'a b'.split(' ');
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const diags = (out.diagnostics ?? []).filter((d: any) => d.severity === 'error');
    expect(diags.some((d: any) => d.code === 'array-split-unsupported')).toBe(false);
    expect(out.cpp).toMatch(/__tc_split\("a b", " "\)/);
  });

  it("a user-class method with a same name is NOT flagged", () => {
    const out = transpile(`
      class Registry { filter(v: number): number { return v; } }
      const r = new Registry();
      const x = r.filter(3);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const diags = (out.diagnostics ?? []).filter((d: any) => d.severity === 'error');
    expect(diags.some((d: any) => String(d.code).includes('unsupported'))).toBe(false);
  });
});

describe("JS number semantics survive IR-side rendering", () => {
  it("toFixed of an int division promotes to double division", () => {
    const out = transpile(`
      let sum = 0;
      let n = 10;
      sum = 385;
      const s = (sum / n).toFixed(2);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/static_cast<double>\(sum\) \/ static_cast<double>\(n\)/);
  });
});

describe("ADC device handles follow USED controllers", () => {
  const TWO_UNITS: ZephyrChipDescriptor = {
    id: 'x/y/z', soc: 'test', gpioController: 'gpio0',
    gpio: { dtSpecs: [] },
    adc: {
      nodeLabel: 'adc0', resolution: 12, vrefMv: 1100,
      channels: [
        { pin: 1, channel: 0 },
        { pin: 11, channel: 0, controller: 'adc1' },
      ],
    },
  } as unknown as ZephyrChipDescriptor;

  it("omits the primary handle when only the secondary controller is read", () => {
    const lines = adcInitLines(TWO_UNITS, new Set([11])).join('\n');
    expect(lines).not.toContain('DT_NODELABEL(adc0)');
    expect(lines).toContain('__tc_adc_adc1_dev = DEVICE_DT_GET(DT_NODELABEL(adc1))');
  });

  it("emits both handles when both controllers are read", () => {
    const lines = adcInitLines(TWO_UNITS, new Set([1, 11])).join('\n');
    expect(lines).toContain('__tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc0))');
    expect(lines).toContain('__tc_adc_adc1_dev = DEVICE_DT_GET(DT_NODELABEL(adc1))');
  });
});

describe("Zephyr string polyfills cover the rewritten helpers", () => {
  it("padStart/padEnd/repeat/lastIndexOf definitions ship", () => {
    const s = new ZephyrStrategy();
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = polys.find((p) => p.id === 'string_methods')?.helperFunctions.join('\n') ?? '';
    expect(text).toContain('__tc_padStart(');
    expect(text).toContain('__tc_padStart_default(');
    expect(text).toContain('__tc_padEnd(');
    expect(text).toContain('__tc_padEnd_default(');
    expect(text).toContain('__tc_repeat(');
    expect(text).toContain('__tc_lastIndexOf(');
  });
});
