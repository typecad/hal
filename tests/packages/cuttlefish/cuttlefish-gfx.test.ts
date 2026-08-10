import { describe, it, expect } from "vitest";
import { emitCuttlefishGfx } from "../../../packages/ui/src/ui-engine/runtime-header/cuttlefish-gfx";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";

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
      // `(?:\s+final)?` allows the AUTOSAR leaf-class `final` stamp.
      expect(h).toMatch(/class\s+CuttlefishCanvas16(?:\s+final)?\s*:\s*public\s+CuttlefishGFX/);
      expect(h).toMatch(/class\s+CuttlefishCanvasMono(?:\s+final)?\s*:\s*public\s+CuttlefishGFX/);
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

  // Regression coverage for canvas-target null-deref bugs (C1/C2):
  // CuttlefishCanvas16/Mono construct their base with ops_=nullptr, so
  // any base-class method that dereferences ops_ crashes on a canvas target.
  // The fix: width()/height() are virtual; base geometry methods dispatch
  // through the virtual fillRect/drawPixel rather than through ops_ directly.
  describe("canvas target safety (no null ops_ deref)", () => {
    const h = emitCuttlefishGfx(true);

    it("base width()/height() are virtual so canvas overrides dispatch", () => {
      // The base declaration must say 'virtual' for the canvas override to
      // take effect through a CuttlefishGFX* pointer.
      const baseWidthMatch = h.match(/class\s+CuttlefishGFX\s*\{[\s\S]*?virtual\s+int16_t\s+width\(\)\s*const/);
      expect(baseWidthMatch, "base CuttlefishGFX::width() must be virtual").not.toBeNull();
      const baseHeightMatch = h.match(/class\s+CuttlefishGFX\s*\{[\s\S]*?virtual\s+int16_t\s+height\(\)\s*const/);
      expect(baseHeightMatch, "base CuttlefishGFX::height() must be virtual").not.toBeNull();
    });

    it("CuttlefishCanvas16 overrides width()/height()", () => {
      // `(?:\s+final)?` allows the AUTOSAR leaf-class `final` stamp.
      const canvasMatch = h.match(/class\s+CuttlefishCanvas16(?:\s+final)?\s*:\s*public\s+CuttlefishGFX\s*\{([\s\S]*?)\};/);
      expect(canvasMatch).not.toBeNull();
      expect(canvasMatch![1]).toMatch(/virtual\s+int16_t\s+width\(\)\s*const\s*\{[^}]*canvas_w_/);
      expect(canvasMatch![1]).toMatch(/virtual\s+int16_t\s+height\(\)\s*const\s*\{[^}]*canvas_h_/);
    });

    it("CuttlefishCanvasMono overrides width()/height()", () => {
      // `(?:\s+final)?` allows the AUTOSAR leaf-class `final` stamp.
      const canvasMatch = h.match(/class\s+CuttlefishCanvasMono(?:\s+final)?\s*:\s*public\s+CuttlefishGFX\s*\{([\s\S]*?)\};/);
      expect(canvasMatch).not.toBeNull();
      expect(canvasMatch![1]).toMatch(/virtual\s+int16_t\s+width\(\)\s*const\s*\{[^}]*canvas_w_/);
      expect(canvasMatch![1]).toMatch(/virtual\s+int16_t\s+height\(\)\s*const\s*\{[^}]*canvas_h_/);
    });

    it("base drawFastVLine/HLine dispatch through virtual fillRect, not ops_->fillRect", () => {
      // Regression: previously these did `if (ops_->fillRect) ops_->fillRect(...)`
      // which dereferences the null ops_ on a canvas target. They must now
      // call the virtual fillRect(...) so the canvas's buffer-writing override runs.
      const vlineImpl = h.match(/void\s+CuttlefishGFX::drawFastVLine[\s\S]*?\{[\s\S]*?\}/);
      expect(vlineImpl, "drawFastVLine implementation must exist").not.toBeNull();
      expect(vlineImpl![0]).toContain("fillRect(");
      expect(vlineImpl![0]).not.toMatch(/ops_->fillRect/);

      const hlineImpl = h.match(/void\s+CuttlefishGFX::drawFastHLine[\s\S]*?\{[\s\S]*?\}/);
      expect(hlineImpl, "drawFastHLine implementation must exist").not.toBeNull();
      expect(hlineImpl![0]).toContain("fillRect(");
      expect(hlineImpl![0]).not.toMatch(/ops_->fillRect/);
    });

    it("base drawPixel and fillRect null-check ops_ before dereferencing", () => {
      const drawPixelImpl = h.match(/void\s+CuttlefishGFX::drawPixel[\s\S]*?\{[\s\S]*?\}/)![0];
      expect(drawPixelImpl).toMatch(/if\s*\(\s*ops_\s*&&\s*ops_->writePixel\s*\)/);

      const fillRectImpl = h.match(/void\s+CuttlefishGFX::fillRect[\s\S]*?\{[\s\S]*?\}/)![0];
      expect(fillRectImpl).toMatch(/if\s*\(\s*ops_\s*&&\s*ops_->fillRect\s*\)/);
    });
  });

  // Regression: the CuttlefishGFX/CuttlefishCanvas16 class slice must NOT be
  // emitted alongside an adapter that macro-aliases CuttlefishCanvas16. The
  // Adafruit path aliases it to Adafruit's GFXcanvas16; emitting the native
  // class makes `class CuttlefishCanvas16` macro-expand into a redefinition of
  // GFXcanvas16 (redefinition error, buffer_/canvas_w_/canvas_h_ not declared).
  // The emitter gates the slice on this macro-alias property — this test guards
  // that every macro-alias adapter actually carries the macro, so the gate
  // suppresses the slice for them. Do NOT revert the gate to
  // providesDisplayAdapter(): that returns true on the Adafruit/Arduino path
  // precisely because Arduino OWNS the Adafruit adapters, unrelated to whether
  // the native GFX class is wanted.
  describe("slice suppression on macro-alias adapter paths", () => {
    const macroAliasRe = /^\s*#\s*define\s+CuttlefishCanvas16\b/m;

    it("every Adafruit adapter (ArduinoStrategy) macro-aliases CuttlefishCanvas16", () => {
      const arduino = new ArduinoStrategy();
      const profiles = [
        { driver: "ili9341", width: 240, height: 320, colorFormat: "rgb565", _mountCs: 10, _mountDc: 9, _mountRst: 8 },
        { driver: "st7796", width: 320, height: 480, colorFormat: "rgb565", _mountCs: 5, _mountDc: 17, _mountRst: 16 },
        { driver: "ssd1309", width: 128, height: 64, colorFormat: "mono", _mountBus: "I2C", _mountAddress: 0x3C },
      ];
      for (const p of profiles) {
        const adapter = generateDisplayAdapter({ ...p } as any, arduino);
        expect(
          macroAliasRe.test(adapter.includes),
          `${p.driver} adapter must define the CuttlefishCanvas16 macro so the native GFX slice is suppressed`,
        ).toBe(true);
      }
    });

    it("the SDL adapter macro-aliases CuttlefishCanvas16", () => {
      const adapter = generateDisplayAdapter({
        driver: "sdl",
        width: 320,
        height: 240,
        colorFormat: "rgb888",
      } as any);
      expect(macroAliasRe.test(adapter.includes)).toBe(true);
    });
  });
});
