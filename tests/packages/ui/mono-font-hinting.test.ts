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

function bake(chars: string, ttf: string, mono: boolean, px = 10): UIFontAssetModel {
  const css = `
    @font-face { font-family: "HintTest"; src: url("${ttf}"); font-weight: 400; }
    #t { font-family: "HintTest"; font-size: ${px}px; }
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
    // 12px: the supported size (10px is this face's sub-pixel floor).
    const asset = bake("0", "DejaVuSans.ttf", true, 12);
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

describe("mono hinting regressions (panel-verified shapes)", () => {
  it("keeps the R leg: the bowl must not swallow the diagonal (pairing never crosses a counter)", () => {
    const asset = bake("R", "DejaVuSans.ttf", true);
    const rows = glyphRows(asset, "R".codePointAt(0)!);
    const inked = rows.filter((r) => r.some(Boolean));
    // The bowl close is the widest ink row in the top half; the leg must
    // continue BELOW it for at least 2 rows and reach right of the stem.
    // The bowl close is the LAST densely-inked row in the glyph's upper half
    // (the top bar and the close both carry 3+ px; the counter rows don't).
    const upper = inked.slice(0, Math.ceil(inked.length / 2));
    const bowlClose = upper.filter((r) => r.reduce((a, b) => a + b, 0) >= 3).pop()!;
    const closeIdx = rows.indexOf(bowlClose);
    const below = rows.slice(closeIdx + 1).filter((r) => r.some(Boolean));
    expect(below.length, `rows below bowl close: ${JSON.stringify(rows)}`).toBeGreaterThanOrEqual(2);
    const stemX = bowlClose.indexOf(1);
    const legBeyondStem = below.some((r) => r.some((b, i) => b && i >= stemX + 2));
    expect(legBeyondStem, `leg diagonal right of stem: ${JSON.stringify(rows)}`).toBe(true);
  });

  it("keeps the 0 counter open (inner walls must not pair)", () => {
    const asset = bake("0", "DejaVuSans.ttf", true);
    const rows = glyphRows(asset, "0".codePointAt(0)!);
    const mid = rows.filter((r) => r.some(Boolean))[Math.floor(rows.filter((r) => r.some(Boolean)).length / 2)]!;
    const lit = mid.reduce((a, b) => a + b, 0);
    expect(lit, `middle row ${JSON.stringify(mid)}`).toBeLessThan(mid.length);
    expect(mid.includes(0) && mid.includes(1), "gap between walls").toBe(true);
  });

  it("widens every mono face to the fallback charset (bound text renders any digit)", () => {
    const asset = bake("SSD1309 · MONO RIG", "DejaVuSans.ttf", true);
    const cps = new Set(asset.glyphs.map((g) => g.codepoint));
    for (const ch of "2547cony.") {
      expect(cps.has(ch.codePointAt(0)!), `glyph '${ch}' present`).toBe(true);
    }
  });
});

describe("stroke consistency + diagonal smoothing", () => {
  it("pairs fragmented stem edges: h/n left stems hold one constant width", () => {
    const asset = bake("hn", "DejaVuSans.ttf", true, 12);
    for (const ch of "hn") {
      const rows = glyphRows(asset, ch.codePointAt(0)!);
      const inked = rows.filter((r) => r.some(Boolean));
      // The pure stem rows are the ones with exactly two ink runs (left
      // stem + bowl wall). In every one, the stem occupies the SAME single
      // column — a fragmented-edge stem instead wobbles between 1px and 2px.
      const runs = (r: number[]): number =>
        r.reduce((acc, b, i) => (b && (i === 0 || !r[i - 1]) ? acc + 1 : acc), 0);
      const firstRunLen = (r: number[]): number => {
        let n = 0;
        for (const b of r) {
          if (b) n++;
          else if (n) break;
        }
        return n;
      };
      const stemRows = inked.filter((r) => runs(r) === 2 && firstRunLen(r) === 1);
      expect(stemRows.length, `'${ch}' stem rows`).toBeGreaterThanOrEqual(3);
      const stemCols = new Set(stemRows.map((r) => r.findIndex((b) => b)));
      expect(stemCols.size, `'${ch}' stem columns: ${[...stemCols].join(",")}`).toBe(1);
      const col = [...stemCols][0]!;
      for (const r of stemRows) {
        expect(r[col + 1], `'${ch}' stem is 1px`).toBe(0);
      }
    }
  });

  it("renders diagonal-stroke glyphs as single 8-connected components", () => {
    const asset = bake("z7s2", "DejaVuSans.ttf", true, 12);
    for (const ch of "z7s2") {
      const rows = glyphRows(asset, ch.codePointAt(0)!);
      const h = rows.length, w = rows[0]?.length ?? 0;
      const seen = new Set<number>();
      let start = -1;
      let total = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (rows[y]![x]) { if (start < 0) start = y * w + x; total++; }
      }
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const i = stack.pop()!;
        const y = Math.floor(i / w), x = i % w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (rows[ny]![nx] && !seen.has(j)) { seen.add(j); stack.push(j); }
        }
      }
      expect(seen.size, `'${ch}' should be 8-connected (${seen.size}/${total})`).toBe(total);
    }
  });

  it("bakes a legible 9px small size (digits complete, o counter open)", () => {
    const asset = bake("12so", "DejaVuSans.ttf", true, 9);
    for (const ch of "12s") {
      const rows = glyphRows(asset, ch.codePointAt(0)!);
      expect(rows.flat().reduce((a, b) => a + b, 0), `'${ch}' has ink`).toBeGreaterThan(3);
    }
    const rows = glyphRows(asset, "o".codePointAt(0)!);
    const inked = rows.filter((r) => r.some(Boolean));
    const midRow = inked[Math.floor(inked.length / 2)]!;
    expect(midRow.some((b) => !b), "o counter open at 9px").toBe(true);
  });
});
