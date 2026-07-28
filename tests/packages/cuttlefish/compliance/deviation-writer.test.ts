import { describe, it, expect } from "vitest";
import { renderRegistryJson } from "../../../../packages/cuttlefish/src/emit/compliance/deviation-writer";
import { ComplianceContext } from "../../../../packages/cuttlefish/src/emit/compliance/compliance-context";

describe("deviation-writer", () => {
  it("renders a valid registry JSON with schema metadata", () => {
    const ctx = new ComplianceContext("strict");
    ctx.emitWithDeviation(
      "Adafruit_ST7796S __tc_display(...);",
      "M3-2-1",
      "Adafruit HAL requires static storage.",
      42,
      "source",
      { tsFile: "src/hardware/display.ts", tsLine: 12, kind: "hal-instance" },
    );
    const json = JSON.parse(renderRegistryJson(ctx, "main.ino", "1.0.0-alpha.7"));
    expect(json.schemaVersion).toBe("1.0.0");
    expect(json.standard).toBe("AUTOSAR C++14");
    expect(json.tool).toBe("cuttlefish");
    expect(json.toolVersion).toBe("1.0.0-alpha.7");
    expect(json.emittedArtifact).toBe("main.ino");
    expect(json.summary.totalDeviations).toBe(1);
    expect(json.summary.byRule).toEqual({ "M3-2-1": 1 });
    expect(json.deviations[0]).toMatchObject({
      ruleId: "M3-2-1",
      line: 42,
      reviewStatus: "auto-generated",
    });
    expect(json.deviations[0].source).toMatchObject({
      tsFile: "src/hardware/display.ts",
      tsLine: 12,
      kind: "hal-instance",
    });
    expect(json.deviations[0].cpp).toMatchObject({
      file: "main.ino",
      line: 42,
    });
  });

  it("renders an empty registry when there are no deviations", () => {
    const ctx = new ComplianceContext("warn");
    const json = JSON.parse(renderRegistryJson(ctx, "main.cpp", "1.0.0"));
    expect(json.summary.totalDeviations).toBe(0);
    expect(json.deviations).toEqual([]);
  });

  it("ruleSubset lists every enabled rule id", () => {
    const ctx = new ComplianceContext("warn");
    const json = JSON.parse(renderRegistryJson(ctx, "main.cpp", "1.0.0"));
    expect(json.ruleSubset.length).toBeGreaterThan(40);
    expect(json.ruleSubset[0]).toMatchObject({
      id: expect.any(String),
      category: expect.any(String),
    });
  });

  it("generatedAt is a valid ISO 8601 string", () => {
    const ctx = new ComplianceContext("warn");
    const json = JSON.parse(renderRegistryJson(ctx, "main.cpp", "1.0.0"));
    expect(() => new Date(json.generatedAt).toISOString()).not.toThrow();
    // Sanity: it's recent (within the last minute).
    const ageMs = Date.now() - new Date(json.generatedAt).getTime();
    expect(ageMs).toBeLessThan(60_000);
  });
});
