import { describe, it, expect } from "vitest";
// Runtime import forces the module to actually resolve (a pure `import type`
// is erased at runtime and would pass even with the file missing).
// The named exports below are typed via the type-only imports that follow.
import * as complianceTypes from "../../../../packages/cuttlefish/src/emit/compliance/types";
import type {
  ComplianceMode,
  RuleSeverity,
  RuleCategory,
  DeviationKind,
  RuleEntry,
  Deviation,
  SelfCheckFinding,
} from "../../../../packages/cuttlefish/src/emit/compliance/types";

describe("compliance types", () => {
  it("module resolves at runtime", () => {
    expect(complianceTypes).toBeDefined();
  });

  it("ComplianceMode has the three documented modes", () => {
    const modes: ComplianceMode[] = ["off", "warn", "strict"];
    expect(modes).toEqual(["off", "warn", "strict"]);
  });

  it("RuleSeverity discriminates required vs advisory", () => {
    const s: RuleSeverity = "required";
    expect(s).toBe("required");
  });

  it("a Deviation carries the source-traceability field", () => {
    const d: Deviation = {
      ruleId: "M3-2-1",
      file: "source",
      line: 42,
      endLine: 42,
      snippet: "Adafruit_ST7796S __tc_display(...);",
      justification: "Adafruit HAL requires a static-storage global instance.",
      reviewStatus: "auto-generated",
      source: { tsFile: "src/hardware/display.ts", tsLine: 12, kind: "hal-instance" },
    };
    expect(d.ruleId).toBe("M3-2-1");
  });

  it("RuleCategory is C or D", () => {
    const c: RuleCategory = "C";
    const d: RuleCategory = "D";
    expect([c, d]).toEqual(["C", "D"]);
  });

  it("SelfCheckFinding distinguishes the two finding kinds", () => {
    const f1: SelfCheckFinding = {
      ruleId: "M5-0-7",
      severity: "required",
      line: 1,
      file: "source",
      snippet: "(int)x",
      kind: "unrecorded-violation",
    };
    const f2: SelfCheckFinding = {
      ruleId: "M5-0-7",
      severity: "required",
      line: 1,
      file: "source",
      snippet: "(int)x",
      kind: "orphan-deviation",
    };
    expect(f1.kind).not.toBe(f2.kind);
  });
});
