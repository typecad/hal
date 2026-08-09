import { describe, it, expect } from "vitest";
import { resolveDisplayProfile } from "../../../packages/cuttlefish/src/api/shared/display-profile";
import type { DisplayProfile } from "../../../packages/cuttlefish/src/api/shared/display-profile";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src";

// Regression: profile resolution must consult the strategy's getProfileRegistry
// hook so framework-specific profile names resolve correctly. Before this fix,
// transpile.ts hardcoded an Arduino-only import path, the Zephyr registry was
// always empty, and an unknown profile was silently swallowed — producing a
// misleading "Unsupported display driver ili9341" error downstream.
describe("Zephyr display profile resolution via getProfileRegistry", () => {
  const zephyr = new ZephyrStrategy();
  const registry = zephyr.getProfileRegistry()!;

  it("the strategy provides a profile registry", () => {
    expect(registry).toBeInstanceOf(Map);
    expect(registry.size).toBeGreaterThan(0);
  });

  it("the registry contains st7796-zephyr (the demo-st profile)", () => {
    expect(registry.has("st7796-zephyr")).toBe(true);
    const p = registry.get("st7796-zephyr") as DisplayProfile;
    expect(p.driver).toBe("st7796-zephyr");
    expect(p.width).toBe(480);
    expect(p.height).toBe(320);
    expect(p.colorFormat).toBe("rgb565");
  });

  it("resolveDisplayProfile resolves st7796-zephyr to the correct driver", () => {
    const resolved = resolveDisplayProfile(
      { profile: "st7796-zephyr" },
      registry,
    );
    expect(resolved.profile.driver).toBe("st7796-zephyr");
    expect(resolved.profile.width).toBe(480);
    expect(resolved.profile.height).toBe(320);
  });

  it("preserves explicit scanline synchronization opt-in through profile resolution", () => {
    const resolved = resolveDisplayProfile(
      {
        profile: "st7796-zephyr",
        scanlineSync: true,
        spiPins: { mosi: 11, sck: 12, miso: 13 },
      },
      registry,
    );
    expect(resolved.profile.scanlineSync).toBe(true);
    expect(resolved.profile.spiPins?.miso).toBe(13);
  });

  it("resolveDisplayProfile THROWS on an unknown profile (not silently swallowed)", () => {
    // This is the critical regression: before the fix, the bare catch {} in
    // transpile.ts swallowed this error and fell back to the default driver,
    // producing a misleading "Unsupported display driver ili9341" error.
    expect(() =>
      resolveDisplayProfile({ profile: "nonexistent-profile" }, registry),
    ).toThrow(/Unknown display profile/);
  });

  it("the registry contains ili9341-zephyr", () => {
    expect(registry.has("ili9341-zephyr")).toBe(true);
  });
});
