// ---------------------------------------------------------------------------
// ST7796S display adapter — targets the Adafruit_ST7735_and_ST7789_Library
// fork that exposes the Adafruit_ST7796S class (320×480 SPI TFT).
//
// Color mode: RGB565 only. The Adafruit_ST7796S init sequence hardcodes
// ST77XX_COLMOD = 0x55 (16-bit/pixel). RGB666/18-bit would require patching
// the library's init array (0x55 → 0x66) AND overriding Adafruit_SPITFT's
// 565-native writePixels — out of scope for v1. Requesting rgb666 throws.
//
// Init API: Adafruit_ST7796S requires init(w,h,rowOff,colOff,colorOrder) to
// send the panel init sequence. begin(freq) alone would skip it (blank panel).
// SPI frequency handling: init() internally calls commonInit()→begin() (no
// arg), which clobbers any prior freq to SPI_DEFAULT_FREQ (8 MHz). To honor
// spiFrequency we call begin(freq) AFTER init() — this re-runs initSPI with
// the user's value. The official ST7796S_demo.ino skips this and accepts the
// default; our explicit begin(freq) is a deliberate, safe optimization.
// ---------------------------------------------------------------------------

import type { DisplayAdapterGenerator } from "../display-adapter.js";

export const st7796Adapter: DisplayAdapterGenerator = (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 1;
  const spiFreq = display.spiFrequency;

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

  return {
    includes,
    declaration: `Adafruit_ST7796S __tc_display = Adafruit_ST7796S(${cs}, ${dc}, ${rst});`,
    functions: [
      `// --- Display adapter: ST7796S (RGB565) ---`,
      `static inline void display_init() {`,
      `  __tc_display.init(320, 480, 0, 0, ST7796S_RGB);`,
      spiFreq ? `  __tc_display.begin(${spiFreq});` : ``,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.fillScreen(0x0000);`,
      `}`,
      ``,
      `static inline void display_fillScreen(UI_COLOR_T color) { __tc_display.fillScreen((uint16_t)color); }`,
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
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* canvas, UI_COLOR_T color) { canvas->fillScreen((uint16_t)color); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  canvas->fillRect(x, y, w, h, (uint16_t)color);`,
      `}`,
      ``,
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* target, int16_t x, int16_t y, UI_COLOR_T color) { target->drawPixel(x, y, (uint16_t)color); }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* target) { return target->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* target) { return target->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* target, int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {`,
      `  target->drawRGBBitmap(x, y, bitmap, w, h);`,
      `}`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  target->fillRect(x, y, w, h, (uint16_t)color);`,
      `}`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, UI_COLOR_T color) {`,
      `  target->drawFastHLine(x, y, w, (uint16_t)color);`,
      `}`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t h, UI_COLOR_T color) {`,
      `  target->drawFastVLine(x, y, h, (uint16_t)color);`,
      `}`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {`,
      `  target->fillRoundRect(x, y, w, h, r, (uint16_t)color);`,
      `}`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
      `  target->drawRect(x, y, w, h, (uint16_t)color);`,
      `}`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {`,
      `  target->drawRoundRect(x, y, w, h, r, (uint16_t)color);`,
      `}`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* target, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) {`,
      `  target->drawLine(x0, y0, x1, y1, (uint16_t)color);`,
      `}`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {`,
      `  target->fillCircle(x, y, r, (uint16_t)color);`,
      `}`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {`,
      `  target->drawCircle(x, y, r, (uint16_t)color);`,
      `}`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* target, int16_t x, int16_t y) { target->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* target, UI_COLOR_T fg) { target->setTextColor((uint16_t)fg); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* target, UI_COLOR_T fg, UI_COLOR_T bg) { target->setTextColor((uint16_t)fg, (uint16_t)bg); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* target, uint8_t size) { target->setTextSize(size); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* target, bool wrap) { target->setTextWrap(wrap); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* target, const char* text) { target->print(text); }`,
    ].join("\n"),
  };
};
