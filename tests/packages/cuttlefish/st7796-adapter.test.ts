import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import type { ResolvedDisplay } from "../../../packages/cuttlefish/src/ui/display-profile-store";

describe("ST7796S adapter", () => {
  const base = {
    driver: "st7796",
    width: 320,
    height: 480,
    rotation: 1,
    spiFrequency: 40000000,
    _mountCs: 5,
    _mountDc: 21,
    _mountRst: 22,
    _mountBus: "SPI",
  };
  const profile565 = { ...base, colorFormat: "rgb565" as const } as ResolvedDisplay;
  const profile666 = { ...base, colorFormat: "rgb666" as const } as ResolvedDisplay;

  it("is registered for driver 'st7796' (does not throw)", () => {
    expect(() => generateDisplayAdapter(profile565)).not.toThrow();
  });

  it("565 mode emits a uint16_t writePixels push + Adafruit_ST7796 include", () => {
    const gen = generateDisplayAdapter(profile565);
    expect(gen.includes).toMatch(/Adafruit_ST7796/);
    expect(gen.functions).toMatch(/display_writePixels\(uint16_t\* pixels/);
  });

  it("666 mode emits an 888 push path (3 bytes/pixel packing)", () => {
    const gen = generateDisplayAdapter(profile666);
    expect(gen.functions).toMatch(/display_writePixels\(uint32_t\* pixels/);
    // Packs each 888 pixel to 18-bit (6-6-6) → 3 bytes.
    expect(gen.functions).toMatch(/0xfc/);
  });

  it("declares the Adafruit_ST7796 display object", () => {
    const gen = generateDisplayAdapter(profile565);
    expect(gen.declaration).toMatch(/Adafruit_ST7796 __tc_display/);
  });
});
