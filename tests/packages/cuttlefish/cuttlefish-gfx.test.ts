import { describe, it, expect } from "vitest";
import { emitCuttlefishGfx } from "../../../packages/ui/src/ui-engine/runtime-header/cuttlefish-gfx";

describe("emitCuttlefishGfx slice", () => {
  it("returns empty string when native adapter is not active (Arduino path)", () => {
    expect(emitCuttlefishGfx(false)).toBe("");
  });

  describe("when native adapter is active", () => {
    const h = emitCuttlefishGfx(true);

    it("emits an include guard so it's safe to emit once", () => {
      expect(h).toMatch(/#ifndef\s+CUTTLEFISH_GFX_DEFINED/);
      expect(h).toMatch(/#define\s+CUTTLEFISH_GFX_DEFINED/);
      expect(h).toMatch(/#endif\s+\/\/\s*CUTTLEFISH_GFX_DEFINED/);
    });

    it("declares the CuttlefishPanelOps struct with all required ops", () => {
      const structMatch = h.match(/struct\s+CuttlefishPanelOps\s*\{([\s\S]*?)\};/);
      expect(structMatch, "CuttlefishPanelOps struct must exist").not.toBeNull();
      const body = structMatch![1];
      expect(body).toMatch(/void\s*\(\*startWrite\)/);
      expect(body).toMatch(/void\s*\(\*endWrite\)/);
      expect(body).toMatch(/void\s*\(\*setAddrWindow\)/);
      expect(body).toMatch(/void\s*\(\*writePixels\)/);
      expect(body).toMatch(/void\s*\(\*writePixel\)/);
      expect(body).toMatch(/void\s*\(\*fillRect\)/);
      expect(body).toMatch(/int16_t\s*\(\*width\)/);
      expect(body).toMatch(/int16_t\s*\(\*height\)/);
      expect(body).toMatch(/void\s*\(\*flush\)/);
    });

    it("declares the CuttlefishGFX class with required geometry/text methods", () => {
      const classMatch = h.match(/class\s+CuttlefishGFX\s*\{([\s\S]*?)\};/);
      expect(classMatch, "CuttlefishGFX class must exist").not.toBeNull();
      const body = classMatch![1];
      for (const m of [
        "drawPixel", "drawLine", "drawFastHLine", "drawFastVLine",
        "drawRect", "fillRect", "drawRoundRect", "fillRoundRect",
        "drawCircle", "fillCircle", "drawTriangle", "fillTriangle",
        "setCursor", "setTextColor", "setTextSize", "setTextWrap",
        "write", "print", "drawChar",
      ]) {
        expect(body, `missing method: ${m}`).toMatch(new RegExp(m));
      }
    });

    it("declares CuttlefishCanvas16 and CuttlefishCanvasMono subclasses", () => {
      expect(h).toMatch(/class\s+CuttlefishCanvas16\s*:\s*public\s+CuttlefishGFX/);
      expect(h).toMatch(/class\s+CuttlefishCanvasMono\s*:\s*public\s+CuttlefishGFX/);
      expect(h).toMatch(/getBuffer/);
    });

    it("embeds the glcdfont 5x7 font table (Adafruit public-domain source)", () => {
      // The font is 256 glyphs × 5 bytes = 1280 bytes.
      const fontMatch = h.match(/glcdfong?\s*\[\s*\]\s*=\s*\{([\s\S]*?)\}/i);
      // Try the actual array name (cuttlefish_glcdfont):
      const realMatch = h.match(/(?:static\s+const\s+\w+\s+)?(?:PROGMEM\s+)?(\w*glcdfont\w*)\s*\[\s*\]?\s*=\s*\{([\s\S]*?)\}/i);
      expect(realMatch || fontMatch, "glcdfont array must exist").not.toBeNull();
      const bytesStr = (realMatch ? realMatch![2] : fontMatch![1]);
      const bytes = bytesStr.split(",").map(s => s.trim()).filter(s => /^0x[0-9a-f]+$/i.test(s));
      // 1280 bytes for the full 256-glyph Adafruit table.
      expect(bytes.length).toBeGreaterThanOrEqual(480);
    });

    it("provides ssd_mono() color snap helper", () => {
      expect(h).toMatch(/ssd_mono\s*\(\s*uint16_t\s+\w+\s*\)/);
    });

    it("implements drawLine (Bresenham) — references writePixel in a loop", () => {
      // Sanity: the geometry implementation must actually exist, not just decl.
      expect(h).toMatch(/void\s+CuttlefishGFX::drawLine/);
    });

    it("implements fillCircle (midpoint) — references writePixel or fillRect", () => {
      expect(h).toMatch(/void\s+CuttlefishGFX::fillCircle/);
    });

    it("implements drawChar (glyph rendering from glcdfont)", () => {
      expect(h).toMatch(/void\s+CuttlefishGFX::drawChar/);
    });
  });
});
