// ---------------------------------------------------------------------------
// Zephyr shim regressions — the usage-gating vs emitted-code bug class.
//
// A1: the async runtime polyfill references millis() (defined later in
//     shimLines) — the polyfill must forward-declare it so an async program
//     with no user-source timing call still compiles.
// A2: the UI runtime header polls digitalRead() unconditionally, and the
//     wiring_compat macro routes it to __tc_gpio_read — the definition must
//     be emitted unconditionally (not gated on @typecad/safety) with the
//     `int` signature the forward declaration announces.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

describe("ZephyrStrategy async runtime shim wiring", () => {
  const s = new ZephyrStrategy();

  it("forward-declares millis() in the async_runtime polyfill", () => {
    const program = { functions: [{ isAsync: true }] } as any;
    const irs = s.generateNativePolyfills(program, undefined);
    const asyncIr = irs.find((p) => p.id === "async_runtime");
    expect(asyncIr).toBeDefined();
    // Polyfill definitions emit before shimLines, where millis() is defined —
    // without this declaration the timer bodies fail to compile.
    expect(asyncIr!.forwardDeclarations).toContain("unsigned long millis();");
  });

  it("defines __tc_gpio_read unconditionally with the int signature", () => {
    // No @typecad/safety usage here — the UI runtime's digitalRead poll must
    // still link.
    const program = { functions: [], topLevelStatements: [], classes: [] } as any;
    const lines = s.shimLines(program, undefined);
    const def = lines.find((l) => l.includes("__tc_gpio_read(") && l.includes("inline"));
    expect(def).toBeDefined();
    // `int` matches wiring_compat's forward declaration — a uint32_t
    // definition left the declared int overload undefined at link time.
    expect(def).toContain("inline int __tc_gpio_read(int pin)");
    // The controller dispatcher must accompany it.
    expect(lines.some((l) => l.includes("__tc_gpio_dev"))).toBe(true);
  });

  it("still emits __tc_gpio_write / __tc_delay_us only under @typecad/safety", () => {
    const plain = { functions: [], topLevelStatements: [], classes: [] } as any;
    const without = s.shimLines(plain, undefined);
    expect(without.some((l) => l.includes("__tc_gpio_write"))).toBe(false);
    expect(without.some((l) => l.includes("__tc_delay_us"))).toBe(false);
  });
});
