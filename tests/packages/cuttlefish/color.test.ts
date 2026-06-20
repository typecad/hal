import { describe, it, expect } from "vitest";
import { parseHexColor, toRGB565, toMono, resolveColor } from "@typecad/cuttlefish/ui/color";

describe("color resolution", () => {
  it("parses #rrggbb to {r,g,b} bytes", () => {
    expect(parseHexColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexColor("#008000")).toEqual({ r: 0, g: 128, b: 0 });
  });

  it("converts rgb to rgb565", () => {
    expect(toRGB565(255, 0, 0)).toBe(0xf800);   // red
    expect(toRGB565(0, 255, 0)).toBe(0x07e0);   // green
    expect(toRGB565(0, 0, 255)).toBe(0x001f);   // blue
    expect(toRGB565(255, 255, 255)).toBe(0xffff);
  });

  it("converts rgb to mono (luminance threshold)", () => {
    expect(toMono(0, 0, 0)).toBe(0);
    expect(toMono(255, 255, 255)).toBe(1);
    expect(toMono(64, 64, 64)).toBe(0);         // below threshold
    expect(toMono(200, 200, 200)).toBe(1);      // above threshold
  });

  it("resolveColor picks format based on target", () => {
    expect(resolveColor("#ff0000", "rgb565")).toBe(0xf800);
    expect(resolveColor("#ff0000", "mono")).toBe(1);
  });

  it("throws on invalid hex", () => {
    expect(() => parseHexColor("red")).toThrow();
    expect(() => parseHexColor("#12345")).toThrow();
  });
});
