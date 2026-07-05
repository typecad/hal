import { describe, expect, it } from "vitest";
import {
  resolveScrollConfig,
  type ScrollConfig,
  type TouchProfile,
} from "../../../packages/cuttlefish/src/api/shared/display-profile";

describe("resolveScrollConfig", () => {
  it("derives default scroll config from a resistive touch profile", () => {
    const cfg = resolveScrollConfig({
      touch: { library: "XPT2046_Touchscreen", cs: 15, irq: 17 } as TouchProfile,
    });
    expect(cfg.inputTier).toBe("resistive");
    expect(cfg.renderTier).toBe("full"); // ESP32-class assumed full by default
    expect(cfg.dragScale).toBe(1);
    expect(cfg.maxOverscroll).toBe(40);
    expect(cfg.stiffness).toBe(0.5);
    expect(cfg.edgeSnapPx).toBe(12);
    expect(cfg.inputSmoothing).toBe(0.3);
    expect(cfg.overrideProbes).toBe(true);
  });

  it("derives capacitive input tier when a non-resistive library is declared", () => {
    const cfg = resolveScrollConfig({
      touch: { library: "Adafruit_STMPE610" } as TouchProfile,
    });
    expect(cfg.inputTier).toBe("capacitive");
    expect(cfg.inputSmoothing).toBe(0.3); // default still populated
  });

  it("derives 'none' input tier when touch is disabled", () => {
    expect(resolveScrollConfig({ touch: false }).inputTier).toBe("none");
  });

  it("derives 'none' input tier when there is no touch profile", () => {
    expect(resolveScrollConfig({}).inputTier).toBe("none");
  });

  it("lets an explicit scroll override win over the derived tier", () => {
    const overridden = resolveScrollConfig({
      touch: { library: "XPT2046_Touchscreen" } as TouchProfile,
      scroll: { inputTier: "capacitive", renderTier: "constrained" },
    });
    expect(overridden.inputTier).toBe("capacitive");
    expect(overridden.renderTier).toBe("constrained");
  });

  it("lets explicit overrides win on individual tunables", () => {
    const cfg = resolveScrollConfig({
      scroll: {
        maxOverscroll: 60,
        stiffness: 0.9,
        edgeSnapPx: 20,
        dragScale: 1.5,
        inputSmoothing: 0.1,
        overrideProbes: false,
      } as ScrollConfig,
    });
    expect(cfg.maxOverscroll).toBe(60);
    expect(cfg.stiffness).toBe(0.9);
    expect(cfg.edgeSnapPx).toBe(20);
    expect(cfg.dragScale).toBe(1.5);
    expect(cfg.inputSmoothing).toBe(0.1);
    expect(cfg.overrideProbes).toBe(false);
  });

  it("resists Adafruit_TouchScreen as resistive (4-wire analog)", () => {
    expect(
      resolveScrollConfig({ touch: { library: "Adafruit_TouchScreen" } as TouchProfile }).inputTier,
    ).toBe("resistive");
  });

  it("defaults scrollCanvasBudgetBytes to 88000 and accepts overrides", () => {
    expect(resolveScrollConfig({}).scrollCanvasBudgetBytes).toBe(88000);
    expect(
      resolveScrollConfig({ scroll: { scrollCanvasBudgetBytes: 120000 } }).scrollCanvasBudgetBytes,
    ).toBe(120000);
  });
});
