// Pair kerning baked from the font (opentype.js ^2: GPOS lookups first, the
// legacy `kern` table as fallback — opentype.js never falls back itself).
// The pairs must flow consistently through all four consumers: the baked
// asset, layout measurement (assetTextWidth), the emitted C++ face table,
// and the preview's draw/width mirror.
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCss, parseFontFaces } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { BlockLayoutEngine } from "@typecad/ui/ui-engine/block-layout";
import { measure } from "@typecad/ui/ui-engine/layout-engine";
import { buildUIFontAssets, assetTextWidth, kernPairValue } from "@typecad/ui/ui-engine/font-assets";
import { lowerUIToCpp } from "@typecad/ui/ui-engine/ui-lowering";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(HERE, "../../../packages/ui/assets/fonts/dejavu");

const CSS = `
  @font-face { font-family: "KernTest"; src: url("DejaVuSans.ttf"); font-weight: 400; }
  #t { font-family: "KernTest"; font-size: 10px; }
`;

function build(text: string) {
  const rules = parseCss(CSS);
  const html = `<screen><text id="t">${text}</text></screen>`;
  const [root] = parseHtmlWithKeyboards(html).screens.map((s: never) => resolveStyles(s, rules));
  return buildUIFontAssets(root, parseFontFaces(CSS), FONTS)[0]!;
}

afterEach(() => resetDisplayProfile());

describe("baked pair kerning", () => {
  it("extracts kern pairs for the subset (DejaVu legacy kern table)", () => {
    const asset = build("AV To Warehouse");
    expect(asset.kern, "kern pairs present").toBeDefined();
    expect(asset.kern!.length).toBeGreaterThan(0);
    // Sorted by (l, r) for the runtime's binary search.
    for (let i = 1; i < asset.kern!.length; i++) {
      const a = asset.kern![i - 1]!;
      const b = asset.kern![i]!;
      expect(a.l < b.l || (a.l === b.l && a.r < b.r), `pair ${i} sorted`).toBe(true);
    }
    // A|V is a classic negative pair at 10px (-131 units ≈ -0.64px → -1px).
    const iA = asset.glyphs.findIndex((g) => g.codepoint === "A".codePointAt(0));
    const iV = asset.glyphs.findIndex((g) => g.codepoint === "V".codePointAt(0));
    expect(kernPairValue(asset, iA, iV)).toBeLessThanOrEqual(-1);
  });

  it("measures kerned width in layout (assetTextWidth matches advances + kern)", () => {
    const asset = build("AVATAR");
    const style = { fontFamily: "KernTest", fontSize: "10px" } as never;
    const raw = [..."AVATAR"].reduce(
      (w, ch) => w + (asset.glyphs.find((g) => g.codepoint === ch.codePointAt(0))?.advance ?? 0),
      0,
    );
    const kerned = assetTextWidth("AVATAR", style, [asset])!;
    expect(kerned).toBeLessThan(raw);
    expect(kerned).toBeGreaterThan(raw - 6 * 2); // each pair kerns at most a couple px
  });

  it("emits the kern table in the generated face (ui-lowering shape)", () => {
    const rules = parseCss(CSS);
    const html = `<screen><text id="t">AV To</text></screen>`;
    const [root] = parseHtmlWithKeyboards(html).screens.map((s: never) => resolveStyles(s, rules));
    const boxes = new BlockLayoutEngine().arrange(root as never, { x: 0, y: 0, w: 240, h: 320 }, measure);
    const lowered = lowerUIToCpp(root as never, boxes, "rgb565", "flash", [], rules, undefined, [build("AV To")]);
    const code = typeof lowered === "string" ? lowered : (lowered.code ?? JSON.stringify(lowered));
    expect(code).toContain("UIFontKern __ui_font_1_kern[]");
    expect(code).toMatch(/__ui_font_1_glyphs, __ui_font_1_alpha, __ui_font_1_kern, \d+/);
  });

  it("bakes kern pairs on mono targets too (same pipeline)", () => {
    setDisplayProfile(
      { driver: "solomon,ssd1306", width: 128, height: 64, colorFormat: "mono", rotation: 0 } as never,
      {},
    );
    const asset = build("AV To");
    expect(asset.format).toBe("mono1");
    expect(asset.kern!.length).toBeGreaterThan(0);
  });
});
