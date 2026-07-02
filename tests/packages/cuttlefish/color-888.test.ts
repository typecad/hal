import { describe, it, expect } from "vitest";
import {
  resolveColorInternal,
  resolveColor888,
  rgb888To666,
  rgb888To565,
} from "../../../packages/cuttlefish/src/ui/color";

describe("rgb888 color format", () => {
  it("resolveColorInternal returns true 888 for rgb888 (red)", () => {
    expect(resolveColorInternal("red", "rgb888")).toBe(0xff0000);
  });
  it("resolveColorInternal returns true 888 for rgb888 (named blue)", () => {
    expect(resolveColorInternal("blue", "rgb888")).toBe(0x0000ff);
  });
  it("rgb888 and rgb666 resolve to the same internal 888 value", () => {
    // rgb666 stores full 888 internally (quantization happens at push boundary)
    expect(resolveColorInternal("#3a8ee0", "rgb888")).toBe(
      resolveColorInternal("#3a8ee0", "rgb666"),
    );
  });
  it("quantizers are unchanged by rgb888 addition (canonical primaries)", () => {
    // RGB565 canonical primary values — well-documented, unambiguous.
    expect(rgb888To565(resolveColor888("red"))).toBe(0xf800);
    expect(rgb888To565(resolveColor888("lime"))).toBe(0x07e0);
    expect(rgb888To565(resolveColor888("blue"))).toBe(0x001f);
    // RGB666: 6 bits/channel packed into 18 bits. (r&0xfc)<<10 lands the top
    // 6 red bits at bit 12 (the &0xfc clears the low 2 so they don't bleed).
    expect(rgb888To666(0xff0000)).toBe(0x3f000); // red 6 bits @ bits 12-17
    expect(rgb888To666(0x00ff00)).toBe(0x00fc0); // green 6 bits @ bits 6-11
    expect(rgb888To666(0x0000ff)).toBe(0x00003f); // blue 6 bits @ bits 0-5
  });
});
