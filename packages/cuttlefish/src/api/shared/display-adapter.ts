// ---------------------------------------------------------------------------
// Display adapter generator: produces zero-cost display-specific C++ code
// based on the display profile's driver type. The transpiler emits the
// adapter (includes + declaration + inline functions) before the runtime
// header, so the runtime never names a specific display class.
//
// To add a new display driver:
// 1. Write a generator function matching the DisplayAdapterGenerator signature
// 2. Register it: registerDisplayAdapter("driver-name", generator)
// 3. Reference it from cuttlefish.config.ts: display: { profile: "driver-name-spi" }
// ---------------------------------------------------------------------------

import type { ResolvedDisplay } from "../../ui/display-profile-store.js";

export interface DisplayAdapterCode {
  /** C++ #include lines (e.g. "#include <Adafruit_ILI9341.h>"). */
  includes: string;
  /** C++ display object declaration (e.g. "Adafruit_ILI9341 __tc_display = ..."). */
  declaration: string;
  /** C++ static inline adapter functions (display_init, display_fillScreen, etc.). */
  functions: string;
}

export type DisplayAdapterGenerator = (display: ResolvedDisplay) => DisplayAdapterCode;

// ── Adapter registry ────────────────────────────────────────────────────────
const adapters = new Map<string, DisplayAdapterGenerator>();

export function registerDisplayAdapter(driver: string, gen: DisplayAdapterGenerator): void {
  adapters.set(driver, gen);
}

export function generateDisplayAdapter(display: ResolvedDisplay): DisplayAdapterCode {
  const driver = display.driver;
  const gen = adapters.get(driver);
  if (!gen) {
    throw new Error(`No display adapter registered for driver "${driver}". ` +
      `Registered: ${[...adapters.keys()].join(", ")}.`);
  }
  return gen(display);
}

// ── ILI9341 adapter ─────────────────────────────────────────────────────────
// The first built-in adapter. Mirrors the code previously hardcoded in
// ui-emitter.ts and runtime-header.ts.

registerDisplayAdapter("ili9341", (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 1;
  const spiFreq = display.spiFrequency;

  return {
    includes: [
      `#define CuttlefishDisplayTarget Adafruit_GFX`,
      `#define CuttlefishCanvas16 GFXcanvas16`,
      `#include <Adafruit_GFX.h>`,
      `#include <Adafruit_ILI9341.h>`,
    ].join("\n"),
    declaration: `Adafruit_ILI9341 __tc_display = Adafruit_ILI9341(${cs}, ${dc}, ${rst});`,
    functions: [
      `// --- Display adapter: ILI9341 ---`,
      ``,
      `static inline void display_init() {`,
      spiFreq
        ? `  __tc_display.begin(${spiFreq});`
        : `  __tc_display.begin();`,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.fillScreen(0x0000);`,
      `}`,
      ``,
      `static inline void display_fillScreen(uint16_t color) {`,
      `  __tc_display.fillScreen(color);`,
      `}`,
      ``,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width() { return __tc_display.width(); }`,
      `static inline int16_t display_height() { return __tc_display.height(); }`,
      ``,
      `static inline void display_startWrite() { __tc_display.startWrite(); }`,
      `static inline void display_endWrite() { __tc_display.endWrite(); }`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {`,
      `  __tc_display.setAddrWindow(x, y, w, h);`,
      `}`,
      `static inline void display_writePixels(uint16_t* pixels, uint32_t count) {`,
      `  __tc_display.writePixels(pixels, count);`,
      `}`,
      ``,
      `static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) {`,
      `  return new GFXcanvas16(w, h);`,
      `}`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {`,
      `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
      `  return new (ps_malloc(sizeof(GFXcanvas16))) GFXcanvas16(w, h);`,
      `#else`,
      `  (void)w; (void)h;`,
      `  return nullptr;`,
      `#endif`,
      `}`,
      `static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) { delete canvas; }`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* canvas) { return canvas->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* canvas) { return canvas->height(); }`,
      `static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* canvas) { return canvas->getBuffer(); }`,
      `static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* canvas, int16_t x, int16_t y) { return canvas->getPixel(x, y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* canvas, uint16_t color) { canvas->fillScreen(color); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {`,
      `  canvas->fillRect(x, y, w, h, color);`,
      `}`,
      ``,
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* target, int16_t x, int16_t y, uint16_t color) { target->drawPixel(x, y, color); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* target, int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {`,
      `  target->drawRGBBitmap(x, y, bitmap, w, h);`,
      `}`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {`,
      `  target->fillRect(x, y, w, h, color);`,
      `}`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, uint16_t color) {`,
      `  target->drawFastHLine(x, y, w, color);`,
      `}`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t h, uint16_t color) {`,
      `  target->drawFastVLine(x, y, h, color);`,
      `}`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {`,
      `  target->fillRoundRect(x, y, w, h, r, color);`,
      `}`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {`,
      `  target->drawRect(x, y, w, h, color);`,
      `}`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {`,
      `  target->drawRoundRect(x, y, w, h, r, color);`,
      `}`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* target, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {`,
      `  target->drawLine(x0, y0, x1, y1, color);`,
      `}`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, uint16_t color) {`,
      `  target->fillCircle(x, y, r, color);`,
      `}`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, uint16_t color) {`,
      `  target->drawCircle(x, y, r, color);`,
      `}`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* target, int16_t x, int16_t y) { target->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* target, uint16_t fg) { target->setTextColor(fg); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* target, uint16_t fg, uint16_t bg) { target->setTextColor(fg, bg); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* target, uint8_t size) { target->setTextSize(size); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* target, bool wrap) { target->setTextWrap(wrap); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* target, const char* text) { target->print(text); }`,
    ].join("\n"),
  };
});
