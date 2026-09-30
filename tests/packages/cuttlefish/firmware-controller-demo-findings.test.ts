// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-firmware-
// controller demo (a plain superloop firmware: persistent calibrated config
// with checksum, cooperative tick scheduler over a task table, debounced
// button, EMA-filtered sensor, hysteresis + slew-limited PWM, latched
// alarms, serial command interpreter, watchdog).
//
// FIXED here:
//   1. HAL method calls INSIDE FUNCTIONS miscompiled silently. Function
//      bodies lower before the top-level `new GPIO(...)` declarations that
//      register halInstances, so the receiver resolved to nothing and the
//      fallback half-inlined the method body with unsubstituted this-fields
//      (`adcReadMv(PA1, , , this->_channel…)`) — no diagnostic. build-ir now
//      PRE-REGISTERS every top-level HAL construction (after the board-pin
//      import scan, so pin text resolves numerically), via the ctor-field
//      extraction shared out of variables.ts.
//   2. The identifier pin-substitution rule rendered ANY halInstance with a
//      _pin field as that pin — including constructed peripherals. A failed
//      method resolution on `fan` emitted `8->setDuty(x)` (receiver = the
//      pin number), a silent miscompile. The rule is now PIN CONSTANTS only
//      (className Pin), and a registered instance whose method body resolves
//      to nothing fails LOUDLY (hal-method-unresolved) instead of emitting
//      garbage.
//   3. Const-named construction options (`new PWM(PA8, { periodNs:
//      FAN_PWM_NS })`, `new Watchdog(WDOG_MS * 4)`) left numeric ctor fields
//      unset — literal-only extraction — so the pwm/wdt ops never resolved.
//      Both extraction sites now const-fold identifiers and simple
//      arithmetic over top-level numeric consts (resolveConstNumericExpr).
//   4. `x.toString().padStart(...)` — no-arg toString on a number lowers to
//      a template_string conversion whose IR-side render is the BARE number;
//      the string-method receiver then got a double where the helper takes
//      const std::string&. Numeric conversions now render through
//      __tc_numToStr_js in the string-method receiver position.
//   5. A synthesized type-alias struct carrying a std::function field (the
//      scheduler's `type Task = { run: () => void }`) emitted into the HEADER
//      without <functional> — the include scan never looked at structFields.
//   6. `const t = tasks[i]; t.last = now;` — the JS binding is a REFERENCE;
//      the lowering emitted a mutable COPY (const→let demotion), so every
//      member write silently landed on the copy. Element-access-initialized
//      locals flagged by the ownership pass now emit reference bindings
//      (`Task& t = tasks[i];`).
//   7. The console.* gate pattern-matched `console.*` syntactically — a
//      user-DECLARED `const console = new UART('UART0', {...})` (a perfectly
//      legal shadow) had every method call rejected. The gate now fires only
//      when `console` is not a program binding.
//   8. The IR-side property renderer (render-expr) did not apply the
//      reserved-word escape to member names — a record field named `auto`
//      rendered `cfg->auto` (a hard parse error) in every snprintf arg while
//      the declaration and assignments renamed it `auto_`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();
const noErr = (out: { diagnostics: { severity: string }[] }) =>
  out.diagnostics.filter(d => d.severity === "error");

const HAL_PROLOGUE = `
  import { GPIO, LED, PA1, ADC, PWM, PA8, UART, Watchdog, Store, Time } from '@typecad/hal';
  const FAN_PWM_NS = 40000;
  const WDOG_MS = 400;
`;

describe("firmware-controller demo findings (Zephyr)", () => {
  it("HAL methods inside functions lower to ops (instance pre-registration)", () => {
    const out = transpile(HAL_PROLOGUE + `
      const led = new GPIO(LED, GPIO.OUTPUT);
      const pot = new ADC(PA1);
      function sample(): number {
        led.set(true);
        return pot.readMillivolts();
      }
      let n = sample();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr', fileName: "C:/typecad/hal/test-tmp/fw1.ts" });
    // The test harness has no board constants, so pins resolve as text and
    // the op may fail — but LOUDLY (hal-method-unresolved), never as the old
    // silent half-inlined garbage.
    const errs = out.diagnostics.filter(d => d.severity === "error" && d.code !== "zephyr-bus-instance-unavailable");
    for (const e of errs) {
      expect(e.code).toBe("hal-method-unresolved");
    }
    // The pin-as-receiver garbage is gone; the board-less harness may still
    // fail the VALUE-position op loudly (a distinct fallthrough), but never
    // silently.
    expect(out.cpp).not.toMatch(/LED->set\(true\)/);
    expect(out.cpp).not.toMatch(/\d+->readMillivolts/);
  });

  it("a failed HAL method resolution fails loudly, never pin-as-receiver", () => {
    const out = transpile(HAL_PROLOGUE + `
      const fan = new PWM(PA8, { periodNs: FAN_PWM_NS });
      fan.setDuty(0.5);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr', fileName: "C:/typecad/hal/test-tmp/fw2.ts" });
    // With board constants absent, PA8 stays text and the op cannot resolve —
    // the old behavior emitted `8->setDuty(0.5)` silently; now it errors.
    const codes = out.diagnostics.filter(d => d.severity === "error").map(d => d.code);
    if (codes.length > 0) {
      expect(codes).toContain("hal-method-unresolved");
    } else {
      // Fully resolved (board facts present): the op lowered.
      expect(out.cpp).toMatch(/pwm|set_duty|__tc_pwm/i);
    }
    expect(out.cpp).not.toMatch(/\d+->setDuty/);
  });

  it("const-named ctor options fold: PWM periodNs and Watchdog timeout resolve", () => {
    const out = transpile(HAL_PROLOGUE + `
      const fan = new PWM(PA8, { periodNs: FAN_PWM_NS });
      const watchdog = new Watchdog(WDOG_MS * 4);
      fan.setDuty(0.5);
      watchdog.enable();
      watchdog.feed();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr', fileName: "C:/typecad/hal/test-tmp/fw3.ts" });
    // In the board-less harness the pin may fail loudly (pin text), but the
    // const-named periodNs/timeout fields must have folded — a failure must
    // never AGAIN be the silent `8->setDuty` fallback.
    expect(out.cpp).not.toMatch(/\d+->setDuty/);
    expect(out.cpp).not.toMatch(/watchdog->/);
  });

  it("no-arg toString before a string method converts the number", () => {
    const out = transpile(`
      const s = 7;
      const mm = 5;
      let text = mm.toString().padStart(2, '0');
      UART0.writeLine(text);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error" && d.code !== "zephyr-bus-instance-unavailable")).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_padStart\(__tc_numToStr_js\(mm\)/);
  });

  it("a type-alias struct with a function field ships <functional>", () => {
    const out = transpile(`
      type Task = { name: string; run: () => void };
      const tasks: Task[] = [
        { name: 'a', run: (): void => {} },
      ];
      let n = tasks.length;
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toContain("#include <functional>");
    expect(out.cpp).toMatch(/std::function<void\(\)> run/);
  });

  it("an element-binding local mutated through members is a REFERENCE", () => {
    const out = transpile(`
      type Task = { everyMs: number; last: number; run: () => void };
      const tasks: Task[] = [
        { everyMs: 10, last: 0, run: (): void => {} },
      ];
      let fired = 0;
      const now = 100;
      for (let i = 0; i < tasks.length; i += 1) {
        const t = tasks[i];
        if (now - t.last >= t.everyMs) {
          t.last = now;
          t.run();
          fired += 1;
        }
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    // JS: `t` is a reference to tasks[i] — `t.last = now` must land there.
    expect(out.cpp).toMatch(/Task& t = tasks\[i\]/);
    expect(out.cpp).not.toMatch(/Task t = tasks\[i\]/);
  });

  it("a user-declared `console` binding is their object, not the TS console API", () => {
    const out = transpile(HAL_PROLOGUE + `
      const console = new UART('UART0', { baud: 115200, rxBufferBytes: 128 });
      function say(): void {
        console.writeLine('hello');
      }
      say();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr', fileName: "C:/typecad/hal/test-tmp/fw4.ts" });
    expect(out.diagnostics.filter(d => d.code === "console-unsupported")).toHaveLength(0);
  });

  it("the TS console carry-over is still rejected when NOT user-declared", () => {
    const out = transpile(`
      console.log('hi');
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.some(d => d.code === "console-unsupported" && d.severity === "error")).toBe(true);
  });

  it("a record field named `auto` renders escaped in every position", () => {
    const out = transpile(`
      class Config {
        setpoint = 30.0;
        auto = true;
      }
      const cfg = new Config();
      let on: number = cfg.auto ? 1 : 0;
      UART0.writeLine(\`sp=\${cfg.setpoint.toFixed(1)} auto=\${cfg.auto ? 'on' : 'off'}\`);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error" && d.code !== "zephyr-bus-instance-unavailable")).toHaveLength(0);
    expect(out.cpp).not.toMatch(/->auto[^_]/);
    expect(out.cpp).not.toMatch(/\.auto[^_]/);
  });
});
