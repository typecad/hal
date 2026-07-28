// End-to-end (v2): a sketch using the idiomatic HAL Pin flow + safe.read
// transpiles to C++ containing __tc_safety_read_safe, the auto-intercepted
// __tc_safety_record_pin_mode (from Pin.asInput's gpio.set_mode), the
// SafeReadResult struct, and the strategy-injected __tc_gpio_read shim.

import { describe, expect, it } from "vitest";
import { transpileArduino } from "../../setup";

describe("safe.read end-to-end (v2 — HAL Pin flow)", () => {
  it("emits __tc_safety_read_safe, record_pin_mode, and __tc_gpio_read shim", () => {
    const { cpp } = transpileArduino(`
      import { Pin } from "@typecad/hal";
      import { safe, SAFETY_STATUS_OK } from "@typecad/safety";

      const btn = Pin.fromPort("PD2").asInput();

      function setup(): void {}
      function loop(): void {
        const r = safe.read(btn);
        if (r.status === SAFETY_STATUS_OK) { /* use r.value */ }
      }
    `);

    // The 2-of-3 voter call site (safe.read lowered via halInstances-resolved pin).
    expect(cpp).toContain("__tc_safety_read_safe(");
    // The auto-intercepted companion from Pin.asInput()'s gpio.set_mode op.
    expect(cpp).toContain("__tc_safety_record_pin_mode(");
    // The runtime structs the voter returns.
    expect(cpp).toContain("struct SafeReadResult");
    expect(cpp).toContain("enum class SafetyFaultCategory");
    // The strategy-injected shim definition.
    expect(cpp).toContain("inline int __tc_gpio_read");
    // The voter calls __tc_gpio_read (NOT digitalRead directly).
    expect(cpp).toContain("__tc_gpio_read(pin)");
  });
});
