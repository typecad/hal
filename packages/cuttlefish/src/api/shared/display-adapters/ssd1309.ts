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
      `  __tc_display.begin(SSD1306_SWITCHCAPVCC, 0x${address.toString(16)});`,
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
      `static inline void display_startWrite() {}`,
      `static inline void display_endWrite() {}`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {`,
      `  (void)x; (void)y; (void)w; (void)h;`,
      `}`,
      `static inline void display_writePixels(UI_COLOR_T* pixels, uint32_t count) {`,
      `  // SSD1306 is page-buffered — write into the GFX buffer via drawPixel.`,
      `  for (uint32_t i = 0; i < count; i++) {`,
      `    int16_t px = (int16_t)(i % __tc_display.width());`,
      `    int16_t py = (int16_t)(i / __tc_display.width());`,
      `    __tc_display.drawPixel(px, py, pixels[i] ? SSD1306_WHITE : SSD1306_BLACK);`,
      `  }`,
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
      // ── Canvas (offscreen GFXcanvas16 for AA text / scroll compositing) ──
      `static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) { return new GFXcanvas16(w, h); }`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {`,
      `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
      `  return new (ps_malloc(sizeof(GFXcanvas16))) GFXcanvas16(w, h);`,
      `#else`,
      `  (void)w; (void)h;`,
      `  return nullptr;`,
      `#endif`,
      `}`,
      `static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) { delete canvas; }`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c->height(); }`,
      `static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* c) { return c->getBuffer(); }`,
      `static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c->getPixel(x, y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* c, UI_COLOR_T color) { c->fillScreen((uint16_t)color); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) { c->fillRect(x, y, w, h, (uint16_t)color); }`,
      // ── Target-polymorphic draw (panel + canvas share CuttlefishDisplayTarget*) ──
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x, y, (uint16_t)color); }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const UI_COLOR_T* b, int16_t w, int16_t h) { t->drawRGBBitmap(x, y, b, w, h); }`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) { t->fillRect(x, y, w, h, (uint16_t)color); }`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, UI_COLOR_T color) { t->drawFastHLine(x, y, w, (uint16_t)color); }`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t h, UI_COLOR_T color) { t->drawFastVLine(x, y, h, (uint16_t)color); }`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) { t->fillRoundRect(x, y, w, h, r, (uint16_t)color); }`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) { t->drawRect(x, y, w, h, (uint16_t)color); }`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) { t->drawRoundRect(x, y, w, h, r, (uint16_t)color); }`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) { t->drawLine(x0, y0, x1, y1, (uint16_t)color); }`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->fillCircle(x, y, r, (uint16_t)color); }`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->drawCircle(x, y, r, (uint16_t)color); }`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { t->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, UI_COLOR_T fg) { t->setTextColor((uint16_t)fg); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, UI_COLOR_T fg, UI_COLOR_T bg) { t->setTextColor((uint16_t)fg, (uint16_t)bg); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { t->setTextSize(s); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool w) { t->setTextWrap(w); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); }`,
    ].join("\n"),
  };
};
