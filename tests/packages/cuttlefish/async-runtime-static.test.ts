import { describe, it, expect } from "vitest";
import { generateStaticAsyncRuntime } from "../../../packages/cuttlefish/src/api/shared/async-runtime-static";

describe("generateStaticAsyncRuntime — waitForPinEdge modes", () => {
  it("'polling' (default) emits the Arduino-symbol busy-wait body", () => {
    const rt = generateStaticAsyncRuntime(8);
    // The polling body references Arduino core symbols.
    expect(rt).toContain("__cuttlefish_wait_pin_edge");
    expect(rt).toContain("digitalRead");
    expect(rt).toContain("delay(1)");
    expect(rt).toContain("(mode == RISING)");
  });

  it("'polling' does NOT emit the guarded RISING/FALLING defines (Arduino core has them)", () => {
    const rt = generateStaticAsyncRuntime(8, "polling");
    expect(rt).not.toContain("#define RISING");
    expect(rt).not.toContain("#define FALLING");
  });

  it("'stub' emits an empty body with NO Arduino symbols (digitalRead/delay/millis)", () => {
    // Zephyr sets waitForPinEdge='stub'. The stub must not reference Arduino
    // core symbols that don't exist on Zephyr, or compilation fails with
    // "'RISING'/'digitalRead'/'delay' was not declared in this scope".
    const rt = generateStaticAsyncRuntime(8, "stub");
    expect(rt).toContain("__cuttlefish_wait_pin_edge");
    expect(rt).not.toContain("digitalRead");
    expect(rt).not.toContain("delay(1)");
    // The body is empty (resolves immediately).
    expect(rt).toMatch(/__cuttlefish_wait_pin_edge\([^)]*\)\s*\{\s*\}/);
  });

  it("'stub' defines RISING/FALLING guarded so the call site compiles", () => {
    // gpio.waitForRising() lowers to `__cuttlefish_wait_pin_edge(pin, RISING, t)`.
    // On targets that don't define RISING/FALLING (Zephyr), the call site itself
    // would fail to compile — so the stub must provide guarded defines.
    const rt = generateStaticAsyncRuntime(8, "stub");
    expect(rt).toContain("#ifndef RISING");
    expect(rt).toContain("#define RISING 1");
    expect(rt).toContain("#ifndef FALLING");
    expect(rt).toContain("#define FALLING 2");
  });

  it("'interrupt' omits the function (the strategy/ISR layer provides it)", () => {
    const rt = generateStaticAsyncRuntime(8, "interrupt");
    expect(rt).not.toMatch(/inline void __cuttlefish_wait_pin_edge/);
    expect(rt).not.toContain("digitalRead");
    expect(rt).not.toContain("#define RISING");
  });

  it("always emits the core runtime regardless of mode", () => {
    // The pin-edge mode must not affect the timer/task slot machinery.
    for (const mode of ["polling", "stub", "interrupt"] as const) {
      const rt = generateStaticAsyncRuntime(8, mode);
      expect(rt).toContain("typecad_async_static");
      expect(rt).toContain("cuttlefish_pump_microtasks");
    }
  });
});
