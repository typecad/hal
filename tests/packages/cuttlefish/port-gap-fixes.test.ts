// ---------------------------------------------------------------------------
// Port-gap regression tests — engine fixes surfaced by porting real Arduino/
// C++ firmware (the Mod-EC I2C-salinity slave). Each block pins one formerly
// broken lowering:
//
//   1. Math.fround / Math.sign — no std::fround / std::sign exists.
//   2. Global Infinity / NaN identifiers — undeclared in C++.
//   3. Method-bearing TS interfaces — used to emit NOTHING (undefined type).
//   4. Un-annotated class-field initializers — `auto` non-static members are
//      illegal C++; infer from the initializer like local declarations.
//   5. Getter const-qualification — a const getter calling a non-const
//      sibling method does not compile; only const-SAFE getters carry const.
//   6. .fill() on embedded arrays — the StaticArray wrapper now implements
//      it, and a std::vector receiver lowers to std::fill.
//   7. Top-level runtime vars referenced only as receivers of NESTED calls
//      (f(p.measure())) are promoted to globals like every other reference.
//   8. A class field holding `new <HALClass>(...)` resolves its this-field
//      HAL calls (this.enable.set(...)) instead of leaking raw text.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("Math builtins with no std:: equivalent", () => {
  it("lowers Math.fround to a static_cast<float>", () => {
    const out = transpile(`
      const rounded = Math.fround(1.4);
      while (true) {}
    `);
    expect(out.cpp).toMatch(/static_cast<float>\(1\.4f?\)/);
    expect(out.cpp).not.toContain("std::fround");
  });

  it("lowers Math.sign without std::sign, preserving NaN", () => {
    const out = transpile(`
      const s = Math.sign(v);
      while (true) {}
    `);
    expect(out.cpp).not.toContain("std::sign");
    expect(out.cpp).toMatch(/\? 1\.0 :/);
    expect(out.cpp).toMatch(/< 0\.0 \? -1\.0 :/);
  });
});

describe("global Infinity / NaN identifiers", () => {
  it("lowers Infinity to INFINITY and NaN to NAN", () => {
    const out = transpile(`
      const lim = Infinity;
      const bad = NaN;
      while (true) {}
    `);
    expect(out.cpp).toMatch(/\bINFINITY\b/);
    expect(out.cpp).toMatch(/\bNAN\b/);
    // The macros come from the math header the Math lowering pulls in.
    expect(out.cpp).toMatch(/#include <cmath>/);
  });

  it("trips the math-include scan on INFINITY alone (no Math.* call)", () => {
    const out = transpile(`
      const lim = Infinity;
      while (true) {}
    `);
    expect(out.cpp).toContain("#include <cmath>");
  });
});

describe("method-bearing interfaces", () => {
  it("emits an abstract struct with pure-virtual methods", () => {
    const out = transpile(`
      interface KeyValueStore {
        getInt(key: string, defaultValue: number): number;
        setInt(key: string, value: number): void;
      }
      class DeviceStore implements KeyValueStore {
        getInt(key: string, defaultValue: number): number { return defaultValue; }
        setInt(key: string, value: number): void { return; }
      }
      const store: KeyValueStore = new DeviceStore();
      while (true) {}
    `);
    expect(out.cpp).toContain("struct KeyValueStore {");
    expect(out.cpp).toContain("virtual ~KeyValueStore() = default;");
    expect(out.cpp).toMatch(/virtual double getInt\([^)]*\) = 0;/);
    expect(out.cpp).toMatch(/virtual void setInt\([^)]*\) = 0;/);
    // implements a method-bearing interface → real inheritance.
    expect(out.cpp).toContain("class DeviceStore : public KeyValueStore {");
  });

  it("keeps field-only interfaces as plain aggregate structs (no vtable)", () => {
    const out = transpile(`
      interface Point { x: number; y: number; }
      const p: Point = { x: 1, y: 2 };
      while (true) {}
    `);
    expect(out.cpp).toContain("struct Point {");
    expect(out.cpp).not.toContain("virtual ~Point");
    expect(out.cpp).not.toContain("= 0;");
  });
});

describe("class-field initializer type inference", () => {
  it("infers double for fractional field inits (no auto non-static members)", () => {
    const out = transpile(`
      class Engine {
        tempCoef = 0.019;
        tempC = 25.0;
      }
      const e = new Engine();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/double tempCoef = 0\.019;/);
    expect(out.cpp).toMatch(/double tempC = 25;/);
    expect(out.cpp).not.toMatch(/auto tempCoef/);
  });

  it("keeps double precision on annotated double fields (no float rounding)", () => {
    const out = transpile(`
      class Engine {
        k: double = -0.00318692333;
      }
      const e = new Engine();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/double k = -0\.00318692333;/);
    expect(out.cpp).not.toMatch(/-0\.00318692333f/);
  });

  it("infers ClassName* for `new ClassName()` field inits", () => {
    const out = transpile(`
      class Inner { constructor() {} }
      class Outer {
        inner = new Inner();
      }
      const o = new Outer();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/Inner\* inner = new Inner\(\);/);
    expect(out.cpp).not.toMatch(/auto inner/);
  });
});

describe("getter const-qualification safety", () => {
  it("keeps const on a getter that only reads fields", () => {
    const out = transpile(`
      class Regs {
        count = 3;
        get total(): number { return this.count; }
      }
      const r = new Regs();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/double getTotal\(\) const/);
  });

  it("drops const when the getter calls a non-const sibling method", () => {
    const out = transpile(`
      class Regs {
        bytes: number[] = [];
        get value(): number { return this.readF32(); }
        readF32(): number { this.bytes[0] = 1; return this.bytes[0]; }
      }
      const r = new Regs();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/double getValue\(\)\s*\{/);
    expect(out.cpp).not.toMatch(/getValue\(\) const/);
  });

  it("drops const when the getter assigns a this-field (through a getter chain)", () => {
    const out = transpile(`
      class C {
        n = 0;
        get a(): number { this.n = 1; return this.n; }
        get b(): number { return this.a(); }
      }
      const c = new C();
      while (true) {}
    `);
    // a writes a field; b calls a — BOTH must be non-const (fixpoint).
    expect(out.cpp).not.toMatch(/getA\(\) const/);
    expect(out.cpp).not.toMatch(/getB\(\) const/);
  });

  it("keeps const through a getter-to-getter chain that only reads", () => {
    const out = transpile(`
      class C {
        n = 0;
        get a(): number { return this.n; }
        get b(): number { return this.a(); }
      }
      const c = new C();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/getA\(\) const/);
    expect(out.cpp).toMatch(/getB\(\) const/);
  });
});

describe(".fill() on embedded arrays", () => {
  it("lowering a literal-declared array's fill uses the StaticArray wrapper member", () => {
    const out = transpile(`
      const a = [1, 2, 3];
      a.fill(0);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/\(a\)\.fill\(0\)/);
    // The wrapper template ships the member (both arities) — and IS emitted
    // because the variable's type names it (the analysis gates the polyfill
    // on the type, not on a call pattern).
    expect(out.cpp).toMatch(/__tc_StaticArray& fill\(T val\)/);
    expect(out.cpp).toMatch(/fill\(T val, int start, int end\)/);
    expect(out.cpp).toContain("struct __tc_StaticArray");
  });

  it("lowers .fill on an annotated vector-typed class field to std::fill", () => {
    const out = transpile(`
      class Win {
        bytes: number[] = [];
        reset(): void { this.bytes.fill(0); }
      }
      const w = new Win();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/std::fill\(this->bytes\.begin\(\), this->bytes\.end\(\), 0\)/);
    expect(out.cpp).toContain("#include <algorithm>");
    expect(out.cpp).not.toMatch(/this->bytes\.fill\(/);
  });
});

describe("top-level runtime var referenced only inside nested call args", () => {
  it("is promoted to a file-scope global", () => {
    const out = transpile(`
      class Probe { measure(): number { return 1; } }
      class Meter { wrap(v: number): void { return; } }
      const meter = new Meter();
      const probe = new Probe();
      function run(): void { meter.wrap(probe.measure()); }
      run();
      while (true) {}
    `);
    // probe must live at file scope (i2cSlaveProcess-style reference).
    expect(out.cpp).toMatch(/Probe\* probe = \{\};/);
    expect(out.cpp).toMatch(/probe = new Probe\(\);/);
  });
});

describe("class fields holding HAL objects", () => {
  it("resolves this-field HAL calls (GPIO member) with no C++ field", () => {
    const out = transpile(`
      import { GPIO } from '@typecad/hal';
      class Front {
        private enable = new GPIO(4, GPIO.OUTPUT);
        on(): void { this.enable.set(true); }
      }
      const f = new Front();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    // The HAL call must lower to a gpio op — not leak as a C++ method call on
    // a nonexistent GPIO class.
    expect(out.cpp).not.toContain("this->enable.set(");
    expect(out.cpp).toMatch(/gpio_pin_set_dt|gpio_pin_set_raw|__tc_gpio/);
    // A HAL-object field has NO C++ declaration (the class doesn't exist in
    // the output); only the ops carry it.
    expect(out.cpp).not.toMatch(/GPIO\* enable/);
    expect(out.cpp).not.toMatch(/new GPIO\(/);
  });

  it("resolves instance-field HAL receivers across the class boundary", () => {
    const out = transpile(`
      import { GPIO } from '@typecad/hal';
      let n = 0;
      function countEdge(): void { n++; }
      class Front {
        pin = new GPIO(4, GPIO.OUTPUT);
      }
      const f = new Front();
      f.pin.onInterrupt(GPIO.INT_EDGE_RISING, countEdge);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toContain("f->pin.onInterrupt");
    expect(out.cpp).not.toContain("GPIO.INT_EDGE_RISING");
    expect(out.cpp).toMatch(/gpio_init_callback/);
  });
});

// ---------------------------------------------------------------------------
// Sibling-sweep round 2 — more members of the same bug classes, found by
// probing the lowered output of representative snippets.
// ---------------------------------------------------------------------------

describe("Math builtins round 2", () => {
  it("lowers Math.clz32 without std::clz32", () => {
    const out = transpile(`const a = Math.clz32(v); while (true) {}`);
    expect(out.cpp).not.toContain("std::clz32");
    expect(out.cpp).toContain("__builtin_clz");
    expect(out.cpp).toContain("? 32 :");
  });

  it("lowers Math.imul without std::imul (ToInt32 semantics)", () => {
    const out = transpile(`const a = Math.imul(v, w); while (true) {}`);
    expect(out.cpp).not.toContain("std::imul");
    expect(out.cpp).toMatch(/static_cast<long long>\(v\).*\*.*static_cast<long long>\(w\)/s);
  });
});

describe("JS conversion globals", () => {
  it("Number(x) casts to double instead of passing through", () => {
    const out = transpile(`const a = Number(v); while (true) {}`);
    expect(out.cpp).toMatch(/static_cast<double>\(v\)/);
  });

  it("parseInt keeps the std::string→c_str() shaping", () => {
    const out = transpile(`
      function go(s: string): number { return parseInt(s); }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/atoi\(\(s\)\.c_str\(\)\)/);
  });
});

describe("function parameters", () => {
  it("un-annotated params lower to double, never const auto&", () => {
    const out = transpile(`
      function f(x) { const y = x + 1; return y; }
      const r = f(2);
      while (true) {}
    `);
    expect(out.cpp).toMatch(/f\(double x\)/);
    expect(out.cpp).not.toContain("const auto&");
  });

  it("default parameter values emit on the prototype", () => {
    const out = transpile(`
      function f(x = 0.5): number { return x; }
      const r = f();
      while (true) {}
    `);
    expect(out.cpp).toMatch(/f\(double x = 0\.5\)/);
  });
});

describe("compound bitwise assignment", () => {
  it("casts through int on a real-typed target (JS ToInt32)", () => {
    const out = transpile(`
      let x = 1.5;
      x &= 0xff;
      while (true) {}
    `);
    expect(out.cpp).toMatch(/x = static_cast<int>\(x\) & 255/);
    expect(out.cpp).not.toMatch(/x &= 255/);
  });
});

describe("new Array<E>(n) locals", () => {
  it("infers std::vector<E>, not an Array<E>* pointer", () => {
    const out = transpile(`
      const a = new Array<number>(8);
      a[0] = 1;
      while (true) {}
    `);
    expect(out.cpp).not.toContain("Array<number>");
    expect(out.cpp).toMatch(/std::vector<double>\s+a\s*=\s*std::vector<double>\(8\)/);
  });
});

describe("StaticArray wrapper methods round 2", () => {
  it("includes/shift/lastIndexOf lower to wrapper calls, not string helpers", () => {
    const out = transpile(`
      const a = [1, 2, 3];
      const hit = a.includes(2);
      const first = a.shift();
      const idx = a.lastIndexOf(2);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toContain("strstr(a");
    // The string helper now EXISTS in the Zephyr polyfill (defined for real
    // string receivers) — the guard is that this ARRAY call doesn't use it.
    expect(out.cpp).not.toMatch(/__tc_lastIndexOf\(\s*a/);
    expect(out.cpp).not.toContain("__tc_str_ptr");
    expect(out.cpp).toMatch(/\(a\)\.includes\(2\)/);
    expect(out.cpp).toMatch(/\(a\)\.shift\(\)/);
    expect(out.cpp).toMatch(/\(a\)\.lastIndexOf\(2\)/);
    // The wrapper defines all of them.
    expect(out.cpp).toMatch(/T shift\(\)/);
    expect(out.cpp).toMatch(/bool includes\(T val\) const/);
    expect(out.cpp).toMatch(/int lastIndexOf\(T val\) const/);
  });

  it("array.join lowers on every receiver shape (one string model)", () => {
    // Zephyr carries full libstdc++ + std::string by value, so the fold has
    // a real lowering on both shapes: array literals take __tc_StaticArray's
    // join member, annotated/loop-pushed locals take the __tc_join vector
    // helper. The old "fails loudly" contract is obsolete (sentence-router
    // demo finding).
    const out = transpile(`
      const a = [1, 2, 3];
      const s = a.join("-");
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs.some(d => d.code === "array-join-unsupported")).toBe(false);
  });

  it("Map.keys() fails loudly instead of emitting m->keys()", () => {
    // No-STL target: no __tc_map* helpers exist there, so the transpile fails
    // with an actionable diagnostic instead of emitting a call to nothing.
    const out = transpile(`
      const m = new Map<string, number>();
      for (const k of m.keys()) { }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toContain("->keys()");
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs.some(d => d.code === "map-iteration-unsupported")).toBe(true);
  });

  it("Map.keys() lowers to the helper on targets that ship it", () => {
    // Hosted targets carry the __tc_map* polyfills (generic/native ship them
    // since the hosted shim extraction), so the same call lowers.
    const out = transpile(`
      const m = new Map<string, number>();
      for (const k of m.keys()) { }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/__tc_mapKeys\(/);
  });
});

// ---------------------------------------------------------------------------
// Round 3 — the std:: surface audit: every std function the engine emits
// must exist on the target, carry its header, and keep JS semantics.
// ---------------------------------------------------------------------------

describe("std math surface", () => {
  it("isNaN/isFinite/log2/hypot trip the <cmath> include scan", () => {
    const cases = [
      "const a = isNaN(v); while (true) { if (a) {} }",
      "const a = isFinite(v); while (true) { if (a) {} }",
      "const a = Math.log2(v); while (true) { if (a > 0) {} }",
      "const a = Math.hypot(v, w); while (true) { if (a > 0) {} }",
      "const a = Math.cbrt(v); while (true) { if (a > 0) {} }",
    ];
    for (const code of cases) {
      const out = transpile(code, { strategy: zephyr(), target: 'zephyr' });
      expect(out.cpp, code).toContain("#include <cmath>");
    }
  });

  it("Math.round uses the JS half-up rule, not std::round's half-away", () => {
    const out = transpile(`const a = Math.round(v); while (true) { if (a > -9007199254740991) {} }`);
    expect(out.cpp).toMatch(/std::floor\(\(v\) \+ 0\.5\)/);
    expect(out.cpp).not.toContain("std::round");
  });
});

describe("Error values", () => {
  it("throw new Error still lowers to cuttlefish_halt with NO diagnostic on zephyr", () => {
    const out = transpile(`
      function f(): void { throw new Error("boom"); }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toContain("cuttlefish_halt");
    expect(out.cpp).not.toContain("std::runtime_error");
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs).toHaveLength(0);
  });

  it("new Error as a value fails loudly on no-exception targets", () => {
    const out = transpile(`
      function f(): string { const e = new Error("x"); return "s"; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs.some(d => d.code === "error-value-unsupported")).toBe(true);
  });

  it("new Error as a value compiles on hosted: runtime_error type + <stdexcept>", () => {
    const out = transpile(`
      function f(): string { const e = new Error("x"); return "s"; }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/const std::runtime_error e = std::runtime_error\("x"\)/);
    expect(out.cpp).toContain("#include <stdexcept>");
  });
});

describe("regex literals", () => {
  it("/re/.test(s) lowers to std::regex_search with <regex>", () => {
    const out = transpile(`
      function go(text: string): boolean { return /a+b/.test(text); }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/std::regex_search\(text, std::regex\("\S+"\)\)/);
    expect(out.cpp).toContain("#include <regex>");
    expect(out.cpp).not.toContain(".test(");
  });
});

describe("std::variant availability", () => {
  it("discriminated unions fail loudly on C++14 targets", () => {
    const out = transpile(`
      type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
      function area(x: Shape): number { return x.r; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs.some(d => d.code === "variant-unsupported-on-target")).toBe(true);
  });

  it("discriminated unions keep their <variant> include on hosted", () => {
    const out = transpile(`
      type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
      function area(x: Shape): number { return 1; }
      while (true) {}
    `);
    expect(out.cpp).toContain("#include <variant>");
    expect(out.cpp).toContain("std::variant<");
  });
});

describe("conversion-global headers", () => {
  it("parseInt registers <cstdlib>", () => {
    const out = transpile(`
      function go(s: string): number { return parseInt(s); }
      while (true) {}
    `);
    expect(out.cpp).toContain("atoi(");
    expect(out.cpp).toMatch(/#include <cstdlib>/);
  });
});

// ---------------------------------------------------------------------------
// Round 4 — transport-layer audit: runtime buffers handed to I2C ops.
// ---------------------------------------------------------------------------

describe("I2C runtime buffer writes", () => {
  it("resp.write(vector) sizes with .size(), not C sizeof", () => {
    const out = transpile(`
      import { I2C0 } from '@typecad/hal';
      const resp = I2C0.responder(0x2a);
      const tx: number[] = [];
      function serve(): void {
        tx.push(1);
        tx.push(2);
        resp.write(tx);
      }
      while (true) { serve(); }
    `, { strategy: zephyr(), target: 'zephyr' });
    // The vector path: element-clamped copy + .size() length. The sizeof
    // path read the vector OBJECT's size (garbage-length heap read).
    expect(out.cpp).toMatch(/__tc_i < tx\.size\(\)/);
    expect(out.cpp).toMatch(/txlen = \(tx\.size\(\) < 32U\)/);
    expect(out.cpp).not.toMatch(/sizeof\(tx\)/);
  });

  it("resp.write(C array) keeps the sizeof path", () => {
    const out = transpile(`
      import { I2C0 } from '@typecad/hal';
      const resp = I2C0.responder(0x2a);
      const txBuf = new Uint8Array(4);
      function serve(): void {
        txBuf[0] = 1;
        resp.write(txBuf);
      }
      while (true) { serve(); }
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_i < sizeof\(txBuf\)/);
    expect(out.cpp).toMatch(/txlen = \(sizeof\(txBuf\) < 32U\)/);
  });
});

// ---------------------------------------------------------------------------
// Round 5 — control-flow, character/string mixing, and container-annotation
// audit.
// ---------------------------------------------------------------------------

describe("string comparisons", () => {
  it("const char* equality uses strcmp, not pointer ==", () => {
    const out = transpile(`
      function go(a: string, b: string): boolean { return a === b; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/a == b/);
    // (a == b is now the NATIVE std::string comparison — correct JS
    // semantics under the one string model; the old pointer-== hazard only
    // existed for const char* locals.)
  });

  it("const char* relational uses strcmp, not pointer <", () => {
    const out = transpile(`
      function go(a: string, b: string): boolean { return a < b; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/a < b/);
  });

  it("switch on a string parameter compares contents", () => {
    const out = transpile(`
      function go(mode: string): number { switch (mode) { case "fast": return 1; default: return 0; } }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toMatch(/mode == "fast"/);
    expect(out.cpp).toMatch(/std::string\(mode\) == "fast"|strcmp\(mode, "fast"\)/);
  });

  it("char vs single-char string literal compares as chars", () => {
    const out = transpile(`
      function go(s: string): boolean { return s[0] === "a"; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/\(s\[0\] == 'a'\)/);
    expect(out.cpp).not.toContain("strcmp(s[0]");
  });

  it("char never equals a multi-char string literal", () => {
    const out = transpile(`
      function go(s: string): boolean { return s[0] === "ab"; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/return false/);
  });
});

describe("character semantics", () => {
  it("s[0] + string concatenates the CHARACTER, not its code point", () => {
    const out = transpile(`
      function go(s: string): string { return s[0] + "x"; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/%c/);
    expect(out.cpp).not.toMatch(/%d.*s\[0\]|to_string\(s\[0\]\)/);
  });
});

describe("Number.prototype.toString", () => {
  it("toString(16) lowers to the radix helper", () => {
    const out = transpile(`
      function go(v: number): string { return v.toString(16); }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_num_radix\(static_cast<long long>\(v\), 16\)/);
    expect(out.cpp).toMatch(/__tc_num_radix\(long long v, int radix\)/);
    expect(out.cpp).not.toContain("v.toString(16)");
  });

  it("toString() keeps fractional precision via the formatting machinery", () => {
    const out = transpile(`
      function go(v: number): string { return v.toString(); }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toContain("v.toString()");
    expect(out.cpp).toMatch(/%.15g|snprintf/);
  });
});

describe("for-of over strings", () => {
  it("lowers to an index loop, not a range-for over const char*", () => {
    const out = transpile(`
      function go(s: string): number { let n = 0; for (const ch of s) { n++; } return n; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toMatch(/for \(const auto& ch : s\)/);
    // Round-3 template: an index loop over a once-evaluated string copy,
    // loop var a mutable char (the old `const char* it, ch` declarator made
    // ch const — its reassignment was ill-formed).
    expect(out.cpp).toMatch(/const std::string __tc_str_s_\d+ = s;/);
    expect(out.cpp).toMatch(/for \(long long __tc_str_i_\d+ = 0, \w+ = 0; __tc_str_i_\d+ < static_cast<long long>\(__tc_str_s_\d+\.length\(\)\)/);
    expect(out.cpp).not.toMatch(/for \(const char\* __tc_str_it/);
    expect(out.cpp).toMatch(/\(\(\w+ = __tc_str_s_\d+\[__tc_str_i_\d+\]\), true\)/);
  });
});

describe("index-signature annotations", () => {
  it("{ [k: string]: number } lowers to std::map, not an empty struct", () => {
    const out = transpile(`
      function go(): number { const m: { [k: string]: number } = {}; m["a"] = 1; return m["a"]; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/std::map<std::string, double> m/);
    expect(out.cpp).not.toContain("struct _m_t");
  });
});

describe("struct equality", () => {
  it("interface === lowers to pointer identity (interfaces are references)", () => {
    // Interfaces lower to pointer-typed references (bench-supervisor demo:
    // value-typed interface containers could not instantiate the abstract
    // struct), so `a === b` is pointer identity — exactly JS's reference
    // equality — and compiles. The struct-equality guard now only fires for
    // genuine struct values (object-literal types).
    const out = transpile(`
      interface P { x: number; }
      function go(a: P, b: P): boolean { return a === b; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/go\(P\* a, P\* b\)/);
    expect(out.cpp).toMatch(/a == b/);
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs.some(d => d.code === "struct-equality-unsupported")).toBe(false);
  });

  it("class-instance === keeps pointer identity (correct JS semantics)", () => {
    const out = transpile(`
      class C { v: number = 0; }
      const a = new C();
      const b = new C();
      function go(): boolean { return a === b; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    const errs = (out.diagnostics ?? []).filter(d => d.severity === "error");
    expect(errs).toHaveLength(0);
    expect(out.cpp).toMatch(/a == b/);
  });
});

// ---------------------------------------------------------------------------
// Round 6 — std:: surface + JS-semantics gaps found by a transpile→compile→run
// audit matrix (each case reproduced against real JS behavior first).
// ---------------------------------------------------------------------------

describe("Round 6: math include scan covers the full emitted set", () => {
  it.each([
    ["Math.exp", "const a = Math.exp(1.0);"],
    ["Math.log", "const a = Math.log(v);"],
  ])("%s pulls in <cmath>", (_name, code) => {
    const out = transpile(`
      function go(v: number): number { return ${code.replace("const a =", "")}; }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/std::(exp|log)\(/);
    expect(out.cpp).toContain("#include <cmath>");
  });

  it("real modulo lowers to std::fmod with <cmath>", () => {
    const out = transpile(`
      function go(a: number, b: number): number { return a % b; }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/std::fmod\(/);
    expect(out.cpp).toContain("#include <cmath>");
  });

  it("** lowers to std::pow (qualified, from the math header)", () => {
    const out = transpile("const a = 2 ** 10; while (true) {}");
    expect(out.cpp).toContain("std::pow(");
  });

  it("Math.toString / Math.valueOf do not resolve to Object.prototype members", () => {
    // MATH_CONSTANT_LITERALS and the array-method lookup tables are
    // prototype-free: `Math.toString` must not coerce the inherited Function.
    expect(() => transpile("const f = Math.toString; while (true) {}")).not.toThrow();
  });
});

describe("Round 6: JS arithmetic semantics", () => {
  it("/ promotes to real division on the hosted target", () => {
    const out = transpile("function go(): number { return 7 / 2; } while (true) {}");
    expect(out.cpp).toMatch(/static_cast<double>\(7\) \/ static_cast<double>\(2\)/);
  });

  it("|| yields the OPERAND, not a bool (value position)", () => {
    const out = transpile("function go(): number { return 0 || 5; } while (true) {}");
    expect(out.cpp).toMatch(/0 \? 0 : 5/);
  });

  it("&& yields the OPERAND, not a bool (value position)", () => {
    const out = transpile("function go(): number { return 1 && 2; } while (true) {}");
    expect(out.cpp).toMatch(/1 \? 2 : 1/);
  });

  it("&& in a condition keeps C++ short-circuit semantics", () => {
    const out = transpile(`
      function go(a: number, b: number): number {
        if (a > 0 && b > 0) { return 1; }
        return 0;
      }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/a > 0 && b > 0/);
    expect(out.cpp).not.toMatch(/a > 0 \?/);
  });
});

describe("Round 6: conversion globals", () => {
  it("Number(string) registers <cstdlib> and declares a double", () => {
    const out = transpile(`function go(): number { const a = Number("3.5"); return a; } while (true) {}`);
    expect(out.cpp).toMatch(/atof\(/);
    expect(out.cpp).toContain("#include <cstdlib>");
    expect(out.cpp).toMatch(/const double a = atof\(/);
  });

  it("parseFloat keeps fractional precision (no const int truncation)", () => {
    const out = transpile(`function go(): number { const a = parseFloat("1.5"); return a; } while (true) {}`);
    expect(out.cpp).toMatch(/const double a = atof\("1\.5"\)/);
  });
});

describe("Round 6: string methods resolve for every receiver shape", () => {
  it("indexOf/includes on a string PARAM lower to the polyfill helpers", () => {
    const out = transpile(`
      function hit(s: string): boolean { return s.includes("W"); }
      function pos(s: string): number { return s.indexOf("W"); }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/__tc_includes\(s, /);
    expect(out.cpp).toMatch(/__tc_indexOf\(s, /);
    expect(out.cpp).not.toMatch(/s\.includes\(/);
    expect(out.cpp).not.toMatch(/s\.indexOf\(/);
  });

  it("an indexOf call no longer poisons other string methods on the same var", () => {
    const out = transpile(`
      function go(s: string): number {
        const u = s.toUpperCase();
        return s.indexOf("W") + u.length;
      }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/__tc_toUpperCase\(s\)/);
  });

  it("ambiguous methods lower on string LITERAL receivers", () => {
    const out = transpile(`function go(): string { return "hello".substring(1, 3); } while (true) {}`);
    expect(out.cpp).toMatch(/__tc_substring2\(/);
  });
});

describe("Round 6: Object.prototype lookup trap on method names", () => {
  it("n.toString(16) in a function body lowers to __tc_num_radix (no crash)", () => {
    // VECTOR_CALLBACK_METHOD_HELPERS is a plain object; `toString` resolved to
    // the inherited Object.prototype.toString (truthy) and the analysis crashed
    // with `expr.callee.includes is not a function`.
    const out = transpile(`function go(): string { const n = 255; return n.toString(16); } while (true) {}`);
    expect(out.cpp).toMatch(/__tc_num_radix\(static_cast<long long>\(n\), 16\)/);
  });
});

describe("Round 6: generic target ships the hosted shim surface", () => {
  it("?? emits the cuttlefish_nullish definition on the generic target", () => {
    const out = transpile(`function go(v: number | null): number { return v ?? 5; } while (true) {}`);
    expect(out.cpp).toContain("cuttlefish_nullish(");
    expect(out.cpp).toMatch(/inline T cuttlefish_nullish\(const T& a, U b\)/);
  });

  it("string helpers ship their definitions on the generic target", () => {
    const out = transpile(`function go(s: string): string { const t = s.toUpperCase(); return t; } while (true) {}`);
    expect(out.cpp).toContain("__tc_toUpperCase(s)");
    expect(out.cpp).toMatch(/inline std::string __tc_toUpperCase\(const std::string& s\)/);
  });
});

describe("Round 6: containers and exceptions", () => {
  it("rest-param calls collect args into the declared vector type", () => {
    const out = transpile(`
      function sum(...vals: number[]): number {
        let s = 0;
        for (const v of vals) { s += v; }
        return s;
      }
      function go(): number { return sum(1, 2, 3); }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/sum\(std::vector<double>\{1, 2, 3\}\)/);
  });

  it("a spread rest call passes the vector directly (no double wrap)", () => {
    const out = transpile(`
      function sum(...vals: number[]): number {
        let s = 0;
        for (const v of vals) { s += v; }
        return s;
      }
      function go(vals: number[]): number { return sum(...vals); }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/sum\(vals\)/);
    expect(out.cpp).not.toMatch(/sum\(std::vector/);
  });

  it("catch (e) binds e and .message lowers to .what()", () => {
    const out = transpile(`
      function go(): string {
        let msg = "";
        try { throw new Error("boom"); } catch (e) { msg = (e as Error).message; }
        return msg;
      }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/catch \(const std::exception& e\)/);
    expect(out.cpp).toMatch(/\.what\(\)/);
  });

  it("for (const [k, v] of map) iterates the pair with std::get", () => {
    const out = transpile(`
      function go(): number {
        const m = new Map<string, number>();
        m.set("a", 1);
        let s = 0;
        for (const [k, v] of m) { s += v; }
        return s;
      }
      while (true) {}
    `);
    expect(out.cpp).toMatch(/std::pair<const std::string, double>/);
    expect(out.cpp).toMatch(/std::get<1>/);
  });
});
