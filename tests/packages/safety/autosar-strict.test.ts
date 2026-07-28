// Acceptance gate: a sketch using safe.read/safe.pinMode transpiles under
// --autosar=strict (per AGENTS.md) with zero errors. The mode table is
// zero-initialized namespace-scope static storage (TrackedMode::Unknown = 0U),
// satisfying M3-2-1 (const-init) and M3-2-4 (trivial static init); no
// knownPatterns deviation is expected. If a rule fires anyway, this test
// surfaces it as a failure so the executor can decide whether to add a
// knownPatterns entry.

import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

describe("--autosar=strict acceptance for safety polyfills", () => {
  it("a safe.* sketch transpiles with --autosar=strict and zero errors", () => {
    // transpileArduino surfaces strict-mode errors as test diagnostics in the
    // returned `diagnostics` array; the call throws on internal errors but
    // returns strict findings as diagnostics.
    const { cpp, diagnostics } = transpileArduino(
      `
      import { safe } from "@typecad/safety";
      function setup(): void { safe.pinMode(5, INPUT); }
      function loop(): void { const r = safe.read(5); if (r.ok) digitalWrite(13, r.value); }
    `,
      { autosar: "strict" },
    );

    // Strict-mode errors must be zero (warnings/deviations are acceptable;
    // errors would abort the build). AUTOSAR_* codes are the compliance
    // diagnostics — separate them from any unrelated warnings.
    const autosarErrors = (diagnostics ?? []).filter(
      (d) => d.severity === "error" && typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarErrors, "AUTOSAR strict errors:\n" +
      autosarErrors.map((d) => `  [${d.code}] ${d.message}`).join("\n"),
    ).toEqual([]);

    // Sanity: the polyfills + call sites survived.
    expect(cpp).toContain("__tc_safety_read_safe(5)");
    expect(cpp).toContain("struct SafeReadResult");
    expect(cpp).toContain("TrackedMode g_pin_mode_table");
  });
});
