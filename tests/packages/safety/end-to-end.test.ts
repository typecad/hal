// End-to-end: a sketch importing `safe` from @typecad/safety transpiles to C++
// that contains __tc_safety_read_safe, __tc_safety_record_pin_mode, and the
// SafeReadResult struct. Uses the higher-level transpileArduino() helper
// (tests/setup.ts) which mirrors transpileFile's pipeline including the
// Phase D safety transform — synthesizing setup()/loop() so the safe.* call
// sites are actually reachable in the emitted output.

import { describe, expect, it } from "vitest";
import { transpileArduino } from "../../setup";

describe("safe.read end-to-end", () => {
  it("emits __tc_safety_read_safe and record_pin_mode into the .ino", () => {
    const { cpp } = transpileArduino(`
      import { safe } from "@typecad/safety";
      function setup(): void {
        safe.pinMode(5, INPUT);
      }
      function loop(): void {
        const r = safe.read(5);
        if (r.ok) { digitalWrite(13, r.value); }
      }
    `);

    // The 2-of-3 voter call site lowers to a __tc_safety_read_safe expression.
    expect(cpp).toContain("__tc_safety_read_safe(5)");
    // The auto-intercepted companion after safe.pinMode (and the explicit call
    // inside safe.pin_mode's resolution).
    expect(cpp).toContain("__tc_safety_record_pin_mode(5, 0)");
    // The runtime structs the voter returns.
    expect(cpp).toContain("struct SafeReadResult");
    expect(cpp).toContain("enum class SafetyFaultCategory");
    // The voter calls digitalRead (proving MCU-agnostic Arduino-symbol reuse).
    expect(cpp).toContain("digitalRead(pin)");
  });
});
