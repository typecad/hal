import { describe, it, expect } from "vitest";
import { parseColor, toRGB565, toMono, resolveColor, rgb888To565, rgb888To666, rgb888ToMono, pack888, unpack888 } from "@typecad/cuttlefish/ui/color";

describe("color formats", () => {
  it("parses #rrggbb hex", () => {
    expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("#008000")).toEqual({ r: 0, g: 128, b: 0 });
  });

  it("parses #rgb short hex", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("parses #rrggbbaa (alpha ignored)", () => {
    expect(parseColor("#ff0000ff")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("#00ff0080")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("parses rgb(r, g, b)", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("rgb(0, 128, 255)")).toEqual({ r: 0, g: 128, b: 255 });
  });

  it("parses rgba(r, g, b, a) — alpha ignored", () => {
    expect(parseColor("rgba(255, 0, 0, 0.5)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("rgba(0, 255, 0, 1.0)")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("parses named colors", () => {
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor("dodgerblue")).toEqual({ r: 30, g: 144, b: 255 });
    expect(parseColor("REBECCAPURPLE")).toEqual({ r: 102, g: 51, b: 153 });
  });

  it("converts to rgb565", () => {
    expect(toRGB565(255, 0, 0)).toBe(0xf800);
    expect(toRGB565(0, 255, 0)).toBe(0x07e0);
    expect(toRGB565(0, 0, 255)).toBe(0x001f);
    expect(toRGB565(255, 255, 255)).toBe(0xffff);
  });

  it("converts to mono", () => {
    expect(toMono(0, 0, 0)).toBe(0);
    expect(toMono(255, 255, 255)).toBe(1);
  });

  it("resolveColor works with all formats", () => {
    expect(resolveColor("#ff0000", "rgb565")).toBe(0xf800);
    expect(resolveColor("red", "rgb565")).toBe(0xf800);
    expect(resolveColor("rgb(255,0,0)", "rgb565")).toBe(0xf800);
    expect(resolveColor("#f00", "rgb565")).toBe(0xf800);
    expect(resolveColor("rgba(255,0,0,0.5)", "rgb565")).toBe(0xf800);
  });

  it("throws on unsupported format", () => {
    expect(() => parseColor("hsl(0, 100%, 50%)")).not.toThrow();
    expect(() => parseColor("not-a-color")).toThrow(/Unsupported color format/);
  });

  it("parses hsl/hsla colors (comma, space, and slash-alpha syntaxes)", () => {
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("hsl(240 100% 50%)")).toEqual({ r: 0, g: 0, b: 255 });
    expect(parseColor("hsl(120, 100%, 25%)")).toEqual({ r: 0, g: 128, b: 0 });
    // slash-alpha: alpha ignored, color still resolves
    expect(parseColor("hsla(0 0% 0% / 0.05)")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("converts rgb888 to rgb565", () => {
    expect(rgb888To565(0xff0000)).toBe(0xf800);
    expect(rgb888To565(0x00ff00)).toBe(0x07e0);
    expect(rgb888To565(0x0000ff)).toBe(0x001f);
    expect(rgb888To565(0xffffff)).toBe(0xffff);
    expect(rgb888To565(0x000000)).toBe(0x0000);
  });

  it("rgb888To565 matches toRGB565 channel math", () => {
    // 0x1a73e8 = Google blue; verify against direct channel truncation
    expect(rgb888To565(0x1a73e8))
      .toBe(toRGB565((0x1a73e8 >> 16) & 0xff, (0x1a73e8 >> 8) & 0xff, 0x1a73e8 & 0xff));
  });

  it("converts rgb888 to rgb666 (6 bits per channel)", () => {
    expect(rgb888To666(0xffffff)).toBe(0x3ffff);
    expect(rgb888To666(0x000000)).toBe(0x00000);
    expect(rgb888To666(0xff0000)).toBe(0x3f000);
    expect(rgb888To666(0x00ff00)).toBe(0x00fc0);
    expect(rgb888To666(0x0000ff)).toBe(0x0003f);
  });

  it("converts rgb888 to mono via luminance threshold", () => {
    expect(rgb888ToMono(0x000000)).toBe(0);
    expect(rgb888ToMono(0xffffff)).toBe(1);
    expect(rgb888ToMono(0x404040)).toBe(0);
    expect(rgb888ToMono(0xdddddd)).toBe(1);
  });

  it("rgb888ToMono matches toMono for equivalent RGB", () => {
    for (const c of [0x000000, 0xffffff, 0x808080, 0x1a73e8, 0xff0000]) {
      expect(rgb888ToMono(c))
        .toBe(toMono((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff));
    }
  });

  it("packs/unpacks rgb888", () => {
    expect(pack888(255, 0, 0)).toBe(0xff0000);
    expect(pack888(0, 255, 0)).toBe(0x00ff00);
    expect(pack888(0, 0, 255)).toBe(0x0000ff);
    expect(unpack888(0x1a73e8)).toEqual({ r: 0x1a, g: 0x73, b: 0xe8 });
    expect(unpack888(pack888(100, 150, 200))).toEqual({ r: 100, g: 150, b: 200 });
  });
});
