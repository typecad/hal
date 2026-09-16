// GOLDEN BITMAPS — the exact hinted mono glyphs for the ladder sizes, pinned
// verbatim. These are the rendering-quality baseline established through the
// panel trials (TT hinting + threshold rules); any change to the rasterizer
// (thresholds, hinting handling, finishing passes) that alters a pixel here
// fails this test — regenerate the fixture ONLY as a deliberate, reviewed
// rendering change.
import { describe, it, expect, afterEach } from "vitest";
import { parseCss, parseFontFaces } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { buildUIFontAssets } from "@typecad/ui/ui-engine/font-assets";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/assets/fonts/dejavu");

const GOLDEN = [
  { px: 10, glyphs: {
    "A": [
      ".........",
      "...###...",
      "...###...",
      "...#.#...",
      "..##.##..",
      "..#####..",
      ".##...##.",
      ".##...##.",
      ".........",
    ],
    "g": [
      ".......",
      "..####.",
      ".##.##.",
      ".#...#.",
      ".##.##.",
      "..####.",
      "....##.",
      "..###..",
      ".......",
    ],
    "R": [
      "........",
      ".#####..",
      ".#..##..",
      ".#..##..",
      ".####...",
      ".#..##..",
      ".#...#..",
      ".#...##.",
      "........",
    ],
    "%": [
      "..........",
      ".###..##..",
      ".#.#.##...",
      ".#.#.#....",
      ".########.",
      "....#.#.#.",
      "...##.#.#.",
      "..##..###.",
      "..........",
    ],
  } },
  { px: 11, glyphs: {
    "A": [
      ".........",
      "...###...",
      "...###...",
      "...#.#...",
      "..##.##..",
      "..##.##..",
      "..#####..",
      ".##...##.",
      ".#.....#.",
      ".........",
    ],
    "g": [
      ".......",
      "..####.",
      ".##.##.",
      ".#...#.",
      ".#...#.",
      ".##.##.",
      "..####.",
      "....##.",
      "..###..",
      ".......",
    ],
    "R": [
      "........",
      ".####...",
      ".#..##..",
      ".#...#..",
      ".#..##..",
      ".####...",
      ".#..##..",
      ".#...#..",
      ".#...##.",
      "........",
    ],
    "%": [
      "...........",
      ".####..#...",
      ".#..#.##...",
      ".#..#.#....",
      ".######....",
      "....######.",
      "....#.#..#.",
      "...##.#..#.",
      "...#..####.",
      "...........",
    ],
  } },
  { px: 13, glyphs: {
    "A": [
      "...........",
      "....###....",
      "....###....",
      "...##.##...",
      "...##.##...",
      "...#...#...",
      "..#######..",
      "..#.....#..",
      ".##.....##.",
      ".##.....##.",
      "...........",
    ],
    "g": [
      "........",
      "..#####.",
      ".##..##.",
      ".#....#.",
      ".#....#.",
      ".#....#.",
      ".##..##.",
      "..#####.",
      "......#.",
      "..#..##.",
      "..####..",
      "........",
    ],
    "R": [
      ".........",
      ".#####...",
      ".#...##..",
      ".#....#..",
      ".#...##..",
      ".#####...",
      ".#...##..",
      ".#....#..",
      ".#....##.",
      ".#.....#.",
      ".........",
    ],
    "%": [
      ".............",
      ".####...##...",
      ".#..#...#....",
      ".#..#..##....",
      ".#..#.##.....",
      ".####.#.####.",
      ".....##.#..#.",
      "....##..#..#.",
      "....#...#..#.",
      "...##...####.",
      ".............",
    ],
  } },
];

function bakeAt(px: number) {
  const css = `@font-face { font-family: "T"; src: url("DejaVuSans.ttf"); font-weight: 400; }
#t { font-family: "T"; font-size: ${px}px; }`;
  const rules = parseCss(css);
  const [root] = parseHtmlWithKeyboards(`<screen><text id="t">AgRg47%</text></screen>`).screens.map((s: never) => resolveStyles(s, rules));
  setDisplayProfile({ driver: "solomon,ssd1306", width: 128, height: 64, colorFormat: "mono", rotation: 0 } as never, {});
  try {
    return buildUIFontAssets(root, parseFontFaces(css), FONTS)[0]!;
  } finally {
    resetDisplayProfile();
  }
}

function rowsOf(asset: ReturnType<typeof bakeAt>, ch: string): string[] {
  const g = asset.glyphs.find((x) => x.codepoint === ch.codePointAt(0))!;
  const rows: string[] = [];
  for (let y = 0; y < g.height; y++) {
    let row = "";
    for (let x = 0; x < g.width; x++) {
      const bit = g.dataOffset + y * g.width + x;
      row += (asset.alpha[bit >> 3]! & (0x80 >> (bit & 7))) ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

describe("golden mono glyphs (TT-hinted)", () => {
  afterEach(() => resetDisplayProfile());

  for (const size of GOLDEN) {
    it(`pins ${size.px}px A/g/R/% bitmaps`, () => {
      const asset = bakeAt(size.px);
      expect(asset.format).toBe("mono1");
      for (const [ch, expected] of Object.entries(size.glyphs)) {
        expect(rowsOf(asset, ch), `${size.px}px '${ch}'`).toEqual(expected);
      }
    });
  }
});
