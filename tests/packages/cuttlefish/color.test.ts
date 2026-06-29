import { describe, it, expect } from "vitest";
import { parseColor, toRGB565, toMono, resolveColor } from "@typecad/cuttlefish/ui/color";

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
});
