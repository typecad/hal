// Acceptance gate (v2): a HAL Pin flow sketch with safe.read transpiles
// under --autosar=strict with zero AUTOSAR errors.

import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

describe("--autosar=strict acceptance for safety polyfills (v2)", () => {
  it("a HAL Pin + safe.read sketch transpiles with --autosar=strict and zero errors", () => {
    const { cpp, diagnostics } = transpileArduino(
      `
      import { Pin } from "@typecad/hal";
      import { safe } from "@typecad/safety";

      const btn = Pin.fromPort("PD2").asInput();

      function setup(): void {}
      function loop(): void {
        const r = safe.read(btn);
        if (r.ok) { /* use r.value */ }
      }
    `,
      { autosar: "strict" },
    );

    const autosarErrors = (diagnostics ?? []).filter(
      (d) => d.severity === "error" && typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarErrors, "AUTOSAR strict errors:\n" +
      autosarErrors.map((d) => `  [${d.code}] ${d.message}`).join("\n"),
    ).toEqual([]);

    expect(cpp).toContain("__tc_safety_read_safe(");
    expect(cpp).toContain("struct SafeReadResult");
  });
});
