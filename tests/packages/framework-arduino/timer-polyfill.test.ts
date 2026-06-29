import { describe, expect, it } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";

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
});
