import { describe, it, expect } from "vitest";
import { resolveColor, resolveColor888, rgb888To666 } from "../../../packages/ui/src/ui-engine/color";

describe("resolveColor rgb666 path", () => {
  it("resolveColor(..., 'rgb666') quantizes 888 → 666", () => {
    expect(resolveColor("#ffffff", "rgb666")).toBe(0x3ffff);
    expect(resolveColor("#000000", "rgb666")).toBe(0x00000);
    expect(resolveColor("#ff0000", "rgb666")).toBe(0x3f000);
    expect(resolveColor("#00ff00", "rgb666")).toBe(0x00fc0);
    expect(resolveColor("#0000ff", "rgb666")).toBe(0x0003f);
  });

  it("resolveColor(..., 'rgb666') === rgb888To666(resolveColor888(...))", () => {
    expect(resolveColor("#1a73e8", "rgb666")).toBe(rgb888To666(resolveColor888("#1a73e8")));
  });

  it("565 path unchanged (byte-identity guard)", () => {
    expect(resolveColor("#ff0000", "rgb565")).toBe(0xf800);
    // Exact 565 value for #1a73e8 (verified: node -e).
    expect(resolveColor("#1a73e8", "rgb565")).toBe(0x1b9d);
  });

  it("mono path unchanged", () => {
    expect(resolveColor("#ffffff", "mono")).toBe(1);
    expect(resolveColor("#000000", "mono")).toBe(0);
  });
});
