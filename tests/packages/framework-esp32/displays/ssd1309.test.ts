import { describe, it, expect, beforeEach } from "vitest";
import { generateDisplayAdapter } from "../../../../packages/cuttlefish/src/api/shared/display-adapter";
import { Esp32Strategy } from "../../../../packages/framework-esp32/src/strategy";
import { setActiveChip, ESP32 } from "../../../../packages/framework-esp32/src/chips/index";

beforeEach(() => setActiveChip(ESP32));

const base = {
  driver: "ssd1309", width: 128, height: 64, colorFormat: "mono" as const,
  rotation: 0,
  _mountCs: -1, _mountDc: -1, _mountRst: -1, _mountBus: "I2C",
  _mountAddress: 0x3c, _mountReset: -1,
};

const strategy = new Esp32Strategy();

describe("ESP32 SSD1309 adapter", () => {
  const a = generateDisplayAdapter(base as any, strategy as any);

  it("no Adafruit, no Arduino SPI/Wire in includes", () => {
    expect(a.includes).not.toMatch(/Adafruit/);
    expect(a.includes).not.toContain("<SPI.h>");
    expect(a.includes).not.toContain("<Wire.h>");
  });

  it("declares a CuttlefishGFX instance", () => {
    expect(a.declaration).toMatch(/CuttlefishGFX/);
    expect(a.declaration).not.toMatch(/Adafruit/);
  });

  it("references ESP-IDF I2C primitives (NOT _twi_)", () => {
    expect(a.functions).toContain("i2c_master_transmit");
    expect(a.functions).toContain("i2c_new_master_bus");
    expect(a.functions).toContain("i2c_master_bus_add_device");
  });

  it("uses a dedicated display I2C bus (not __tc_i2c0_*)", () => {
    expect(a.functions).toMatch(/__esp32_i2c_display/);
  });

  it("flushes the full page buffer directly via i2c_master_transmit (not via __tc_i2c0_txbuf which is 32 bytes)", () => {
    // The runtime __tc_i2cN_txbuf is 32 bytes — too small for a 1KB flush.
    // The adapter must call i2c_master_transmit with its own larger buffer.
    expect(a.functions).toMatch(/i2c_master_transmit\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+/);
    expect(a.functions).not.toMatch(/__tc_i2c0_txbuf/);
  });

  it("declares a 1KB page buffer for 128x64 mono", () => {
    expect(a.functions).toMatch(/1024|__ssd1309_buffer/);
  });

  it("implements display_partial_refresh", () => {
    expect(a.functions).toContain("display_partial_refresh");
  });

  it("contains the SSD1306 init sequence", () => {
    expect(a.functions).toContain("0xAE");
    expect(a.functions).toContain("0xAF");
    expect(a.functions).toContain("0x8D");
    expect(a.functions).toContain("0xA1");
    expect(a.functions).toContain("0xC8");
    expect(a.functions).toContain("0xDA");
    expect(a.functions).toContain("0x81");
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
