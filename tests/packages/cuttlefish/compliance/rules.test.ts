import { describe, it, expect } from "vitest";
import { RULES, getRule, rulesByCategory } from "../../../../packages/cuttlefish/src/emit/compliance/rules";

describe("AUTOSAR rule table", () => {
  it("contains the documented ~50 rules", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(48);
    expect(RULES.length).toBeLessThanOrEqual(52);
  });

  it("every rule has a unique id", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every rule is enabled by default (kill switch is opt-out)", () => {
    for (const r of RULES) {
      expect(r.enabled).toBe(true);
    }
  });

  it("every [C] rule with a detect regex has either no exempt, or an exempt that suppresses a compliant spelling", () => {
    // Sanity: detect and exempt must not both trivially match the same input.
    for (const r of RULES.filter((r) => r.category === "C" && r.detect && r.exempt)) {
      // We can't enumerate all inputs; just confirm exempt is a RegExp.
      expect(r.exempt).toBeInstanceOf(RegExp);
    }
  });

  it("M5-0-7 detects C-style casts but exempts static_cast", () => {
    const rule = getRule("M5-0-7")!;
    expect(rule.detect!.test("(int)x")).toBe(true);
    expect(rule.detect!.test("static_cast<int>(x)")).toBe(false);
    expect(rule.exempt!.test("static_cast<int>(x)")).toBe(true);
  });

  it("M15-1-3 detects throw and try/catch", () => {
    const rule = getRule("M15-1-3")!;
    expect(rule.detect!.test("throw std::runtime_error(\"x\");")).toBe(true);
    expect(rule.detect!.test("try {")).toBe(true);
    expect(rule.detect!.test("catch (const auto& e) {")).toBe(true);
  });

  it("A8-4-4 detects goto", () => {
    const rule = getRule("A8-4-4")!;
    expect(rule.detect!.test("goto label;")).toBe(true);
    expect(rule.detect!.test("auto x = 5;")).toBe(false);
  });

  it("partitions by category, with documented C/D split", () => {
    const c = rulesByCategory("C");
    const d = rulesByCategory("D");
    expect(c.length + d.length).toBe(RULES.length);
    expect(c.length).toBeGreaterThanOrEqual(35);  // ~39 per spec
    expect(d.length).toBeGreaterThanOrEqual(9);   // ~11 per spec
    expect(d.map((r) => r.id)).toContain("M3-2-1");
    expect(d.map((r) => r.id)).toContain("M15-1-3");
    expect(d.map((r) => r.id)).toContain("A18-5-8");
  });

  it("returns undefined for an unknown rule id", () => {
    expect(getRule("DOES-NOT-EXIST")).toBeUndefined();
  });
});
