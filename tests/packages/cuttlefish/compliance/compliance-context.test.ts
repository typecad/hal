import { describe, it, expect } from "vitest";
import { ComplianceContext } from "../../../../packages/cuttlefish/src/emit/compliance/compliance-context";

describe("ComplianceContext", () => {
  it("is inert when mode is 'off' (no deviation recorded)", () => {
    const ctx = new ComplianceContext("off");
    const out = ctx.emitWithDeviation("Adafruit_ST7796S __tc_display(...);", "M3-2-1", "because HAL");
    expect(out).toBe("Adafruit_ST7796S __tc_display(...);");
    expect(ctx.ledger().all()).toHaveLength(0);
  });

  it("appends an inline deviation comment and records to the ledger in warn/strict", () => {
    const ctx = new ComplianceContext("strict");
    const out = ctx.emitWithDeviation("foo();", "M3-2-1", "because HAL");
    expect(out).toBe("foo();  // AUTOSAR Deviation M3-2-1: because HAL");
    expect(ctx.ledger().all()).toHaveLength(1);
    expect(ctx.ledger().all()[0].ruleId).toBe("M3-2-1");
  });

  it("stacks multiple rule ids on one line", () => {
    const ctx = new ComplianceContext("strict");
    const out = ctx.emitWithDeviation("foo();", ["M3-2-1", "A18-5-8"], "Adafruit HAL global");
    expect(out).toBe("foo();  // AUTOSAR Deviation M3-2-1, A18-5-8: Adafruit HAL global");
    expect(ctx.ledger().all()).toHaveLength(2);
  });

  it("isBanned returns true only for rules in category C", () => {
    const ctx = new ComplianceContext("strict");
    expect(ctx.isBanned("M5-0-7")).toBe(true);   // C rule
    expect(ctx.isBanned("M3-2-1")).toBe(false);  // D rule — deviation is the path, not a ban
  });

  it("isBanned is inert when mode is 'off'", () => {
    const ctx = new ComplianceContext("off");
    expect(ctx.isBanned("M5-0-7")).toBe(false);
  });

  it("openDeviationRegion / closeDeviationRegion delegate to the ledger", () => {
    const ctx = new ComplianceContext("strict");
    const comment = ctx.openDeviationRegion("M15-1-3", "try/catch from TS lowering", 10, "try {");
    expect(comment).toBe("try {  // AUTOSAR Deviation M15-1-3: try/catch from TS lowering");
    ctx.closeDeviationRegion(14);
    expect(ctx.ledger().all()).toHaveLength(1);
    expect(ctx.ledger().all()[0]).toMatchObject({ line: 10, endLine: 14 });
  });

  it("throws when emitWithDeviation references an unknown rule id", () => {
    const ctx = new ComplianceContext("strict");
    expect(() => ctx.emitWithDeviation("x;", "DOES-NOT-EXIST", "reason")).toThrow(/unknown autosar rule/i);
  });

  it("isEnabled() reports the mode correctly", () => {
    expect(new ComplianceContext("off").isEnabled()).toBe(false);
    expect(new ComplianceContext("warn").isEnabled()).toBe(true);
    expect(new ComplianceContext("strict").isEnabled()).toBe(true);
  });

  it("records the source-traceability field when provided", () => {
    const ctx = new ComplianceContext("strict");
    ctx.emitWithDeviation(
      "Adafruit_ST7796S __tc_display(...);",
      "M3-2-1",
      "Adafruit HAL global.",
      42,
      "source",
      { tsFile: "src/hardware/display.ts", tsLine: 12, kind: "hal-instance" },
    );
    expect(ctx.ledger().all()[0].source).toMatchObject({
      tsFile: "src/hardware/display.ts",
      tsLine: 12,
      kind: "hal-instance",
    });
  });
});
