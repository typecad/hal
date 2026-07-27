import { describe, it, expect } from "vitest";
import { DeviationLedger } from "../../../../packages/cuttlefish/src/emit/compliance/deviation-ledger";

describe("DeviationLedger", () => {
  it("records a single-line deviation", () => {
    const ledger = new DeviationLedger();
    ledger.record({
      ruleId: "M3-2-1",
      file: "source",
      line: 42,
      snippet: "Adafruit_ST7796S __tc_display(...);",
      justification: "Adafruit HAL requires a static-storage global instance.",
    });
    expect(ledger.all()).toHaveLength(1);
    expect(ledger.all()[0].endLine).toBe(42);
    expect(ledger.all()[0].reviewStatus).toBe("auto-generated");
  });

  it("opens and closes a deviation region, recording the line range", () => {
    const ledger = new DeviationLedger();
    ledger.openRegion({
      ruleId: "M15-1-3",
      file: "source",
      line: 10,
      snippet: "try {",
      justification: "TS exception lowering requires try/catch.",
    });
    ledger.closeRegion(14);
    expect(ledger.all()).toHaveLength(1);
    expect(ledger.all()[0]).toMatchObject({ line: 10, endLine: 14 });
  });

  it("dedupes identical (ruleId, file, line) entries", () => {
    const ledger = new DeviationLedger();
    const entry = {
      ruleId: "M3-2-1",
      file: "source" as const,
      line: 42,
      snippet: "x;",
      justification: "same",
    };
    ledger.record(entry);
    ledger.record(entry);
    expect(ledger.all()).toHaveLength(1);
  });

  it("keeps distinct ruleIds on the same line as separate entries", () => {
    const ledger = new DeviationLedger();
    ledger.record({ ruleId: "M3-2-1", file: "source", line: 42, snippet: "x;", justification: "a" });
    ledger.record({ ruleId: "A18-5-8", file: "source", line: 42, snippet: "x;", justification: "b" });
    expect(ledger.all()).toHaveLength(2);
  });

  it("throws if closeRegion is called without an open region", () => {
    const ledger = new DeviationLedger();
    expect(() => ledger.closeRegion(5)).toThrow(/no open deviation region/i);
  });

  it("throws if closeRegion is called with endLine before the open region's start line", () => {
    const ledger = new DeviationLedger();
    ledger.openRegion({
      ruleId: "M15-1-3",
      file: "source",
      line: 10,
      snippet: "try {",
      justification: "x",
    });
    expect(() => ledger.closeRegion(5)).toThrow(/before the region start line/i);
  });

  it("hasEntry returns true for any line within a region's range", () => {
    const ledger = new DeviationLedger();
    ledger.openRegion({
      ruleId: "M15-1-3",
      file: "source",
      line: 10,
      snippet: "try {",
      justification: "x",
    });
    ledger.closeRegion(14);
    expect(ledger.hasEntry("source", 10, "M15-1-3")).toBe(true);
    expect(ledger.hasEntry("source", 12, "M15-1-3")).toBe(true);
    expect(ledger.hasEntry("source", 14, "M15-1-3")).toBe(true);
    expect(ledger.hasEntry("source", 15, "M15-1-3")).toBe(false);
  });
});
