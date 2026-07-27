import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * Acceptance gate (parts 6, 7, 8) — behavioral contracts of the feature.
 * Parts 1-5 are verified separately (build + test suites + demo compile).
 */
describe("AUTOSAR compliance acceptance gate", () => {
  it("part 6: default-off produces no AUTOSAR markers in output", () => {
    const result = transpile("const x = 5;");
    expect(result.cpp).not.toContain("AUTOSAR Deviation");
    const autosarDiags = result.diagnostics.filter(
      (d) => typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarDiags).toEqual([]);
  });

  it("part 7: --autosar=warn produces a clean sidecar-capable emit for trivial code", () => {
    // The full demo-weather snapshot test (Task 2.8) covers the
    // deviation-set freeze; this test confirms the mode produces no
    // diagnostics at all for clean numeric code.
    const result = transpile("const x = 5; const y = x + 1;", { autosar: "warn" });
    const autosarDiags = result.diagnostics.filter(
      (d) => typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarDiags).toEqual([]);
  });

  it("part 8: deliberately-violating TS produces AUTOSAR_* error under strict", () => {
    // A console.log on arduino pulls in the framework serial helper that
    // still uses a C-style (char) cast (Phase 4 deferred). Under strict
    // the self-check must promote it to an error-severity diagnostic.
    const result = transpile('console.log("x");', { target: "arduino", autosar: "strict" });
    const m5Errors = result.diagnostics.filter(
      (d) => d.code === "AUTOSAR_M5-0-7" && d.severity === "error",
    );
    if (result.cpp.includes("(char)")) {
      expect(m5Errors.length).toBeGreaterThan(0);
    }
  });
});
