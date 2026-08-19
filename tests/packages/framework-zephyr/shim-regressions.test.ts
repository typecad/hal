// ---------------------------------------------------------------------------
// Zephyr shim regressions — the usage-gating vs emitted-code bug class.
//
// A1: the async runtime polyfill references millis() (defined later in
//     shimLines) — the polyfill must forward-declare it so an async program
//     with no user-source timing call still compiles.
// A2: the GPIO read surface (__tc_gpio_read/__tc_gpio_dev + the wiring_compat
//     polyfill's digitalRead/HIGH/LOW macros) is gated on actual pin-read
//     usage: user digitalRead() calls, the @typecad/safety voter, or the UI
//     runtime header's digitalRead() poll. A write/toggle-only program must
//     not carry it.
// A3: every core shim piece (millis/map/constrain/nullish/__tc_print/DT
//     specs) is emitted only under its own usage signal — a minimal
//     delay-only program carries no shim block at all.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const s = new ZephyrStrategy();
const emptyProgram = { functions: [], topLevelStatements: [], classes: [] } as any;

// Analysis shaped like PlatformContext.analysis for a minimal blink program:
// GPIO output only, no clock reads, no console, no nullish, no helpers.
const noUses = {
  usesDigitalRead: false,
  usesGPIO: true,
  usesMap: false,
  usesConstrain: false,
  usesWallClock: false,
  hasAsync: false,
  timerCallCount: 0,
  usesNullish: false,
  usesNullishHelper: false,
  usesCstdio: false,
  usesFS: false,
  usesPreferences: false,
  usesUart: false,
  usedPolyfillHelpers: new Set<string>(),
};
const ctxOf = (analysis: Record<string, unknown>) => ({ analysis }) as any;

describe("ZephyrStrategy async runtime shim wiring", () => {
  it("forward-declares millis() in the async_runtime polyfill", () => {
    const program = { functions: [{ isAsync: true }] } as any;
    const irs = s.generateNativePolyfills(program, undefined);
    const asyncIr = irs.find((p) => p.id === "async_runtime");
    expect(asyncIr).toBeDefined();
    // Polyfill definitions emit before shimLines, where millis() is defined —
    // without this declaration the timer bodies fail to compile.
    expect(asyncIr!.forwardDeclarations).toContain("unsigned long millis();");
  });
});

describe("ZephyrStrategy GPIO read shim gating", () => {
  it("defaults to emitting without analysis (capability query)", () => {
    const lines = s.shimLines(emptyProgram, undefined);
    const def = lines.find((l) => l.includes("__tc_gpio_read(") && l.includes("inline"));
    expect(def).toBeDefined();
    // `int` matches wiring_compat's forward declaration — a uint32_t
    // definition left the declared int overload undefined at link time.
    expect(def).toContain("inline int __tc_gpio_read(int pin)");
    // The controller dispatcher must accompany it.
    expect(lines.some((l) => l.includes("__tc_gpio_dev"))).toBe(true);
  });

  it("omits __tc_gpio_read/__tc_gpio_dev when nothing reads a pin", () => {
    const lines = s.shimLines(emptyProgram, ctxOf(noUses));
    expect(lines.some((l) => l.includes("__tc_gpio_read"))).toBe(false);
    expect(lines.some((l) => l.includes("__tc_gpio_dev"))).toBe(false);
  });

  it("emits the int-signature definition + dispatcher under usesDigitalRead", () => {
    const lines = s.shimLines(emptyProgram, ctxOf({ ...noUses, usesDigitalRead: true }));
    const def = lines.find((l) => l.includes("__tc_gpio_read(") && l.includes("inline"));
    expect(def).toBeDefined();
    expect(def).toContain("inline int __tc_gpio_read(int pin)");
    expect(lines.some((l) => l.includes("__tc_gpio_dev"))).toBe(true);
  });

  it("emits the GPIO read surface + wiring_compat under @typecad/safety", () => {
    // The safety voter calls __tc_gpio_read directly via lowered raw text —
    // not visible as a usesDigitalRead flag, so the gate walks the IR for
    // safety.* hal-ops.
    const safetyProgram = {
      functions: [],
      classes: [],
      topLevelStatements: [
        { kind: "hal-op", operation: { operation: "safety.read_safe", pin: 5 } },
      ],
    } as any;
    const lines = s.shimLines(safetyProgram, ctxOf(noUses));
    expect(lines.some((l) => l.includes("inline int __tc_gpio_read(int pin)"))).toBe(true);
    expect(lines.some((l) => l.includes("__tc_gpio_dev"))).toBe(true);
    expect(
      s.generateNativePolyfills(safetyProgram, ctxOf(noUses)).some((p) => p.id === "wiring_compat"),
    ).toBe(true);
  });

  it("gates the wiring_compat polyfill on the same conditions", () => {
    expect(
      s.generateNativePolyfills(emptyProgram, ctxOf(noUses)).some((p) => p.id === "wiring_compat"),
    ).toBe(false);
    expect(
      s.generateNativePolyfills(emptyProgram, ctxOf({ ...noUses, usesDigitalRead: true }))
        .some((p) => p.id === "wiring_compat"),
    ).toBe(true);
    // No analysis (capability query) → still emitted.
    expect(
      s.generateNativePolyfills(emptyProgram, undefined).some((p) => p.id === "wiring_compat"),
    ).toBe(true);
  });

  it("still emits __tc_gpio_write / __tc_delay_us only under @typecad/safety", () => {
    const without = s.shimLines(emptyProgram, ctxOf(noUses));
    expect(without.some((l) => l.includes("__tc_gpio_write"))).toBe(false);
    expect(without.some((l) => l.includes("__tc_delay_us"))).toBe(false);
  });
});

describe("ZephyrStrategy core shim usage gating", () => {
  it("emits no shim block for a minimal delay-only program", () => {
    const lines = s.shimLines(emptyProgram, ctxOf(noUses));
    expect(lines.some((l) => l.includes("CUTTLEFISH_SHIM_DEFINED"))).toBe(false);
    expect(lines.some((l) => l.includes("millis()"))).toBe(false);
    expect(lines.some((l) => l.includes("inline long map("))).toBe(false);
    expect(lines.some((l) => l.includes("inline long constrain("))).toBe(false);
    expect(lines.some((l) => l.includes("__tc_print"))).toBe(false);
    expect(lines.some((l) => l.includes("cuttlefish_is_nullish"))).toBe(false);
    expect(lines.some((l) => l.includes("CUTTLEFISH_UNDEFINED"))).toBe(false);
    // The main() bridge stays — it is the Zephyr entrypoint, not dead code.
    expect(lines.some((l) => l.includes("int main(void)"))).toBe(true);
  });

  it("emits each core piece only under its own usage flag", () => {
    const withAll = s.shimLines(emptyProgram, ctxOf({
      ...noUses,
      usesMap: true,
      usesConstrain: true,
      usesWallClock: true,
      usesNullish: true,
      usesNullishHelper: true,
      usedPolyfillHelpers: new Set(["__tc_println"]),
    }));
    expect(withAll.some((l) => l.includes("inline long map("))).toBe(true);
    expect(withAll.some((l) => l.includes("inline long constrain("))).toBe(true);
    expect(withAll.some((l) => l.includes("millis() { return"))).toBe(true);
    expect(withAll.some((l) => l.includes("cuttlefish_nullish("))).toBe(true);
    expect(withAll.some((l) => l.includes("CUTTLEFISH_UNDEFINED"))).toBe(true);
    // The print helpers are one overload group — present together.
    expect(withAll.some((l) => l.includes("__tc_println(const char*"))).toBe(true);
    expect(withAll.some((l) => l.includes("__tc_print(const char*"))).toBe(true);
  });

  it("keeps millis() for hidden pollers even without usesWallClock", () => {
    // delay() sets usesMillis (AVR conflation) but NOT usesWallClock — the
    // async runtime / timer scheduler / UI tick still poll millis().
    expect(
      s.shimLines(emptyProgram, ctxOf({ ...noUses, hasAsync: true })).some((l) => l.includes("millis()")),
    ).toBe(true);
    expect(
      s.shimLines(emptyProgram, ctxOf({ ...noUses, timerCallCount: 2 })).some((l) => l.includes("millis()")),
    ).toBe(true);
  });

  it("keeps the CUTTLEFISH_UNDEFINED macro for null-literal-only files", () => {
    // usesNullish without usesNullishHelper: the file references null/
    // undefined literals but emits no cuttlefish_nullish() calls — it needs
    // the macro token, not the helper functions.
    const lines = s.shimLines(emptyProgram, ctxOf({ ...noUses, usesNullish: true }));
    expect(lines.some((l) => l.includes("CUTTLEFISH_UNDEFINED"))).toBe(true);
    expect(lines.some((l) => l.includes("cuttlefish_is_nullish"))).toBe(false);
  });
});

describe("ZephyrStrategy devicetree spec gating", () => {
  // Default chip (no buildTarget) is XIAO_BLE: led0=26, led1=30, led2=6.
  const ledOnly = {
    functions: [],
    classes: [],
    topLevelStatements: [
      { kind: "hal-op", operation: { operation: "gpio.set_mode", pin: 26, mode: "OUTPUT" } },
      { kind: "hal-op", operation: { operation: "gpio.toggle", pin: 26 } },
    ],
  } as any;

  it("emits DT specs only for pins the gpio ops address", () => {
    const lines = s.shimLines(ledOnly, ctxOf(noUses));
    expect(lines.some((l) => l.includes("__tc_dt_led0"))).toBe(true);
    expect(lines.some((l) => l.includes("__tc_dt_led1"))).toBe(false);
    expect(lines.some((l) => l.includes("__tc_dt_led2"))).toBe(false);
  });

  it("guards each spec per symbol so multi-header TUs both define theirs", () => {
    const lines = s.shimLines(ledOnly, ctxOf(noUses));
    expect(lines.some((l) => l.includes("#ifndef __TC_DT_LED0_SPEC"))).toBe(true);
  });

  it("emits all DT specs when no program is provided (capability query)", () => {
    const lines = s.shimLines(undefined, undefined);
    expect(lines.some((l) => l.includes("__tc_dt_led0"))).toBe(true);
    expect(lines.some((l) => l.includes("__tc_dt_led1"))).toBe(true);
    expect(lines.some((l) => l.includes("__tc_dt_led2"))).toBe(true);
  });

  it("emits a spec named verbatim in raw code even without a gpio op pin", () => {
    const rawRef = {
      functions: [],
      classes: [],
      topLevelStatements: [
        { kind: "expression", expression: { kind: "raw", value: "gpio_pin_set_dt(&__tc_dt_led1, 1);" } },
      ],
    } as any;
    const lines = s.shimLines(rawRef, ctxOf(noUses));
    expect(lines.some((l) => l.includes("__tc_dt_led1"))).toBe(true);
    expect(lines.some((l) => l.includes("__tc_dt_led0"))).toBe(false);
  });
});

describe("ZephyrStrategy <cstdio> gating", () => {
  it("omits <cstdio> when nothing printf-shaped is used", () => {
    const inc = s.forcedIncludes(emptyProgram, ctxOf(noUses));
    expect(inc).not.toContain("<cstdio>");
  });

  it("includes <cstdio> for the printf family", () => {
    for (const extra of [
      { usesCstdio: true },
      { usesFS: true },
      { usesPreferences: true },
      { usesUart: true },
      { usedPolyfillHelpers: new Set(["__tc_print"]) },
    ]) {
      const inc = s.forcedIncludes(emptyProgram, ctxOf({ ...noUses, ...extra }));
      expect(inc).toContain("<cstdio>");
    }
  });

  it("defaults to including <cstdio> without analysis (capability query)", () => {
    const inc = s.forcedIncludes(emptyProgram, undefined);
    expect(inc).toContain("<cstdio>");
  });
});
