// LVGL font-converter .c files are bitmap sources: glyphs bake as-is from
// the file (its own size/metrics). These tests pin the parser against the
// real converter output shipped in the mono-rig demo (20px, 1bpp, letters).
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLvglFontC } from "@typecad/ui/ui-engine/font-assets";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C_FILE = path.resolve(HERE, "../../../demos/demo-mono-rig/src/DejaVuSans.c");

describe("LVGL font source", () => {
  afterEach(() => { /* parser is pure — nothing to reset */ });

  it("parses the converter output (metrics, ranges, line geometry)", () => {
    const font = parseLvglFontC(fs.readFileSync(C_FILE, "utf8"))!;
    expect(font).toBeDefined();
    expect(font.lineHeight).toBe(19);
    expect(font.baseline).toBe(15); // line_height 19 − base_line 4
    expect(font.glyphs.length).toBe(52); // A–Z + a–z (row 0 reserved skipped)
    const a = font.glyphs.find((g) => g.codepoint === 65)!;
    expect([a.boxW, a.boxH, a.advPx, a.ofsX, a.ofsY]).toEqual([14, 14, 14, 0, 0]);
    const g = font.glyphs.find((x) => x.codepoint === 103)!;
    expect(g.boxH).toBe(15);
    expect(g.ofsY).toBe(-4); // descender: bottom −ofs_y below baseline
  });

  it("parses the 9px variant (line geometry, glyph count)", () => {
    const font = parseLvglFontC(fs.readFileSync(path.resolve(HERE, "../../../demos/demo-mono-rig/src/dejavu9.c"), "utf8"))!;
    expect(font.lineHeight).toBe(9);
    expect(font.baseline).toBe(7); // 9 - 2
    expect(font.glyphs.length).toBe(51); // letters (X missing from the symbol list, K duplicated)
  });

  it("round-trips a glyph's bits through the mono1 cell layout", () => {
    const font = parseLvglFontC(fs.readFileSync(C_FILE, "utf8"))!;
    const a = font.glyphs.find((x) => x.codepoint === 65)!;
    // Row 0 of 'A' has ink at columns 6-7 (from the source bitmap 0x03...).
    const bits: string[] = [];
    for (let x = 0; x < a.boxW; x++) {
      const bit = a.bitmapIndex * 8 + x;
      bits.push((font.bitmap[bit >> 3]! >> (7 - (bit & 7))) & 1 ? "#" : ".");
    }
    expect(bits.join("")).toBe("......##......");
  });

  it("rejects non-LVGL C files", () => {
    expect(parseLvglFontC("int main(void) { return 0; }")).toBeUndefined();
  });
});
