import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

describe("EmitterContext.compliance threading", () => {
  it("threads a no-op ComplianceContext by default (autosar=off)", () => {
    // Default transpile() with no autosar option. Output must be unchanged:
    // no deviation comments, no sidecar written.
    const result = transpile("const x = 5;");
    expect(result.cpp).not.toContain("AUTOSAR Deviation");
    // cuttlefish promotes const + infers int; just confirm the var landed.
    expect(result.cpp).toMatch(/\bx\s*=\s*5/);
  });

  it("does not produce AUTOSAR diagnostics when autosar is off (default)", () => {
    const result = transpile("const x = 5;");
    const autosarDiags = result.diagnostics.filter((d) =>
      typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarDiags).toEqual([]);
  });
});
