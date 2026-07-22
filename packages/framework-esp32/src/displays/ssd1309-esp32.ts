// ---------------------------------------------------------------------------
// ESP32 native SSD1309 display adapter — 1-bit monochrome OLED over I2C.
//
// Drives the panel through ESP-IDF's i2c_master driver via a dedicated
// bus + device handle (__esp32_i2c_display_*), separate from user I2C
// devices so a display and I2C sensors coexist.
//
// ──── BSD-3-Clause attribution ────────────────────────────────────────────
// The SSD1306/SSD1309 panel init command table emitted by this adapter is
// transcribed from Adafruit's Adafruit_SSD1306 library:
//
//   Adafruit_SSD1306.cpp ssd1306_128x64_i2c_init[]
//   Copyright (c) 2013 Adafruit Industries. All rights reserved.
//   Licensed under BSD-3-Clause.
//   Upstream: https://github.com/adafruit/Adafruit_SSD1306
//
// The init bytes themselves are manufacturer (Solomon Systech) reference
// code from the SSD1306/SSD1309 datasheet. The transcription here is from
// Adafruit's published source.
// ──── End BSD-3-Clause attribution ────────────────────────────────────────
//
// Memory model: page-buffered. 128x64 mono = 1024 bytes. The buffer is the
// backing store; draws go into it, then display_partial_refresh flushes it
// over I2C.
//
// CRITICAL: the existing __tc_i2cN_txbuf is 32 bytes — too small for any
// framebuffer flush. This adapter calls i2c_master_transmit directly with a
// larger flush buffer rather than going through __tc_i2cN_txbuf.
//
// SSD1306 and SSD1309 share the same command set for our purposes.
// ---------------------------------------------------------------------------

import type { DisplayAdapterGenerator } from "@typecad/cuttlefish/api/shared";

export const esp32Ssd1309Adapter: DisplayAdapterGenerator = (display) => {
  const w = display.width;
  const h = display.height;
  const address = display._mountAddress ?? 0x3c;
  const addrHex = "0x" + address.toString(16);
  const bufferSize = (w * h) / 8;

  return {
    includes: [
      `// --- ESP32 SSD1309 driver (1-bit mono, I2C via i2c_master) ---`,
      `// No vendor GFX library, no Arduino Wire header.`,
      `#define CuttlefishDisplayTarget CuttlefishGFX`,
      `#define CuttlefishCanvas16 CuttlefishCanvas16`,
    ].join("\n"),

    declaration: [
      `// ESP32 display I2C state — device handle on the shared I2C bus.`,
      `// The bus itself is created/fetched via __esp32_i2c_bus_get(0) so the`,
      `// display, touch, and user I2C share one bus handle (B1 fix).`,
      `struct __Esp32I2cDisplayCtx {`,
      `  i2c_master_dev_handle_t dev;`,
      `  int16_t width;`,
      `  int16_t height;`,
      `};`,
      `static __Esp32I2cDisplayCtx __esp32_i2c_display = { NULL, 0, 0 };`,
      `// 1KB page buffer for ${w}x${h} mono panel.`,
      `static uint8_t __ssd1309_buffer[${bufferSize}];`,
      `// Flush buffer — first byte is the SSD1306 control byte 0x40 (data stream),`,
      `// followed by up to 16 column bytes. We send 17 bytes per transmission.`,
      `// (1KB / 16 = 64 transmissions — standard page-buffered I2C flush.)`,
      `static uint8_t __ssd1309_flush_buf[17];`,
      `// Forward-declare the ops struct so __tc_display can reference it.`,
      `static const CuttlefishPanelOps __esp32_ssd_ops;`,
      `CuttlefishGFX __tc_display(&__esp32_ssd_ops, &__esp32_i2c_display);`,
    ].join("\n"),

    functions: [
      `// Send a single command byte over I2C.`,
      `static inline void __esp32_ssd1309_cmd(uint8_t c) {`,
      `  uint8_t buf[2] = { 0x00, c };  // control byte 0x00 = command`,
      `  i2c_master_transmit(__esp32_i2c_display.dev, buf, 2, -1);`,
      `}`,
      ``,
      `// ── Panel-ops (consumed by CuttlefishGFX) ─────────────────────────────`,
      `static void __esp32_ssd_op_startWrite(void* /*ctx*/) {}`,
      `static void __esp32_ssd_op_endWrite(void* /*ctx*/) {}`,
      `static void __esp32_ssd_op_setAddrWindow(void* /*ctx*/, int16_t x, int16_t y, int16_t ww, int16_t hh) {`,
      `  (void)x; (void)y; (void)ww; (void)hh;`,
      `}`,
      `static void __esp32_ssd_op_writePixels(void* /*ctx*/, const uint16_t* px, uint32_t n) {`,
      `  (void)px; (void)n;  // page-buffered; runtime uses writePixel`,
      `}`,
      `static void __esp32_ssd_op_writePixel(void* /*ctx*/, int16_t x, int16_t y, uint16_t c) {`,
      `  if (x < 0 || y < 0 || x >= ${w} || y >= ${h}) return;`,
      `  uint16_t page = (uint16_t)(y >> 3);`,
      `  uint8_t mask = (uint8_t)(1u << (y & 7));`,
      `  uint16_t idx = (uint16_t)(page * ${w} + x);`,
      `  if (c) __ssd1309_buffer[idx] |= mask;`,
      `  else   __ssd1309_buffer[idx] &= ~mask;`,
      `}`,
      `static void __esp32_ssd_op_fillRect(void* ctx, int16_t x, int16_t y, int16_t ww, int16_t hh, uint16_t c) {`,
      `  for (int16_t j = y; j < y + hh; j++) {`,
      `    for (int16_t i = x; i < x + ww; i++) {`,
      `      __esp32_ssd_op_writePixel(ctx, i, j, c);`,
      `    }`,
      `  }`,
      `}`,
      `static int16_t __esp32_ssd_op_width(void* /*ctx*/)  { return __esp32_i2c_display.width; }`,
      `static int16_t __esp32_ssd_op_height(void* /*ctx*/) { return __esp32_i2c_display.height; }`,
      `static void __esp32_ssd_op_flush(void* /*ctx*/, int16_t x, int16_t y, int16_t ww, int16_t hh) {`,
      `  (void)x; (void)y; (void)ww; (void)hh;`,
      `  // Set column + page range, then stream the buffer in 16-byte chunks.`,
      `  __esp32_ssd1309_cmd(0x21);`,
      `  __esp32_ssd1309_cmd(0x00);`,
      `  __esp32_ssd1309_cmd(${w - 1} & 0xFF);`,
      `  __esp32_ssd1309_cmd(0x22);`,
      `  __esp32_ssd1309_cmd(0x00);`,
      `  __esp32_ssd1309_cmd(${(h - 1) / 8} & 0xFF);`,
      `  // CRITICAL: __tc_i2cN_txbuf is only 32 bytes. We bypass it by calling`,
      `  // i2c_master_transmit directly with our own larger buffer.`,
      `  uint16_t sent = 0;`,
      `  while (sent < ${bufferSize}) {`,
      `    uint16_t chunk = (${bufferSize} - sent > 16) ? 16 : (${bufferSize} - sent);`,
      `    __ssd1309_flush_buf[0] = 0x40;  // control byte: data`,
      `    for (uint16_t i = 0; i < chunk; i++) {`,
      `      __ssd1309_flush_buf[1 + i] = __ssd1309_buffer[sent + i];`,
      `    }`,
      `    i2c_master_transmit(__esp32_i2c_display.dev, __ssd1309_flush_buf, chunk + 1, -1);`,
      `    sent += chunk;`,
      `  }`,
      `}`,
      ``,
      `static const CuttlefishPanelOps __esp32_ssd_ops = {`,
      `  __esp32_ssd_op_startWrite,`,
      `  __esp32_ssd_op_endWrite,`,
      `  __esp32_ssd_op_setAddrWindow,`,
      `  __esp32_ssd_op_writePixels,`,
      `  __esp32_ssd_op_writePixel,`,
      `  __esp32_ssd_op_fillRect,`,
      `  __esp32_ssd_op_width,`,
      `  __esp32_ssd_op_height,`,
      `  __esp32_ssd_op_flush,`,
      `};`,
      ``,
      `// ── display_* adapter surface ──────────────────────────────────────────`,
      `static inline void display_init() {`,
      `  // Fetch the shared I2C bus handle (created idempotently by the store).`,
      `  i2c_master_bus_handle_t bus = __esp32_i2c_bus_get(0);`,
      `  if (!__esp32_i2c_display.dev) {`,
      `    i2c_device_config_t dcfg = {};`,
      `    dcfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;`,
      `    dcfg.device_address = ${addrHex};`,
      `    dcfg.scl_speed_hz = 400000;`,
      `    i2c_master_bus_add_device(bus, &dcfg, &__esp32_i2c_display.dev);`,
      `  }`,
      `  __esp32_i2c_display.width  = ${w};`,
      `  __esp32_i2c_display.height = ${h};`,
      `  static const uint8_t init_cmds[] = {`,
      `    0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0x8D, 0x14,`,
      `    0x20, 0x00, 0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xCF, 0xD9, 0xF1,`,
      `    0xDB, 0x40, 0xA4, 0xA6, 0xAF,`,
      `  };`,
      `  for (size_t i = 0; i < sizeof(init_cmds); i++) __esp32_ssd1309_cmd(init_cmds[i]);`,
      `  memset(__ssd1309_buffer, 0, ${bufferSize});`,
      `}`,
      ``,
      `static inline void display_fillScreen(UI_COLOR_T color) {`,
      `  memset(__ssd1309_buffer, color ? 0xFF : 0x00, ${bufferSize});`,
      `}`,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width()  { return ${w}; }`,
      `static inline int16_t display_height() { return ${h}; }`,
      `static inline void display_startWrite() {}`,
      `static inline void display_endWrite() {}`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t ww, int16_t hh) {`,
      `  __esp32_ssd_op_setAddrWindow(NULL, x, y, ww, hh);`,
      `}`,
      `static inline void display_writePixels(UI_COLOR_T* pixels, uint32_t count) {`,
      `  __esp32_ssd_op_writePixels(NULL, pixels, count);`,
      `}`,
      `static inline void display_partial_refresh(int16_t x, int16_t y, int16_t ww, int16_t hh) {`,
      `  __esp32_ssd_op_flush(NULL, x, y, ww, hh);`,
      `}`,
      ``,
      `static inline uint16_t ssd_mono(uint16_t c);`,
      `static inline CuttlefishCanvas16* display_createCanvas(int16_t cw, int16_t ch) { return new CuttlefishCanvas16(cw, ch); }`,
      `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t cw, int16_t ch) {`,
      `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
      `  return new (ps_malloc(sizeof(CuttlefishCanvas16))) CuttlefishCanvas16(cw, ch);`,
      `#else`,
      `  (void)cw; (void)ch;`,
      `  return nullptr;`,
      `#endif`,
      `}`,
      `static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) { delete canvas; }`,
      `static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c->width(); }`,
      `static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c->height(); }`,
      `static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* c) { return c->getBuffer(); }`,
      `static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c->getPixel(x, y); }`,
      `static inline void display_canvasFillScreen(CuttlefishCanvas16* c, UI_COLOR_T color) { c->fillScreen((uint16_t)color); }`,
      `static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t ww, int16_t hh, UI_COLOR_T color) {`,
      `  c->fillRect(x, y, ww, hh, (uint16_t)color);`,
      `}`,
      ``,
      `static inline uint16_t ssd_mono(uint16_t c) { return c ? 0xFFFFu : 0x0000u; }`,
      ``,
      `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x, y, ssd_mono((uint16_t)color)); }`,
      `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }`,
      `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }`,
      `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const UI_COLOR_T* b, int16_t bw, int16_t bh) {`,
      `  if (!b || bw <= 0 || bh <= 0) return;`,
      `  for (int16_t yy = 0; yy < bh; yy++) {`,
      `    for (int16_t xx = 0; xx < bw; xx++) {`,
      `      t->drawPixel((int16_t)(x + xx), (int16_t)(y + yy), ssd_mono((uint16_t)b[(int32_t)yy * bw + xx]));`,
      `    }`,
      `  }`,
      `}`,
      `static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t ww, int16_t hh, UI_COLOR_T color) { t->fillRect(x, y, ww, hh, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t ww, UI_COLOR_T color) { t->drawFastHLine(x, y, ww, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t hh, UI_COLOR_T color) { t->drawFastVLine(x, y, hh, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t ww, int16_t hh, int16_t r, UI_COLOR_T color) { t->fillRoundRect(x, y, ww, hh, r, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t ww, int16_t hh, UI_COLOR_T color) { t->drawRect(x, y, ww, hh, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t ww, int16_t hh, int16_t r, UI_COLOR_T color) { t->drawRoundRect(x, y, ww, hh, r, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) { t->drawLine(x0, y0, x1, y1, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->fillCircle(x, y, r, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->drawCircle(x, y, r, ssd_mono((uint16_t)color)); }`,
      `static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { t->setCursor(x, y); }`,
      `static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, UI_COLOR_T fg) { t->setTextColor(ssd_mono((uint16_t)fg)); }`,
      `static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, UI_COLOR_T fg, UI_COLOR_T bg) { t->setTextColor(ssd_mono((uint16_t)fg), ssd_mono((uint16_t)bg)); }`,
      `static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { t->setTextSize(s); }`,
      `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool wp) { t->setTextWrap(wp); }`,
      `static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); }`,
    ].join("\n"),
  };
};
