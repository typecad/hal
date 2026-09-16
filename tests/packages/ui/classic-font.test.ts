// Built-in Classic bitmap family: `font-family: "Classic"` (no @font-face)
// bakes from the shared glcdfont 5x7 table — native pixels at 8px, and the
// Technoblogy diagonal-corner smoothing at 2x ("Smooth Big Text",
// David Johnson-Davies: bridge the two sub-pixels at every one-row diagonal
// step's inner corner so doubled staircases read as connected 45° runs).
import { describe, it, expect, afterEach } from "vitest";
import { parseCss } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { buildUIFontAssets } from "@typecad/ui/ui-engine/font-assets";
import type { UIFontAssetModel } from "@typecad/ui/ui-engine/font-assets";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import { GLCDFONT_BYTES } from "@typecad/cuttlefish/api/shared";

function bakeClassic(chars: string, px: number, mono = true): UIFontAssetModel {
  const css = `#t { font-family: "Classic"; font-size: ${px}px; }`;
  const html = `<screen><text id="t">${chars}</text></screen>`;
  const rules = parseCss(css);
  const [root] = parseHtmlWithKeyboards(html).screens.map((s: never) => resolveStyles(s, rules));
  if (mono) {
    setDisplayProfile(
      { driver: "solomon,ssd1306", width: 128, height: 64, colorFormat: "mono", rotation: 0 } as never,
      {},
    );
  }
  try {
    const asset = buildUIFontAssets(root, [], ".")[0]!;
    expect(asset, `asset for ${chars}@${px}`).toBeDefined();
    return asset;
  } finally {
    resetDisplayProfile();
  }
}

function glyphBits(asset: UIFontAssetModel, codepoint: number): { rows: number[][]; w: number; h: number } {
  const glyph = asset.glyphs.find((g) => g.codepoint === codepoint)!;
  expect(glyph, `glyph ${String.fromCodePoint(codepoint)}`).toBeDefined();
  const rows: number[][] = [];
  for (let y = 0; y < glyph.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < glyph.width; x++) {
      const bit = glyph.dataOffset + y * glyph.width + x;
      row.push((asset.alpha[bit >> 3] ?? 0) & (0x80 >> (bit & 7)) ? 1 : 0);
    }
    rows.push(row);
  }
  return { rows, w: glyph.width, h: glyph.height };
}

/** The plain (unsmoothed) n× nearest upscale of a glcdfont cell. */
function plainDouble(codepoint: number, n: number): number[][] {
  const src: number[][] = [];
  for (let y = 0; y < 8; y++) src.push([]);
  for (let x = 0; x < 5; x++) {
    const col = GLCDFONT_BYTES[codepoint * 5 + x] ?? 0;
    for (let y = 0; y < 8; y++) src[y]![x] = (col >> y) & 1;
  }
  const big: number[][] = [];
  for (let y = 0; y < 8 * n; y++) big.push(new Array<number>(5 * n).fill(0));
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 5; x++) {
      if (!src[y]![x]) continue;
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) big[y * n + dy]![x * n + dx] = 1;
    }
  }
  return big;
}

afterEach(() => resetDisplayProfile());

describe("built-in Classic bitmap family", () => {
  it("resolves with no @font-face and bakes native 8px as the raw table bits", () => {
    const asset = bakeClassic("T =", 8);
    expect(asset.format).toBe("mono1");
    expect(asset.family.toLowerCase()).toBe("classic");
    expect(asset.lineHeight).toBe(8);
    const { rows, w, h } = glyphBits(asset, "T".codePointAt(0)!);
    expect(w).toBe(5);
    expect(h).toBe(8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 5; x++) {
        const table = (GLCDFONT_BYTES["T".charCodeAt(0) * 5 + x]! >> y) & 1;
        expect(rows[y]![x], `T(${x},${y})`).toBe(table);
      }
    }
    // Fixed cell metrics: 5px glyph + 1px spacing, no ink-bearing bitmap for space.
    const space = asset.glyphs.find((g) => g.codepoint === " ".codePointAt(0))!;
    expect(space.width).toBe(0);
    expect(space.height).toBe(0);
    expect(space.advance).toBe(6);
  });

  it("smooths doubled glyphs: 2x adds corner-bridge ink over the plain upscale", () => {
    const asset = bakeClassic("NVz", 16);
    expect(asset.lineHeight).toBe(16);
    let added = 0;
    for (const ch of "NVz") {
      const { rows } = glyphBits(asset, ch.codePointAt(0)!);
      const plain = plainDouble(ch.codePointAt(0)!, 2);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 10; x++) {
          if (rows[y]![x] === 1 && plain[y]![x] === 0) added++;
        }
      }
    }
    // Every diagonal in N, V, z contributes at least one bridged corner.
    expect(added).toBeGreaterThanOrEqual(6);
    // Smoothing only ADDS ink — never removes the doubled pixels.
    const { rows } = glyphBits(asset, "V".codePointAt(0)!);
    const plainV = plainDouble("V".codePointAt(0)!, 2);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 10; x++) {
        if (plainV[y]![x] === 1) expect(rows[y]![x], `V(${x},${y})`).toBe(1);
      }
    }
  });

  it("keeps doubled stems integer-width (T's center stem is a constant 2px)", () => {
    const asset = bakeClassic("T", 16);
    const { rows } = glyphBits(asset, "T".codePointAt(0)!);
    // The T stem lives in doubled columns 4-5 below the top bar.
    for (let y = 4; y < 14; y++) {
      expect(rows[y]![4], `stem col4 row${y}`).toBe(1);
      expect(rows[y]![5], `stem col5 row${y}`).toBe(1);
      expect(rows[y]![3], `left of stem row${y}`).toBe(0);
      expect(rows[y]![6], `right of stem row${y}`).toBe(0);
    }
  });

  it("quantizes sizes to whole cells (12px→8, 20px→16, 24px→24)", () => {
    expect(bakeClassic("A", 12).lineHeight).toBe(8);
    expect(bakeClassic("A", 20).lineHeight).toBe(16);
    const a24 = bakeClassic("A", 24);
    expect(a24.lineHeight).toBe(24);
    expect(a24.glyphs[0]!.advance).toBe(18);
  });

  it("bakes alpha4 nibbles for color displays with the same pixels", () => {
    const asset = bakeClassic("T", 16, false);
    expect(asset.format).toBe("alpha4");
    const glyph = asset.glyphs.find((g) => g.codepoint === "T".codePointAt(0))!;
    const nibbles: number[] = [];
    for (let i = 0; i < glyph.width * glyph.height; i++) {
      const idx = glyph.dataOffset + i;
      const byte = asset.alpha[idx >> 1] ?? 0;
      nibbles.push(idx & 1 ? byte & 0xf : (byte >> 4) & 0xf);
    }
    expect(nibbles.every((v) => v === 0 || v === 15)).toBe(true);
    expect(nibbles.some((v) => v === 15)).toBe(true);
  });

  it("drops codepoints beyond the table from the subset (addText filter)", () => {
    // addText filters cp > 0xffff at planning, so a lone emoji plans nothing.
    const css = `#t { font-family: "Classic"; font-size: 16px; }`;
    const html = `<screen><text id="t">\u{1F642}</text></screen>`;
    const rules = parseCss(css);
    const [root] = parseHtmlWithKeyboards(html).screens.map((s: never) => resolveStyles(s, rules));
    setDisplayProfile(
      { driver: "solomon,ssd1306", width: 128, height: 64, colorFormat: "mono", rotation: 0 } as never,
      {},
    );
    try {
      expect(buildUIFontAssets(root, [], ".")).toHaveLength(0);
    } finally {
      resetDisplayProfile();
    }
  });
});
