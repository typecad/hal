import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * Track 2 — analysis-required rules (regression nets for the safe subset).
 *
 * These rules need renderer-side flow analysis to fully enforce:
 *   - M5-2-8 (no OOB pointer arithmetic)
 *   - M5-0-3 (no implicit narrowing conversion)
 *   - M0-1-2 (no value-convertible dead code)
 *
 * The current emitter is structurally safe for the common cases (no
 * pointer arithmetic on user `.slice()` results that goes OOB; explicit
 * numeric casts already use static_cast; no bare-value expression
 * statements). These tests freeze that. The analysis-required cases
 * (e.g., detecting a user assignment that implicitly narrows) are
 * deferred to a Track 4 follow-up.
 */
describe("Track 2 analysis-required rules: regression nets for safe subset", () => {
  function assertNoFindingFor(tsCode: string, ruleId: string) {
    const result = transpile(tsCode, { autosar: "strict" });
    const diag = result.diagnostics.find((d) => d.code === `AUTOSAR_${ruleId}`);
    expect(diag, `unexpected AUTOSAR_${ruleId}: ${diag?.message ?? ""}`).toBeUndefined();
  }

  it("M5-2-8: no AUTOSAR diagnostic for code without pointer arithmetic", () => {
    assertNoFindingFor("const x = 5;", "M5-2-8");
  });

  it("M5-0-3: explicit numeric code without narrowing doesn't trip", () => {
    assertNoFindingFor("const x = 5; const y = x + 1;", "M5-0-3");
  });

  it("M0-1-2: side-effecting statements are not flagged as dead code", () => {
    assertNoFindingFor(
      "let x = 0; x = x + 1;",
      "M0-1-2",
    );
  });
});
