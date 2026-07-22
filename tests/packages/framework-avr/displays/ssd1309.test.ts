import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../../packages/cuttlefish/src/api/shared/display-adapter";
import { NativeAVRStrategy } from "../../../../packages/framework-avr/src/strategy";

const base = {
  driver: "ssd1309", width: 128, height: 64, colorFormat: "mono" as const,
  rotation: 0,
  _mountCs: -1, _mountDc: -1, _mountRst: -1, _mountBus: "I2C",
  _mountAddress: 0x3c, _mountReset: -1,
};

const strategy = new NativeAVRStrategy();

describe("AVR SSD1309 adapter", () => {
  const a = generateDisplayAdapter(base as any, strategy as any);

  it("no Adafruit, no Arduino SPI/Wire in includes", () => {
    expect(a.includes).not.toMatch(/Adafruit/);
    expect(a.includes).not.toContain("<SPI.h>");
    expect(a.includes).not.toContain("<Wire.h>");
  });

  it("declares a CuttlefishGFX instance (not Adafruit_SSD1306)", () => {
    expect(a.declaration).toMatch(/CuttlefishGFX/);
    expect(a.declaration).not.toMatch(/Adafruit/);
  });

  it("references AVR native _twi_ primitives (NOT _spi_)", () => {
    expect(a.functions).toContain("_twi_init");
    expect(a.functions).toContain("_twi_begin_transmission");
    expect(a.functions).toContain("_twi_write_byte");
    expect(a.functions).toContain("_twi_end_transmission");
  });

  it("declares a 1KB page buffer for 128x64 mono panel", () => {
    // 128 * 64 / 8 = 1024 bytes
    expect(a.functions).toMatch(/1024|128\s*\*\s*64\s*\/\s*8|__ssd1309_buffer/);
  });

  it("implements display_partial_refresh (page-buffered flush)", () => {
    expect(a.functions).toContain("display_partial_refresh");
  });

  it("contains the SSD1306 init sequence (Adafruit_SSD1306)", () => {
    // 0xAE display off, 0xAF display on, 0x8D charge pump, 0xA1 seg remap,
    // 0xC8 comscandec, 0xDA compins, 0x81 contrast
    expect(a.functions).toContain("0xAE");  // display off
    expect(a.functions).toContain("0xAF");  // display on
    expect(a.functions).toContain("0x8D");  // charge pump
    expect(a.functions).toContain("0xA1");  // seg remap
    expect(a.functions).toContain("0xC8");  // comscandec
    expect(a.functions).toContain("0xDA");  // compins
    expect(a.functions).toContain("0x81");  // contrast
  });

  it("uses the configured I2C address (0x3C default)", () => {
    // Address 0x3C = 60 decimal, sent on the wire as 0x78 (8-bit write).
    expect(a.functions).toMatch(/0x3c/i);
  });

  it("implements all required display_* adapter functions", () => {
    for (const fn of [
      "display_init", "display_fillScreen", "display_defaultTarget",
      "display_width", "display_height",
      "display_startWrite", "display_endWrite",
      "display_setAddrWindow", "display_writePixels",
      "display_partial_refresh",
      "display_createCanvas", "display_createCanvasPsram", "display_deleteCanvas",
      "display_canvasWidth", "display_canvasHeight", "display_canvasBuffer",
      "display_canvasGetPixel", "display_canvasFillScreen", "display_canvasFillRect",
      "display_targetDrawPixel", "display_targetWidth", "display_targetHeight",
      "display_targetDrawRGBBitmap", "display_targetFillRect",
      "display_targetDrawFastHLine", "display_targetDrawFastVLine",
      "display_targetFillRoundRect", "display_targetDrawRect",
      "display_targetDrawRoundRect", "display_targetDrawLine",
      "display_targetFillCircle", "display_targetDrawCircle",
      "display_targetSetCursor", "display_targetSetTextColor",
      "display_targetSetTextColorBg", "display_targetSetTextSize",
      "display_targetSetTextWrap", "display_targetPrint",
    ]) {
      expect(a.functions, `missing display_* function: ${fn}`).toContain(fn);
    }
  });
});
