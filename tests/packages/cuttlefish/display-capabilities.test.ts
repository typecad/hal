import { describe, it, expect } from "vitest";
import {
  defaultTftCapabilities,
  deriveCapabilities,
} from "../../../packages/cuttlefish/src/api/shared/display-capabilities";

describe("DisplayCapabilities", () => {
  it("defaultTftCapabilities returns the values TFT uses today", () => {
    const caps = defaultTftCapabilities();
    expect(caps.nativeFormat).toBe("rgb565");
    expect(caps.refreshModel).toBe("immediate");
    expect(caps.partialRefresh).toBe("full");
    expect(caps.requiresBackingStore).toBe(false);
    expect(caps.features).toEqual({
      antialias: true,
      gradients: true,
      opacityBlend: true,
      smoothScroll: true,
      animation: true,
    });
  });

  it("deriveCapabilities defaults a bare TFT profile to TFT capabilities", () => {
    const caps = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb565" });
    expect(caps).toEqual(defaultTftCapabilities());
  });

  it("deriveCapabilities reads explicit displayClass: 'eink'", () => {
    const caps = deriveCapabilities({ width: 296, height: 128, colorFormat: "mono", displayClass: "eink" });
    expect(caps.refreshModel).toBe("deferred-partial");
    expect(caps.requiresBackingStore).toBe(true);
    expect(caps.features.antialias).toBe(false);
    expect(caps.features.gradients).toBe(false);
    expect(caps.features.smoothScroll).toBe(false);
    expect(caps.features.animation).toBe(false);
  });

  it("explicit capabilities on the profile override derivation", () => {
    const base = defaultTftCapabilities();
    const caps = deriveCapabilities({
      width: 320, height: 240, colorFormat: "rgb565",
      capabilities: { ...base, features: { ...base.features, animation: false } },
    });
    expect(caps.features.animation).toBe(false);
    expect(caps.features.antialias).toBe(true); // untouched
  });

  it("eink displayClass disables antialias via deriveCapabilities", () => {
    const eink = deriveCapabilities({ width: 296, height: 128, colorFormat: "mono", displayClass: "eink" });
    expect(eink.features.antialias).toBe(false);
    const tft = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb565" });
    expect(tft.features.antialias).toBe(true);
  });
});
