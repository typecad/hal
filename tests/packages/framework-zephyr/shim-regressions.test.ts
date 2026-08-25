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
    // The shim no longer defines main() — the synthesizer emits main()
    // directly (entrypointFunctionName()="main") and a second definition in
    // the shim would collide at link time.
    expect(lines.some((l) => l.includes("int main(void)"))).toBe(false);
    expect(lines.some((l) => l.includes("extern void setup"))).toBe(false);
    expect(lines.some((l) => l.includes("extern void loop"))).toBe(false);
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

  it("formats protocol numbers via integer conversions, never %g", () => {
    // The 0.17.5 SDK swapped newlib for picolibc, whose default build
    // silently prints NOTHING for %g (newlib-nano's -u _printf_float trap).
    // Every [TC:EXPECT:...:value:] arrived empty and all tests failed with
    // "*float*" actuals. The numeric helpers must format with %lld only.
    const lines = s.shimLines(emptyProgram, ctxOf({
      ...noUses,
      usedPolyfillHelpers: new Set(["__tc_print", "__tc_println"]),
    }));
    const joined = lines.join("\n");
    expect(joined).toContain("__tc_fmt_num");
    expect(joined).toContain('printf("%lld", ip)');
    expect(joined).toContain('snprintf(fbuf, sizeof(fbuf), "%06lld", fr)');
    // No float conversion specifier anywhere in the numeric helpers.
    expect(joined.includes("%g")).toBe(false);
    expect(joined.includes("%f")).toBe(false);
    expect(joined.includes("%e")).toBe(false);
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

// ---------------------------------------------------------------------------
// Black Pill HAL-suite regressions — the wiring-ambient / bus-index / hidden
// millis-consumer bug class found running packages/hal's hardware tests on
// the STM32F411 (commit "test(hal): HAL hardware suite on the Black Pill").
// ---------------------------------------------------------------------------

describe("ZephyrStrategy bus-state + wiring-ambient regressions", () => {
  it("emits bus state for digitless aliases (Wire/SPI/Serial → controller 0)", () => {
    // collectUsedBusIndices used to skip ids without a trailing digit, so a
    // begin()-only program on a board aliased I2C0→Wire got NO state block
    // and every __tc_i2c0_* reference dangled.
    const program = {
      functions: [],
      topLevelStatements: [
        { kind: "hal-op", operation: { operation: "i2c.begin", bus: "Wire" } },
        { kind: "hal-op", operation: { operation: "spi.begin", bus: "SPI" } },
        { kind: "hal-op", operation: { operation: "uart.begin", port: "Serial" } },
      ],
      classes: [],
    } as any;
    const lines = s.shimLines(program, ctxOf({ ...noUses, usesI2C: true, usesSPI: true, usesUart: true })).join("\n");
    expect(lines).toContain("__tc_i2c0_dev");
    expect(lines).toContain("__tc_spi0_dev");
    expect(lines).toContain("__tc_uart0_dev");
  });

  it("emits pinMode/digitalWrite shims + the gpio dispatcher when the program calls them", () => {
    const program = {
      functions: [],
      topLevelStatements: [
        { kind: "call", callee: "pinMode", args: [] },
        { kind: "call", callee: "digitalWrite", args: [] },
      ],
      classes: [],
    } as any;
    const lines = s.shimLines(program, ctxOf(noUses)).join("\n");
    expect(lines).toContain("static inline void pinMode(");
    expect(lines).toContain("static inline void digitalWrite(");
    expect(lines).toContain("__tc_gpio_dev(");
    // The dispatcher must precede the shims that call it (single push order).
    expect(lines.indexOf("__tc_gpio_dev(uint32_t pin)")).toBeLessThan(lines.indexOf("static inline void pinMode("));
  });

  it("detects free functions passed through __EMIT__ strings (pulseIn et al.)", () => {
    // The hal resolver's legacy free-function path lowers bare pulseIn() to
    // an __EMIT__ string — detection that only walked call nodes missed it.
    const program = {
      functions: [],
      topLevelStatements: [
        { kind: "call", callee: "__EMIT__", args: [{ kind: "string", value: "pulseIn(7, 1, 100);" }] },
      ],
      classes: [],
    } as any;
    const lines = s.shimLines(program, ctxOf(noUses)).join("\n");
    expect(lines).toContain("static inline uint32_t pulseIn(");
    expect(lines).toContain("__tc_gpio_dev(");
  });

  it("keeps millis() when the injected async runtime is its only consumer", () => {
    // Async.sleep lowers to a raw hal-op the timing scanners can't see —
    // usesWallClock/hasAsync stay false. The runtime's pump polls millis()
    // regardless; the shim must survive (link error otherwise).
    const program = {
      functions: [],
      topLevelStatements: [
        { kind: "raw", value: "__cuttlefish_async_sleep(10);" },
      ],
      classes: [],
    } as any;
    const lines = s.shimLines(program, ctxOf(noUses)).join("\n");
    expect(lines).toContain("inline unsigned long millis()");
  });

  it("shims random/randomSeed over the PRNG helpers, seeded before use", () => {
    const program = {
      functions: [],
      topLevelStatements: [
        { kind: "call", callee: "randomSeed", args: [] },
        { kind: "call", callee: "random", args: [] },
      ],
      classes: [],
    } as any;
    const lines = s.shimLines(program, ctxOf(noUses)).join("\n");
    expect(lines).toContain("static inline void randomSeed(");
    expect(lines).toContain("static inline long random(");
    // The __tc_rand_* helpers the shims call must be defined BEFORE them.
    expect(lines.indexOf("__tc_rand_next(void)")).toBeLessThan(lines.indexOf("static inline long random("));
  });
});
