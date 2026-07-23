import { describe, it, expect, beforeEach } from "vitest";
import { generateDisplayAdapter } from "../../../../packages/cuttlefish/src/api/shared/display-adapter";
import { Esp32Strategy } from "../../../../packages/framework-esp32/src/strategy";
import { setActiveChip, ESP32 } from "../../../../packages/framework-esp32/src/chips/index";

beforeEach(() => setActiveChip(ESP32));

const base = {
  driver: "ili9341", width: 240, height: 320, colorFormat: "rgb565" as const,
  rotation: 1, spiFrequency: 40000000,
  _mountCs: 5, _mountDc: 17, _mountRst: 16, _mountBus: "SPI",
  _mountAddress: 0x3c, _mountReset: -1,
};

const strategy = new Esp32Strategy();

describe("ESP32 ILI9341 adapter", () => {
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

  it("references ESP-IDF SPI primitives", () => {
    expect(a.functions).toContain("spi_device_polling_transmit");
    expect(a.functions).toContain("spi_bus_initialize");
    expect(a.functions).toContain("spi_bus_add_device");
    expect(a.functions).toContain("__esp32_display.dev");  // dedicated device handle (separate from user SPI)
  });

  it("drives CS/DC/RST via gpio_set_level (software-managed CS)", () => {
    expect(a.functions).toContain("gpio_set_level");
    expect(a.functions).toMatch(/spics_io_num\s*=\s*-1/);  // confirms software CS
  });

  it("contains the ILI9341 init command sequence", () => {
    expect(a.functions).toContain("0xEF");
    expect(a.functions).toContain("0xCF");
    expect(a.functions).toContain("0xED");
    expect(a.functions).toContain("0xE8");
    expect(a.functions).toContain("0xCB");
    expect(a.functions).toContain("0x11");  // SLPOUT
    expect(a.functions).toContain("0x29");  // DISPON
    expect(a.functions).toContain("0x3A");  // PIXFMT
    expect(a.functions).toContain("0x55");  // 16-bit/pixel (565)
  });

  it("honors rotation: 1 (landscape, MV bit) — MADCTL byte is 0x28 with BGR", () => {
    // The base fixture uses rotation: 1 (default), colorOrder defaults to 'bgr'.
    // MADCTL for rotation 1 = MV (0x20) + BGR (0x08) = 0x28.
    // Without MV the panel renders portrait while the transpiler writes
    // landscape geometry → white screen bug.
    // The init sequence is encoded as __esp32_spi_cmd_data((const uint8_t[]){cmd, data...}, len);
    // match the MADCTL write (command 0x36) and require the 0x28 value.
    expect(a.functions).toMatch(/\{\s*0x36,\s*0x28\s*\}/);
    expect(a.functions).not.toMatch(/\{\s*0x36,\s*0x48\s*\}/);  // 0x48 = rotation 0, no MV
    expect(a.functions).toContain("0x29");  // DISPON
    expect(a.functions).toContain("0x3A");  // PIXFMT
    expect(a.functions).toContain("0x55");  // 16-bit/pixel
  });

  it("implements all required display_* adapter functions", () => {
    for (const fn of [
      "display_init", "display_fillScreen", "display_defaultTarget",
      "display_width", "display_height",
      "display_startWrite", "display_endWrite",
      "display_setAddrWindow", "display_writePixels",
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

  it("uses PSRAM-gated canvas allocation", () => {
    expect(a.functions).toMatch(/BOARD_HAS_PSRAM/);
    expect(a.functions).toMatch(/ps_malloc/);
  });
});
