import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import type { ResolvedDisplay } from "@typecad/cuttlefish/stores/display-profile-store";

describe("eink-mono (SSD1680-class) adapter", () => {
  const profile = {
    driver: "ssd1680", width: 296, height: 128, rotation: 0,
    colorFormat: "mono", displayClass: "eink",
    _mountCs: 5, _mountDc: 21, _mountRst: 22, _mountBus: "SPI",
  } as ResolvedDisplay;

  it("is registered for driver 'ssd1680'", () => {
    expect(() => generateDisplayAdapter(profile)).not.toThrow();
  });

  it("emits a partial-refresh entry point", () => {
    const gen = generateDisplayAdapter(profile);
    expect(gen.functions).toMatch(/display_partial_refresh\(/);
  });

  it("init does NOT call fillScreen (no flash on e-ink)", () => {
    const gen = generateDisplayAdapter(profile);
    // The display_fillScreen helper may exist (the runtime's gated clear calls
    // it, suppressed on deferred refresh), but display_init itself must not
    // clear — a full clear flashes on e-ink.
    const initMatch = gen.functions.match(/static inline void display_init\(\) \{[\s\S]*?\n\}/);
    expect(initMatch).toBeTruthy();
    expect(initMatch![0]).not.toMatch(/fillScreen/);
  });

  it("targets an e-ink library (EPD/EPaper/GxEPD)", () => {
    const gen = generateDisplayAdapter(profile);
    expect(gen.includes).toMatch(/EPD|EPaper|epaper|GxEPD/i);
  });
});
