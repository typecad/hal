import { describe, expect, it } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { transpile } from "../../setup";

describe("Arduino timer polyfill", () => {
  it("uses the cooperative loop runtime on ESP32 instead of esp_timer callbacks", () => {
    const strategy = new ArduinoStrategy();
    const polyfills = strategy.generateNativePolyfills(
      { functions: [] } as any,
      { architecture: "esp32" } as any,
    );

    const timer = polyfills.find((p) => p.id === "timer_methods");
    expect(timer).toBeDefined();
    expect(timer?.requiredIncludes).not.toContain("esp_timer.h");

    const helpers = timer?.helperFunctions.join("\n") ?? "";
    expect(helpers).toContain("__tc_timer_runtime.add(cb, ms, true)");
    expect(helpers).toContain("__tc_timer_runtime.add(cb, ms, false)");
    expect(helpers).not.toContain("esp_timer_create");
    expect(helpers).not.toContain("esp_timer_start_once");
  });

  it("sizes MAX_TIMERS to the observed setInterval/setTimeout call count", () => {
    // A program with one timer should link one slot, not eight. The transpile
    // path threads ctx.analysis.timerCallCount; here we simulate that.
    const strategy = new ArduinoStrategy();
    const polyfills = strategy.generateNativePolyfills(
      { functions: [] } as any,
      { architecture: "esp32", analysis: { timerCallCount: 1 } } as any,
    );
    const structs = polyfills.find((p) => p.id === "timer_methods")?.helperStructs.join("\n") ?? "";
    expect(structs).toContain("static const int MAX_TIMERS = 1;");
    expect(structs).not.toContain("MAX_TIMERS = 8");
  });

  it("sizes MAX_TIMERS to N when N timer calls are observed", () => {
    const strategy = new ArduinoStrategy();
    const polyfills = strategy.generateNativePolyfills(
      { functions: [] } as any,
      { architecture: "esp32", analysis: { timerCallCount: 3 } } as any,
    );
    const structs = polyfills.find((p) => p.id === "timer_methods")?.helperStructs.join("\n") ?? "";
    expect(structs).toContain("static const int MAX_TIMERS = 3;");
  });

  it("defaults MAX_TIMERS to 1 when analysis is absent", () => {
    // Direct callers without analysis threading (e.g. unit tests) get a
    // well-formed single-slot runtime rather than the old blind 8.
    const strategy = new ArduinoStrategy();
    const polyfills = strategy.generateNativePolyfills(
      { functions: [] } as any,
      { architecture: "esp32" } as any,
    );
    const structs = polyfills.find((p) => p.id === "timer_methods")?.helperStructs.join("\n") ?? "";
    expect(structs).toContain("static const int MAX_TIMERS = 1;");
  });

  it("end-to-end: a single setInterval lowers to MAX_TIMERS = 1", () => {
    // Exercises the full transpile path: analysis counts the timer call and
    // threads it through ctx.analysis.timerCallCount into the strategy.
    const result = transpile(
      `function setup(): void { setInterval(() => {}, 1000); }
       function loop(): void {}`,
      { target: "arduino" },
    );
    expect(result.cpp).toContain("static const int MAX_TIMERS = 1;");
    expect(result.cpp).not.toContain("MAX_TIMERS = 8");
  });
});
