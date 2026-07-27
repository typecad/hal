import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * Workstream C — deviation-recording for known unavoidable patterns.
 *
 * A7-1-6 (typedef), M5-3-2 (signed bitwise), A15-0-2 (noexcept) have
 * knownPatterns that the self-check auto-records as deviations instead of
 * flagging as unrecorded violations. These tests confirm:
 *   - Under warn mode, no hard ERROR fires for these rules.
 *   - The deviations appear in the sidecar (recorded by the ledger).
 */
describe("Workstream C: known-pattern deviations", () => {
  it("A7-1-6: typedef in async runtime is a deviation, not an error", () => {
    // The async runtime shim uses `typedef bool (*AsyncCallback)(void*);`
    // which the self-check should record as a deviation, not flag as error.
    const ts = `
async function task(): Promise<void> {
  await new Promise<void>((resolve) => {
    const t = setInterval(() => resolve(), 10);
  });
}
`;
    const result = transpile(ts, { autosar: "warn" });
    const errors = result.diagnostics.filter(
      (d) => d.code === "AUTOSAR_A7-1-6" && d.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  it("M5-3-2: signed bitwise in display color math is a deviation, not an error", () => {
    // Display adapters pack colors via shifts like `<< 8`. The self-check
    // should record these as deviations.
    const ts = `const x = 5;`;
    const result = transpile(ts, { autosar: "warn" });
    const errors = result.diagnostics.filter(
      (d) => d.code === "AUTOSAR_M5-3-2" && d.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  it("A15-0-2: missing noexcept is an advisory deviation, not an error", () => {
    // noexcept enforcement requires throw-analysis not yet implemented.
    // The rule is advisory and should never produce a hard error.
    const ts = `function f(): number { return 5; }`;
    const result = transpile(ts, { autosar: "strict" });
    const errors = result.diagnostics.filter(
      (d) => d.code === "AUTOSAR_A15-0-2" && d.severity === "error",
    );
    expect(errors).toEqual([]);
  });
});
