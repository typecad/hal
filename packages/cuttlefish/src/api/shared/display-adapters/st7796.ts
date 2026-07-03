// ---------------------------------------------------------------------------
// ST7796S display adapter — supports two color modes:
//  - rgb565: standard 16-bit push (byte-identical with the ILI9341 path; the
//    ST7796S is commonly run in 565 mode for SPI bus efficiency).
//  - rgb666: native 18-bit mode. The runtime stores RGB888 values in node
//    fields and blends in 888 (UI_COLOR_DEPTH=888); this push path packs each
//    888 pixel to 18-bit (6-6-6) → 3 bytes for the ST7796S's 18-bit bus.
//
// Library note: targets Adafruit_ST7796 (Adafruit fork) or the TFT_eSPI
// ST7796 class. The 666 bus-packing API (writeColorBytes / SPI.writeBytes)
// should be verified against the chosen library before flashing.
// ---------------------------------------------------------------------------

import type { DisplayAdapterGenerator } from "../display-adapter.js";

export const st7796Adapter: DisplayAdapterGenerator = (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 1;
  const spiFreq = display.spiFrequency;
  const is666 = display.colorFormat === "rgb666";

  const includes = [
    "#define CuttlefishDisplayTarget Adafruit_GFX",
    "#define CuttlefishCanvas16 GFXcanvas16",
    "#include <Adafruit_GFX.h>",
    "#include <Adafruit_ST7796.h>",
  ].join("\n");

  // 565 mode: standard uint16_t writePixels (matches ILI9341).
  // 666 mode: pack each RGB888-stored pixel to 18-bit (6-6-6) → 3 bytes, pushed
  // in batches to respect a small stack buffer.
  const writePixels = is666
    ? [
        "static inline void display_writePixels(uint32_t* pixels, uint32_t count) {",
        "  // Pack RGB888 → 18-bit (6-6-6) → 3 bytes/pixel for the ST7796S 18-bit bus.",
        "  uint8_t buf[3 * 32];  // batch of 32 px",
        "  for (uint32_t base = 0; base < count; base += 32) {",
        "    uint32_t n = (count - base < 32) ? (count - base) : 32;",
        "    for (uint32_t i = 0; i < n; i++) {",
        "      uint32_t c = pixels[base + i];",
        "      buf[i * 3]     = (uint8_t)((c >> 16) & 0xfc);   // R6",
        "      buf[i * 3 + 1] = (uint8_t)((c >> 8) & 0xfc);    // G6",
        "      buf[i * 3 + 2] = (uint8_t)(c & 0xfc);           // B6",
        "    }",
        "    SPI.writeBytes(buf, (uint32_t)n * 3);",
        "  }",
        "}",
      ].join("\n")
    : [
        "static inline void display_writePixels(uint16_t* pixels, uint32_t count) {",
        "  __tc_display.writePixels(pixels, count);",
        "}",
      ].join("\n");

  const fillScreenSig = is666
    ? "static inline void display_fillScreen(UI_COLOR_T color) { __tc_display.fillScreen((uint16_t)color); }"
    : "static inline void display_fillScreen(UI_COLOR_T color) { __tc_display.fillScreen((uint16_t)color); }";

  return {
    includes,
    declaration: `Adafruit_ST7796 __tc_display = Adafruit_ST7796(${cs}, ${dc}, ${rst});`,
    functions: [
      `// --- Display adapter: ST7796S (${is666 ? "RGB666 / 18-bit" : "RGB565"}) ---`,
      "static inline void display_init() {",
      spiFreq ? `  __tc_display.begin(${spiFreq});` : "  __tc_display.begin();",
      `  __tc_display.setRotation(${rotation});`,
      is666 ? "  __tc_display.fillScreen(0x000000);" : "  __tc_display.fillScreen(0x0000);",
      "}",
      "",
      fillScreenSig,
      "static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }",
      "static inline int16_t display_width() { return __tc_display.width(); }",
      "static inline int16_t display_height() { return __tc_display.height(); }",
      "static inline void display_startWrite() { __tc_display.startWrite(); }",
      "static inline void display_endWrite() { __tc_display.endWrite(); }",
      "static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) { __tc_display.setAddrWindow(x, y, w, h); }",
      writePixels,
    ].join("\n"),
  };
};
