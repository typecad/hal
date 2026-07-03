// ---------------------------------------------------------------------------
// SSD1309 OLED display adapter — 1-bit monochrome OLED panels over I2C.
//
// Targets the Adafruit_SSD1306 library (which supports SSD1309 via the same
// API). The SSD1306 is a page-buffered Adafruit_GFX subclass: draw into its
// buffer via drawPixel/fillRect, then call display() to flush over I2C.
// Colors are 1-bit (SSD1306_WHITE / SSD1306_BLACK). The runtime's
// UI_NATIVE_MONO snap converts 565 → black/white at the draw choke points.
//
// The SSD1306 IS the backing store (its internal buffer), so this adapter
// follows the e-ink deferred-refresh pattern: the runtime draws dirty rects
// into the buffer, then display_partial_refresh() flushes. The SSD1306 has
// no true partial refresh — display() flushes the full page buffer — but
// the dirty-rect tracking still minimizes draw calls into the buffer.
//
// I2C wiring: SDA/SCL (Wire bus) + reset pin + I2C address (default 0x3C).
// ---------------------------------------------------------------------------

import type { DisplayAdapterCode, DisplayAdapterGenerator } from "../display-adapter.js";

export const ssd1309Adapter: DisplayAdapterGenerator = (display): DisplayAdapterCode => {
  const w = display.width;
  const h = display.height;
  const reset = display._mountReset;
  const address = display._mountAddress;
  const rotation = display.rotation ?? 0;

  return {
    includes: [
      `#define CuttlefishDisplayTarget Adafruit_GFX`,
      `#define CuttlefishCanvas16 GFXcanvas16`,
      `#include <Adafruit_GFX.h>`,
      `#include <Adafruit_SSD1306.h>`,
      `#include <Wire.h>`,
    ].join("\n"),

    // I2C constructor: Adafruit_SSD1306(width, height, &Wire, resetPin)
    declaration: `Adafruit_SSD1306 __tc_display(${w}, ${h}, &Wire, ${reset});`,

    functions: [
      `// --- Display adapter: SSD1309 OLED (1-bit mono, I2C, page-buffered) ---`,
      `static inline void display_init() {`,
      `  // SSD1306_SWITCHCAPVCC = generate display voltage from 3.3V internally.`,
      `  // The per-pixel charge pump produces a brief init flash on some panels.`,
      `  __tc_display.begin(SSD1306_SWITCHCAPVCC, ${address});`,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.clearDisplay();`,
      `}`,
      ``,
      `static inline void display_fillScreen(uint32_t color) {`,
      `  __tc_display.fillScreen(color ? SSD1306_WHITE : SSD1306_BLACK);`,
      `}`,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width() { return __tc_display.width(); }`,
      `static inline int16_t display_height() { return __tc_display.height(); }`,
      ``,
      `static inline void display_startWrite() {}`,
      `static inline void display_endWrite() {}`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {`,
      `  (void)x; (void)y; (void)w; (void)h;`,
      `}`,
      ``,
      `// The SSD1306 has no true partial refresh — display() flushes the full`,
      `// page buffer. The runtime's dirty-rect tracking still minimizes the draw`,
      `// calls INTO the buffer (only dirty nodes are redrawn); this just publishes`,
      `// the result. Called once per frame after the dirty-rect union is drawn.`,
      `static inline void display_partial_refresh(int16_t x, int16_t y, int16_t w, int16_t h) {`,
      `  (void)x; (void)y; (void)w; (void)h;`,
      `  __tc_display.display();`,
      `}`,
    ].join("\n"),
  };
};
