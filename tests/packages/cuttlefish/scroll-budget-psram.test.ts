import { describe, it, expect } from "vitest";
import { resolveScrollConfig, DEFAULT_SCROLL_CANVAS_BUDGET_BYTES } from "../../../packages/cuttlefish/src/api/shared/display-profile";

describe("resolveScrollConfig: PSRAM-aware canvas budget", () => {
  it("uses the small no-PSRAM default when buildTarget has no PSRAM option", () => {
    const s = resolveScrollConfig({ touch: false }, { buildTarget: "esp32:esp32:esp32s3" });
    expect(s.scrollCanvasBudgetBytes).toBe(DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
  });

  it("raises the budget when the buildTarget opts into OPI PSRAM", () => {
    const s = resolveScrollConfig({ touch: false }, { buildTarget: "esp32:esp32:esp32s3:PSRAM=opi" });
    expect(s.scrollCanvasBudgetBytes).toBeGreaterThan(DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
  });

  it("raises the budget when the buildTarget opts into QSPI/IO PSRAM", () => {
    const s = resolveScrollConfig({ touch: false }, { buildTarget: "esp32:esp32:esp32s3:PSRAM=io" });
    expect(s.scrollCanvasBudgetBytes).toBeGreaterThan(DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
  });

  it("an explicit scrollCanvasBudgetBytes override always wins", () => {
    const s = resolveScrollConfig(
      { touch: false, scroll: { scrollCanvasBudgetBytes: 12345 } },
      { buildTarget: "esp32:esp32:esp32s3:PSRAM=opi" },
    );
    expect(s.scrollCanvasBudgetBytes).toBe(12345);
  });
});
