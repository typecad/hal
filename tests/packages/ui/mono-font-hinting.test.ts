// Mono light hinting (Stage 2): the 1bpp font bake snaps stems onto the pixel
// grid so a 1.4px stem renders one constant integer width instead of wobbling
// between 1 and 2 pixels along its length. These tests decode the packed
// mono1 bits and assert the snap held; the alpha4 (color display) path must
// stay on the raw outline.
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCss, parseFontFaces } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { buildUIFontAssets, monoHintContours, monoYZoneTable } from "@typecad/ui/ui-engine/font-assets";
import opentype from "opentype.js";
import fs from "node:fs";
import type { UIFontAssetModel } from "@typecad/ui/ui-engine/font-assets";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(HERE, "../../../packages/ui/assets/fonts/dejavu");

function bake(chars: string, ttf: string, mono: boolean): UIFontAssetModel {
  const css = `
    @font-face { font-family: "HintTest"; src: url("${ttf}"); font-weight: 400; }
    #t { font-family: "HintTest"; font-size: 10px; }
  `;
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
    return buildUIFontAssets(root, parseFontFaces(css), FONTS)[0]!;
  } finally {
    resetDisplayProfile();
  }
}

/** Decode a glyph's rows from the packed MSB-first mono1 bitmap. */
function glyphRows(asset: UIFontAssetModel, codepoint: number): number[][] {
  const glyph = asset.glyphs.find((g) => g.codepoint === codepoint);
  expect(glyph, `glyph ${String.fromCodePoint(codepoint)}`).toBeDefined();
  const rows: number[][] = [];
  for (let y = 0; y < glyph!.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < glyph!.width; x++) {
      const bit = glyph!.dataOffset + y * glyph!.width + x;
      row.push((asset.alpha[bit >> 3] ?? 0) & (0x80 >> (bit & 7)) ? 1 : 0);
    }
    rows.push(row);
  }
  return rows;
}

const mask = (row: number[]): number => row.reduce((acc, b, i) => (b ? acc | (1 << i) : acc), 0);

afterEach(() => resetDisplayProfile());

describe("mono bake stem snapping", () => {
  it("renders the bar glyph as a constant-width straight stem (regular)", () => {
    const asset = bake("|i·l0", "DejaVuSans.ttf", true);
    expect(asset.format).toBe("mono1");
    const rows = glyphRows(asset, "|".codePointAt(0)!);
    const on = rows.filter((r) => r.some(Boolean));
    expect(on.length).toBeGreaterThan(3);
    const masks = new Set(on.map(mask));
    expect(masks.size, `row masks: ${[...masks].map((m) => m.toString(2))}`).toBe(1);
    const width = on[0]!.filter(Boolean).length;
    expect(width).toBeGreaterThanOrEqual(1);
    expect(width).toBeLessThanOrEqual(2);
  });

  it("snaps bold stems to a constant integer width too", () => {
    const asset = bake("|", "DejaVuSans-Bold.ttf", true);
    const rows = glyphRows(asset, "|".codePointAt(0)!);
    const on = rows.filter((r) => r.some(Boolean));
    expect(on.length).toBeGreaterThan(3);
    expect(new Set(on.map(mask)).size).toBe(1);
  });

  it("keeps the verticals of a round glyph straight through its mid-height", () => {
    const asset = bake("0", "DejaVuSans.ttf", true);
    const rows = glyphRows(asset, "0".codePointAt(0)!);
    const on = rows.filter((r) => r.some(Boolean));
    const mid = on.slice(Math.floor(on.length / 4), Math.ceil((on.length * 3) / 4));
    const counts = new Map<number, number>();
    for (const r of mid) counts.set(mask(r), (counts.get(mask(r)) ?? 0) + 1);
    const best = Math.max(...counts.values());
    expect(best, `mid masks: ${[...counts.entries()].map(([m, c]) => `${m.toString(2)}x${c}`)}`).toBeGreaterThanOrEqual(4);
  });

  it("does not eat the middle dot (despeckle must spare tiny marks)", () => {
    const asset = bake("·", "DejaVuSans.ttf", true);
    const rows = glyphRows(asset, "·".codePointAt(0)!);
    const ink = rows.reduce((acc, r) => acc + r.reduce((a, b) => a + b, 0), 0);
    expect(ink).toBeGreaterThan(0);
  });

  it("leaves the alpha4 (color display) bake on the raw outline", () => {
    const asset = bake("|", "DejaVuSans.ttf", false);
    expect(asset.format).toBe("alpha4");
    expect(asset.alpha.length).toBeGreaterThan(0);
  });
});

describe("mono blue zones", () => {
  const ttf = fs.readFileSync(path.resolve(FONTS, "DejaVuSans.ttf"));
  const font = opentype.parse(
    ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer,
  );

  it("derives x-height/cap-height zones (OS/2 fallback via glyph metrics)", () => {
    const zones = monoYZoneTable(font, 10);
    expect(zones).toBeDefined();
    expect(zones).toContainEqual({ coord: 0, snap: 0 });
    const xUnits = font.charToGlyph("x").getMetrics().yMax;
    const capUnits = font.charToGlyph("H").getMetrics().yMax;
    const xZone = zones!.find((z) => Math.abs(z.coord - (xUnits * -10) / font.unitsPerEm) < 1e-9);
    const capZone = zones!.find((z) => Math.abs(z.coord - (capUnits * -10) / font.unitsPerEm) < 1e-9);
    expect(xZone, "x-height zone").toBeDefined();
    expect(capZone, "cap-height zone").toBeDefined();
    expect(xZone!.snap).toBe(Math.round(xZone!.coord));
    expect(capZone!.snap).toBe(Math.round(capZone!.coord));
  });

  it("snaps a drifting x-height edge to the zone instead of its own rounding", () => {
    // A stem whose flat top drifted to -5.51: plain rounding gives -6, the
    // zone (design -5.4 → -5) keeps it on the shared row.
    const rect = [[
      { x: 0, y: -5.51 }, { x: 6, y: -5.51 }, { x: 6, y: 0 }, { x: 0, y: 0 },
    ]];
    const zones = [{ coord: 0, snap: 0 }, { coord: -5.4, snap: -5 }];
    const hinted = monoHintContours(rect as never, zones);
    const topY = Math.min(...hinted[0]!.map((p: { y: number }) => p.y));
    expect(topY).toBeCloseTo(-5, 9);
    const unzoned = monoHintContours(rect as never);
    const topYPlain = Math.min(...unzoned[0]!.map((p: { y: number }) => p.y));
    expect(topYPlain).toBeCloseTo(-6, 9);
  });

  it("leaves hinting unchanged when no zones are derivable", () => {
    expect(monoYZoneTable({ unitsPerEm: 0 }, 10)).toBeUndefined();
    const rect = [[{ x: 0, y: -5.51 }, { x: 6, y: -5.51 }, { x: 6, y: 0 }, { x: 0, y: 0 }]];
    const a = monoHintContours(rect as never, undefined);
    const b = monoHintContours(rect as never);
    expect(a).toEqual(b);
  });
});
