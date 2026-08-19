// ---------------------------------------------------------------------------
// Adafruit_GFX-based display adapters for @typecad/framework-arduino.
//
// Moved here from cuttlefish so cuttlefish carries no Adafruit/Wiring-specific
// display knowledge. ArduinoStrategy.providesDisplayAdapter() returns true and
// resolveDisplayAdapter() dispatches to these generators by driver name.
//
// Targets the Adafruit GFX ecosystem (Adafruit_GFX base + per-panel subclasses):
//   - ili9341: Adafruit_ILI9341 (SPI TFT, RGB565)
//   - st7796:  Adafruit_ST7796S (SPI TFT, RGB565)
//   - ssd1309: Adafruit_SSD1306  (I2C OLED, 1-bit mono — SSD1309 via SSD1306 API)
//
// Canvas support uses GFXcanvas16 for offscreen compositing (AA text, scroll).
// ---------------------------------------------------------------------------

import type { DisplayAdapterCode, DisplayAdapterGenerator } from "@typecad/cuttlefish/api/shared";

// ── ILI9341 adapter (SPI TFT, RGB565) ────────────────────────────────────────

export const ili9341Adapter: DisplayAdapterGenerator = (display) => {
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
      `  return new (std::nothrow) GFXcanvas16(w, h);`,
      `}`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {`,
      `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
      `  void* mem = ps_malloc(sizeof(GFXcanvas16));`,
      `  if (mem != nullptr) {`,
      `    return new (mem) GFXcanvas16(w, h);`,
      `  }`,
      `  return nullptr;`,
      `#else`,
      `  (void)w; (void)h;`,
      `  return nullptr;`,
      `#endif`,
      `}`,
      // Arduino cores back operator new with malloc(), and free() releases both
      // SRAM and PSRAM objects (ESP32 unified heap), so dtor + free() is the
      // correct teardown for both canvas allocation paths — delete would be UB
      // on the placement-new PSRAM object.
      `static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) {`,
      `  if (canvas == nullptr) { return; }`,
      `  canvas->~GFXcanvas16();`,
      `  free(canvas);`,
      `}`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* canvas) { return canvas->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* canvas) { return canvas->height(); }`,
      `static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* canvas) { return canvas->getBuffer(); }`,
      `static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* canvas, int16_t x, int16_t y) { return canvas->getPixel(x, y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* canvas, UI_COLOR_T color) { canvas->fillScreen(static_cast<uint16_t>(color)); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  canvas->fillRect(x, y, w, h, static_cast<uint16_t>(color));`,
      `}`,
      ``,
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* target, int16_t x, int16_t y, UI_COLOR_T color) { target->drawPixel(x, y, static_cast<uint16_t>(color)); }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* target) { return target->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* target) { return target->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* target, int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {`,
      `  target->drawRGBBitmap(x, y, bitmap, w, h);`,
      `}`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  target->fillRect(x, y, w, h, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, UI_COLOR_T color) {`,
      `  target->drawFastHLine(x, y, w, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t h, UI_COLOR_T color) {`,
      `  target->drawFastVLine(x, y, h, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {`,
      `  target->fillRoundRect(x, y, w, h, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  target->drawRect(x, y, w, h, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {`,
      `  target->drawRoundRect(x, y, w, h, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* target, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) {`,
      `  target->drawLine(x0, y0, x1, y1, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {`,
      `  target->fillCircle(x, y, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {`,
      `  target->drawCircle(x, y, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* target, int16_t x, int16_t y) { target->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* target, UI_COLOR_T fg) { target->setTextColor(static_cast<uint16_t>(fg)); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* target, UI_COLOR_T fg, UI_COLOR_T bg) { target->setTextColor(static_cast<uint16_t>(fg), static_cast<uint16_t>(bg)); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* target, uint8_t size) { target->setTextSize(size); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* target, bool wrap) { target->setTextWrap(wrap); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* target, const char* text) { target->print(text); }`,
    ].join("\n"),
  };
};

// ── ST7796S adapter (SPI TFT, RGB565) ────────────────────────────────────────

export const st7796Adapter: DisplayAdapterGenerator = (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 1;
  const spiFreq = display.spiFrequency;
  const invertDisplay = display.invertDisplay;
  const colorOrder = display.colorOrder === "bgr" ? "ST7796S_BGR" : "ST7796S_RGB";

  if (display.colorFormat === "rgb666" || display.colorFormat === "rgb888") {
    throw new Error(
      `RGB666/RGB888 is not supported by the Adafruit_ST7796S library: ` +
        `its init sequence hardcodes COLMOD=0x55 (RGB565). Use colorFormat: "rgb565". ` +
        `True 18-bit support requires patching the library init array and overriding ` +
        `Adafruit_SPITFT's 565-native writePixels — tracked as a follow-up.`,
    );
  }

  const includes = [
    "#define CuttlefishDisplayTarget Adafruit_GFX",
    "#define CuttlefishCanvas16 GFXcanvas16",
    "#include <Adafruit_GFX.h>",
    "#include <Adafruit_ST7796S.h>",
  ].join("\n");

  const inversionLines = invertDisplay === undefined
    ? []
    : [
        `  __tc_display.startWrite();`,
        `  __tc_display.writeCommand(${invertDisplay ? "ST77XX_INVON" : "ST77XX_INVOFF"});`,
        `  __tc_display.endWrite();`,
      ];

  return {
    includes,
    declaration: `Adafruit_ST7796S __tc_display = Adafruit_ST7796S(${cs}, ${dc}, ${rst});`,
    functions: [
      `// --- Display adapter: ST7796S (RGB565) ---`,
      `static inline void display_init() {`,
      `  __tc_display.init(320, 480, 0, 0, ${colorOrder});`,
      spiFreq ? `  __tc_display.setSPISpeed(${spiFreq});` : ``,
      ...inversionLines,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.fillScreen(0x0000);`,
      `}`,
      ``,
      `static inline void display_fillScreen(UI_COLOR_T color) { __tc_display.fillScreen(static_cast<uint16_t>(color)); }`,
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
      `  return new (std::nothrow) GFXcanvas16(w, h);`,
      `}`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {`,
      `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
      `  void* mem = ps_malloc(sizeof(GFXcanvas16));`,
      `  if (mem != nullptr) {`,
      `    return new (mem) GFXcanvas16(w, h);`,
      `  }`,
      `  return nullptr;`,
      `#else`,
      `  (void)w; (void)h;`,
      `  return nullptr;`,
      `#endif`,
      `}`,
      // Arduino cores back operator new with malloc(), and free() releases both
      // SRAM and PSRAM objects (ESP32 unified heap), so dtor + free() is the
      // correct teardown for both canvas allocation paths — delete would be UB
      // on the placement-new PSRAM object.
      `static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) {`,
      `  if (canvas == nullptr) { return; }`,
      `  canvas->~GFXcanvas16();`,
      `  free(canvas);`,
      `}`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* canvas) { return canvas->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* canvas) { return canvas->height(); }`,
      `static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* canvas) { return canvas->getBuffer(); }`,
      `static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* canvas, int16_t x, int16_t y) { return canvas->getPixel(x, y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* canvas, UI_COLOR_T color) { canvas->fillScreen(static_cast<uint16_t>(color)); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  canvas->fillRect(x, y, w, h, static_cast<uint16_t>(color));`,
      `}`,
      ``,
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* target, int16_t x, int16_t y, UI_COLOR_T color) { target->drawPixel(x, y, static_cast<uint16_t>(color)); }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* target) { return target->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* target) { return target->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* target, int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {`,
      `  target->drawRGBBitmap(x, y, bitmap, w, h);`,
      `}`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  target->fillRect(x, y, w, h, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, UI_COLOR_T color) {`,
      `  target->drawFastHLine(x, y, w, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t h, UI_COLOR_T color) {`,
      `  target->drawFastVLine(x, y, h, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {`,
      `  target->fillRoundRect(x, y, w, h, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  target->drawRect(x, y, w, h, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {`,
      `  target->drawRoundRect(x, y, w, h, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* target, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) {`,
      `  target->drawLine(x0, y0, x1, y1, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {`,
      `  target->fillCircle(x, y, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {`,
      `  target->drawCircle(x, y, r, static_cast<uint16_t>(color));`,
      `}`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* target, int16_t x, int16_t y) { target->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* target, UI_COLOR_T fg) { target->setTextColor(static_cast<uint16_t>(fg)); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* target, UI_COLOR_T fg, UI_COLOR_T bg) { target->setTextColor(static_cast<uint16_t>(fg), static_cast<uint16_t>(bg)); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* target, uint8_t size) { target->setTextSize(size); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* target, bool wrap) { target->setTextWrap(wrap); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* target, const char* text) { target->print(text); }`,
    ].join("\n"),
  };
};

// ── SSD1309 OLED adapter (1-bit mono, I2C, page-buffered) ───────────────────

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
      `#define SSD1306_NO_SPLASH`,
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
      `  __tc_display.begin(SSD1306_SWITCHCAPVCC, 0x${address.toString(16)});`,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.clearDisplay();`,
      `  __tc_display.display();`,
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
      `static int16_t __ssd1309_addr_x = 0;`,
      `static int16_t __ssd1309_addr_y = 0;`,
      `static int16_t __ssd1309_addr_w = 0;`,
      `static int16_t __ssd1309_addr_h = 0;`,
      `static uint32_t __ssd1309_addr_cursor = 0;`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {`,
      `  __ssd1309_addr_x = x;`,
      `  __ssd1309_addr_y = y;`,
      `  __ssd1309_addr_w = w;`,
      `  __ssd1309_addr_h = h;`,
      `  __ssd1309_addr_cursor = 0;`,
      `}`,
      `static inline void display_writePixels(UI_COLOR_T* pixels, uint32_t count) {`,
      `  // SSD1306 is page-buffered — write into the GFX buffer via drawPixel.`,
      `  if (__ssd1309_addr_w <= 0 || __ssd1309_addr_h <= 0) return;`,
      `  uint32_t windowPixels = static_cast<uint32_t>(__ssd1309_addr_w) * static_cast<uint32_t>(__ssd1309_addr_h);`,
      `  for (uint32_t i = 0; i < count; i++) {`,
      `    if (__ssd1309_addr_cursor >= windowPixels) break;`,
      `    uint32_t pos = __ssd1309_addr_cursor++;`,
      `    int16_t px = static_cast<int16_t>(__ssd1309_addr_x + static_cast<int16_t>(pos % static_cast<uint32_t>(__ssd1309_addr_w)));`,
      `    int16_t py = static_cast<int16_t>(__ssd1309_addr_y + static_cast<int16_t>(pos / static_cast<uint32_t>(__ssd1309_addr_w)));`,
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
      `static inline uint16_t ssd_mono(uint16_t c);`,
      `static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) { return new (std::nothrow) GFXcanvas16(w, h); }`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {`,
      `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
      `  void* mem = ps_malloc(sizeof(GFXcanvas16));`,
      `  if (mem != nullptr) {`,
      `    return new (mem) GFXcanvas16(w, h);`,
      `  }`,
      `  return nullptr;`,
      `#else`,
      `  (void)w; (void)h;`,
      `  return nullptr;`,
      `#endif`,
      `}`,
      // dtor + free() is valid for both allocation paths on Arduino cores
      // (operator new is malloc-backed; free() releases PSRAM via the ESP32
      // unified heap). delete would be UB on the placement-new PSRAM object.
      `static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) {`,
      `  if (canvas == nullptr) { return; }`,
      `  canvas->~GFXcanvas16();`,
      `  free(canvas);`,
      `}`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c->height(); }`,
      `static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* c) { return c->getBuffer(); }`,
      `static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c->getPixel(x, y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* c, UI_COLOR_T color) { c->fillScreen(ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) { c->fillRect(x, y, w, h, ssd_mono(static_cast<uint16_t>(color))); }`,
      // ── Color conversion: runtime uses 0xffff/0x0000 (565 mono snap), but the
      //    SSD1306's drawPixel switch only accepts 0/1/2. Convert any nonzero to 1. ──
      `static inline uint16_t ssd_mono(uint16_t c) { return c ? SSD1306_WHITE : SSD1306_BLACK; }`,
      // ── Target-polymorphic draw (panel + canvas share CuttlefishDisplayTarget*) ──
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x, y, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const UI_COLOR_T* b, int16_t w, int16_t h) {`,
      `  if (!b || w <= 0 || h <= 0) return;`,
      `  for (int16_t yy = 0; yy < h; yy++) {`,
      `    for (int16_t xx = 0; xx < w; xx++) {`,
      `      t->drawPixel(static_cast<int16_t>(x + xx), static_cast<int16_t>(y + yy), ssd_mono(static_cast<uint16_t>(b[static_cast<int32_t>(yy) * w + xx])));`,
      `    }`,
      `  }`,
      `}`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) { t->fillRect(x, y, w, h, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, UI_COLOR_T color) { t->drawFastHLine(x, y, w, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t h, UI_COLOR_T color) { t->drawFastVLine(x, y, h, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) { t->fillRoundRect(x, y, w, h, r, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) { t->drawRect(x, y, w, h, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) { t->drawRoundRect(x, y, w, h, r, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) { t->drawLine(x0, y0, x1, y1, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->fillCircle(x, y, r, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->drawCircle(x, y, r, ssd_mono(static_cast<uint16_t>(color))); }`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { t->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, UI_COLOR_T fg) { t->setTextColor(ssd_mono(static_cast<uint16_t>(fg))); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, UI_COLOR_T fg, UI_COLOR_T bg) { t->setTextColor(ssd_mono(static_cast<uint16_t>(fg)), ssd_mono(static_cast<uint16_t>(bg))); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { t->setTextSize(s); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool w) { t->setTextWrap(w); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); }`,
    ].join("\n"),
  };
};

// ── eink-mono adapter (SSD1680-class, 1-bit, deferred partial refresh) ───────

export const einkMonoAdapter: DisplayAdapterGenerator = (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 0;
  const w = display.width;
  const h = display.height;

  return {
    includes: [
      "#include <Adafruit_GFX.h>",
      "#include <Adafruit_EPD.h>",
    ].join("\n"),
    // busy pin = -1 (unused); SRCS+D/C+RST+CS wiring. Adafruit_SSD168x(width, height, dc, rst, cs, busy).
    declaration: `Adafruit_SSD168x __tc_display(${w}, ${h}, ${dc}, ${rst}, ${cs}, -1);`,
    functions: [
      "// --- Display adapter: eink-mono (SSD1680-class, 1-bit, deferred refresh) ---",
      "static inline void display_init() {",
      "  __tc_display.begin();",
      `  __tc_display.setRotation(${rotation});`,
      "  // No full-screen clear here — e-ink flashes on a full clear. The runtime",
      "  // marks all nodes dirty (UI_REFRESH_DEFERRED) and the first flush repaints",
      "  // via partial refresh instead.",
      "}",
      "",
      "static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }",
      "static inline int16_t display_width() { return __tc_display.width(); }",
      "static inline int16_t display_height() { return __tc_display.height(); }",
      "static inline void display_startWrite() {}",
      "static inline void display_endWrite() {}",
      "static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }",
      // Partial refresh: push just the dirty region. The runtime draws into the
      // EPD's built-in GFX buffer (the display IS the backing store for 1-bit),
      // then calls this with the unioned dirty rect. TODO Phase 5: verify the
      // exact partial-refresh API for the target EPD library.
      "static inline void display_partial_refresh(int16_t x, int16_t y, int16_t w, int16_t h) {",
      "  __tc_display.refreshPartial(x, y, static_cast<uint16_t>(w), static_cast<uint16_t>(h));",
      "}",
      // drawPixel goes through GFX into the EPD buffer; partial_refresh publishes it.
      "static inline void display_fillScreen(uint32_t color) { __tc_display.fillScreen(color ? EPD_WHITE : EPD_BLACK); }",
    ].join("\n"),
  };
};

/**
 * Registry of Adafruit_GFX-based adapters keyed by driver name.
 * ArduinoStrategy.resolveDisplayAdapter dispatches through this map.
 */
export const ADAFRUIT_ADAPTERS: ReadonlyMap<string, DisplayAdapterGenerator> = new Map<string, DisplayAdapterGenerator>([
  ["ili9341", ili9341Adapter],
  ["st7796", st7796Adapter],
  ["ssd1309", ssd1309Adapter],
  ["ssd1680", einkMonoAdapter],
]);
