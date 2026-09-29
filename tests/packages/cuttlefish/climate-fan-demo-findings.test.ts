// ---------------------------------------------------------------------------
// climate-fan-demo-findings.test.ts — regressions for the transpiler bugs the
// zephyr-climate-fan demo (demos/zephyr-climate-fan) surfaced. Each test pins
// one TS→C++ boundary the demo exercised:
//
//   1. TS default parameter values must survive into the emitted C++
//      declaration — `windup = 3.0` was dropped and `Pid.bench()`'s 3-arg
//      call failed to compile against the 4-parameter constructor.
//   2. Getter property access on a class instance (`pid.integral`) must
//      lower to the accessor CALL (`pid->getIntegral()`): the backing field
//      is private in the generated class, and the getter may compute. The
//      snprintf specifier must follow the getter's return type (%g for
//      number, %s for string) — the %d default printed garbage.
//   3. A free-function call inside a template literal
//      (`${modeLabel(mode)}`) must format by the function's annotated
//      return type — a const char* return printed its POINTER through the
//      %d default (cross-module functions included).
//   4. `let mode: FanMode = settings.getInt(...)` must keep the enum type:
//      `auto mode = <int>` made every `mode == FanMode::Off` comparison and
//      enum-parameter call ill-formed C++ (enum class has no implicit int
//      conversion). The read needs static_cast<FanMode> and the int-typed
//      HAL write parameter needs static_cast<int32_t>.
//   5. An enum MEMBER argument to a number-annotated HAL parameter
//      (`setInt('m', FanMode.Boost)`, `getInt('m', FanMode.Auto)`) must cast
//      down like an enum-typed identifier does — the raw shim parameter is
//      int32_t and a scoped enum has no implicit conversion. The get_*
//      default ALSO used to be dropped entirely: resolveNumericArg saw
//      non-numeric text and the plugin's `?? 0` silently replaced the
//      caller's default (fresh boot came up Off instead of Auto).
//   6. A float literal default must survive resolution — the renderer
//      emits `1.5f` (C++ suffix) and Number("1.5f") was NaN, so
//      `getFloat('f', 1.5)` lowered with default 0.
//   7. Runtime expressions must ride the op verbatim: `setBool('f', flag)`
//      folded `value === "true"` and wrote false for every variable;
//      `getString('n', fallbackName())` was quoteNonIdentifier'd into the
//      LITERAL "fallbackName()".
//   8. A negative float literal (`const FLOOR = -5.0`) is a prefix-unary
//      over the number — the declaration inferred `auto` while its positive
//      sibling inferred `double`. The auto-typed global was also skipped by
//      the split-mode header emitter, so the extern list lost the constant.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy } from '../../setup';

describe('climate-fan demo findings', () => {
  it('keeps TS default parameter values on the emitted C++ declaration', () => {
    const r = transpileZephyrStrategy(`
      class Pid {
        constructor(kp: number, ki: number, kd: number, windup = 3.0) {
          this._w = windup;
        }
        private _w: number;
      }
      const p = new Pid(0.09, 0.002, 0.4);
    `);

    // The declaration carries the default; a 3-arg call links.
    expect(r.cpp).toMatch(/Pid\(double kp, double ki, double kd, double windup = 3\)/);
  });

  it('lowers instance getter access to the accessor call with the right format', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Box {
        private _v: number;
        constructor(v: number) { this._v = v; }
        get v(): number { return this._v; }
      }
      const box = new Box(42);
      UART0.writeLine(\`v=\${box.v}\`);
    `);

    // The accessor call, not the (private) field read…
    expect(r.cpp).toMatch(/box->getV\(\)/);
    // …and %g for the number-returning getter, never the %d default.
    expect(r.cpp).toMatch(/"v=%g", box->getV\(\)/);
  });

  it('resolves an inherited getter through the extends chain', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Base {
        private _on: boolean;
        constructor() { this._on = false; }
        get on(): boolean { return this._on; }
      }
      class Sub extends Base {
        constructor() { super(); }
      }
      const s = new Sub();
      if (s.on) { UART0.writeLine('on'); }
    `);

    expect(r.cpp).toMatch(/s->getOn\(\)/);
  });

  it('formats a free-function call in a template by its annotated return type', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function modeLabel(m: number): string {
        return m === 0 ? 'OFF' : 'ON';
      }
      UART0.writeLine(\`mode=\${modeLabel(0)}\`);
    `);

    // const char* return → %s, never %d (which printed the pointer value).
    expect(r.cpp).toMatch(/"mode=%s", modeLabel\(0\)/);
  });

  it('keeps the enum type on a settings-backed variable and casts both boundaries', () => {
    const r = transpileZephyrStrategy(`
      import { UART0, Store } from '@typecad/hal';
      enum FanMode { Off = 0, Auto = 1 }
      const settings = new Store('app');
      let mode: FanMode = settings.getInt('mode', FanMode.Auto);
      if (mode === FanMode.Off) {
        mode = FanMode.Auto;
        settings.setInt('mode', mode);
      }
      UART0.writeLine(\`m=\${mode}\`);
    `);

    // The variable is the enum (comparisons against FanMode::… compile)…
    expect(r.cpp).toMatch(/FanMode mode = static_cast<FanMode>\(__tc_prefs_get_int/);
    // …writes through the int-typed shim parameter cast down…
    expect(r.cpp).toMatch(/__tc_prefs_put_int\("tc\/app\/mode", static_cast<int32_t>\(mode\)\)/);
    // …and the enum formats as an integer (%d), not a double.
    expect(r.cpp).toMatch(/"m=%d", mode/);
  });

  it('casts an enum member passed to a number-typed HAL parameter', () => {
    const r = transpileZephyrStrategy(`
      import { Store } from '@typecad/hal';
      enum FanMode { Off = 0, Auto = 1 }
      const settings = new Store('app');
      settings.setInt('m', FanMode.Auto);
    `);

    // The shim parameter is int32_t — the scoped enum cannot pass uncast.
    expect(r.cpp).toMatch(/__tc_prefs_put_int\("tc\/app\/m", static_cast<int32_t>\(FanMode::Auto\)\)/);
  });

  it('keeps an enum member default on a store read (never the silent 0)', () => {
    const r = transpileZephyrStrategy(`
      import { Store } from '@typecad/hal';
      enum FanMode { Off = 0, Auto = 1 }
      const settings = new Store('app');
      const n = settings.getInt('n', FanMode.Auto);
    `);

    // The caller's default survives, cast to the shim's int32_t parameter —
    // previously resolveNumericArg failed on `FanMode::Auto` and `?? 0`
    // made every fresh boot start in Off (0) instead of Auto (1).
    expect(r.cpp).toMatch(/__tc_prefs_get_int\("tc\/app\/n", static_cast<int32_t>\(FanMode::Auto\)\)/);
  });

  it('resolves float literal defaults through the f-suffixed render', () => {
    const r = transpileZephyrStrategy(`
      import { Store } from '@typecad/hal';
      const settings = new Store('app');
      const f = settings.getFloat('f', 1.5);
    `);

    // The expression renderer emits `1.5f`; Number("1.5f") was NaN and the
    // default silently became 0.
    expect(r.cpp).toMatch(/__tc_prefs_get_float\("tc\/app\/f", 1\.5\)/);
  });

  it('carries runtime bool and string arguments verbatim', () => {
    const r = transpileZephyrStrategy(`
      import { Store } from '@typecad/hal';
      const settings = new Store('app');
      let flag = true;
      settings.setBool('f', flag);
      const fb = settings.getBool('f', flag);
      const name = settings.getString('n', fallbackName());
      function fallbackName(): string { return 'x'; }
    `);

    // A variable bool rode the op as `value === "true"` → literal false…
    expect(r.cpp).toMatch(/__tc_prefs_put_bool\("tc\/app\/f", flag\)/);
    expect(r.cpp).toMatch(/__tc_prefs_get_bool\("tc\/app\/f", flag\)/);
    // …and a call-expression string default was stringified into a literal.
    expect(r.cpp).toMatch(/__tc_prefs_get_string\("tc\/app\/n", fallbackName\(\)\)/);
    expect(r.cpp).not.toMatch(/"fallbackName\(\)"/);
  });

  it('types a negative float literal like its positive sibling', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const FLOOR = -5.0;
      const CEILING = 55.0;
      UART0.writeLine(\`\${FLOOR}\`);
    `);

    // -5.0 is a prefix-unary over a double literal: both constants get an
    // explicit `double`, not `auto` (which also dropped FLOOR from the
    // split-mode header's extern list).
    expect(r.cpp).toMatch(/const double FLOOR = -5;/);
    expect(r.cpp).toMatch(/const double CEILING = 55;/);
    expect(r.cpp).not.toMatch(/const auto FLOOR/);
  });
});
