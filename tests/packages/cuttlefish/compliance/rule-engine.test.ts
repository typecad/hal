import { describe, it, expect } from "vitest";
import { runSelfCheck } from "../../../../packages/cuttlefish/src/emit/compliance/rule-engine";
import { ComplianceContext } from "../../../../packages/cuttlefish/src/emit/compliance/compliance-context";

describe("rule-engine self-check", () => {
  it("flags an unrecorded C-style cast", () => {
    const ctx = new ComplianceContext("strict");
    const lines = ["int y = (int)x;"];
    const findings = runSelfCheck(ctx, lines, []);
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: "M5-0-7", kind: "unrecorded-violation", line: 1 }),
    );
  });

  it("does NOT flag a static_cast line", () => {
    const ctx = new ComplianceContext("strict");
    const lines = ["int y = static_cast<int>(x);"];
    const findings = runSelfCheck(ctx, lines, []);
    expect(findings.map((f) => f.ruleId)).not.toContain("M5-0-7");
  });

  it("suppresses a finding when the line has a matching deviation comment", () => {
    const ctx = new ComplianceContext("strict");
    const lines = ["int y = (int)x;  // AUTOSAR Deviation M5-0-7: legacy hal"];
    const findings = runSelfCheck(ctx, lines, []);
    expect(findings.map((f) => f.ruleId)).not.toContain("M5-0-7");
  });

  it("flags an orphan deviation: ledger entry with no inline comment at that line", () => {
    const ctx = new ComplianceContext("strict");
    // Record a deviation on line 1, but the emitted text doesn't carry the comment.
    ctx.emitWithDeviation("int y = (int)x;", "M5-0-7", "legacy", 1);
    const lines = ["int y = (int)x;"];  // no comment
    const findings = runSelfCheck(ctx, lines, []);
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: "M5-0-7", kind: "orphan-deviation", line: 1 }),
    );
  });

  it("is inert when mode is 'off'", () => {
    const ctx = new ComplianceContext("off");
    const lines = ["int y = (int)x;"];
    expect(runSelfCheck(ctx, lines, [])).toEqual([]);
  });

  it("flags goto as an unrecorded violation", () => {
    const ctx = new ComplianceContext("strict");
    const findings = runSelfCheck(ctx, ["loop: goto loop;"], []);
    expect(findings.map((f) => f.ruleId)).toContain("A8-4-4");
  });

  it("flags try/catch as M15-1-3", () => {
    const ctx = new ComplianceContext("strict");
    const lines = ["try {", "  foo();", "} catch (...) {", "}"];
    const findings = runSelfCheck(ctx, lines, []);
    expect(findings.map((f) => f.ruleId)).toContain("M15-1-3");
  });

  it("scans header lines too", () => {
    const ctx = new ComplianceContext("strict");
    const source = ["auto x = 5;"];
    const header = ["int y = (int)x;"];
    const findings = runSelfCheck(ctx, source, header);
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: "M5-0-7", file: "header", line: 1 }),
    );
  });
});
