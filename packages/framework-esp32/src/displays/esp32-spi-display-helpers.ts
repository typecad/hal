// ---------------------------------------------------------------------------
// ESP32 SPI display adapter helpers — shared by ILI9341, ST7796S, SSD1680.
//
// Emits C++ that drives an SPI-attached panel via ESP-IDF's spi_master driver.
// Uses a dedicated spi_device_handle_t (__tc_spi_display_dev) separate from
// user SPI device handles so a display and SPI sensors can coexist on the
// same bus.
//
// Bus ownership: .spics_io_num = -1 on the device config, so the SPI driver
// does NOT toggle CS. The adapter toggles CS itself via gpio_set_level
// before/after each transaction. DC pin is likewise a separate GPIO the
// adapter drives (low = command, high = data).
//
// Headers: this module emits the transport #includes (driver/spi_master.h,
// driver/gpio.h) in the returned `includes` string so the adapter is
// self-contained — the strategy's forcedIncludes doesn't need to know that
// the active display uses SPI.
// ---------------------------------------------------------------------------

import type { ResolvedDisplay } from "@typecad/cuttlefish/api/shared";

/**
 * The C++ #include lines every ESP32 SPI display needs. Appended to the
 * adapter's own `includes` block.
 */
export function esp32SpiDisplayIncludes(): string {
  return [
    `#include "driver/spi_master.h"`,
    `#include "driver/gpio.h"`,
  ].join("\n");
}

/**
 * The C++ state block emitted before the adapter functions. Declares the
 * dedicated SPI device handle + the GPIO pin numbers for CS/DC/RST.
 */
export function esp32SpiDisplayState(display: ResolvedDisplay, controllerIndex: number): string {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  return [
    `// ESP32 display SPI state — dedicated device handle, separate from user SPI devices.`,
    `struct __Esp32SpiDisplayCtx {`,
    `  spi_device_handle_t dev;`,
    `  int cs_pin;`,
    `  int dc_pin;`,
    `  int rst_pin;`,
    `  int16_t width;`,
    `  int16_t height;`,
    `  bool ready;`,
    `};`,
    `static __Esp32SpiDisplayCtx __esp32_display = {`,
    `  /*.dev=*/    NULL,`,
    `  /*.cs_pin=*/ ${cs},`,
    `  /*.dc_pin=*/ ${dc},`,
    `  /*.rst_pin=*/ ${rst},`,
    `  /*.width=*/  0,  // set in display_init`,
    `  /*.height=*/ 0,`,
    `  /*.ready=*/  false,`,
    `};`,
    `// Forward-declare the panel-ops struct so __tc_display can reference it`,
    `// before the function-pointer definitions (in functions block) are emitted.`,
    `// 'extern' is the correct linkage here — the actual definition (with`,
    `// initializers) lives in the functions block below.`,
    `struct CuttlefishPanelOps;`,
    `extern const CuttlefishPanelOps __esp32_display_ops;`,
  ].join("\n");
}

/**
 * The C++ bus init block emitted inside display_init(). Initializes the SPI
 * host controller once (idempotent via __esp32_display_bus_ready), then adds
 * a device at the requested clock/mode.
 *
 * Caller passes the chip's SPI controller config (host enum + default pins).
 */
export function esp32SpiBusInit(
  controllerIndex: number,
  hostEnum: string,
  mosiPin: number,
  sclkPin: number,
  misoPin: number,
  spiHz: number,
  spiMode: number,
): string {
  return [
    `// Initialize SPI bus + add display device (idempotent).`,
    `{`,
    `  static bool __esp32_display_bus_ready = false;`,
    `  if (!__esp32_display_bus_ready) {`,
    `    // IDF v6's spi_bus_config_t contains anonymous union members that trip`,
    `    // -Werror=missing-field-initializers under any brace initialization in`,
    `    // C++ (even {0}). Suppress the warning for this block only.`,
    `#pragma GCC diagnostic push`,
    `#pragma GCC diagnostic ignored "-Wmissing-field-initializers"`,
    `    spi_bus_config_t buscfg = {`,
    `      .mosi_io_num = ${mosiPin},`,
    `      .miso_io_num = ${misoPin < 0 ? -1 : misoPin},`,
    `      .sclk_io_num = ${sclkPin},`,
    `      .quadwp_io_num = -1,`,
    `      .quadhd_io_num = -1,`,
    `    };`,
    `    // Field order matches spi_device_interface_config_t declaration`,
    `    // (C++ requires designators in declaration order):`,
    `    //   mode → clock_speed_hz → spics_io_num → queue_size.`,
    `    spi_device_interface_config_t devcfg = {`,
    `      .mode = ${spiMode},`,
    `      .clock_speed_hz = ${spiHz},`,
    `      .spics_io_num = -1,  // CS driven manually via gpio_set_level`,
    `      .queue_size = 4,`,
    `    };`,
    `#pragma GCC diagnostic pop`,
    `    esp_err_t _r = spi_bus_initialize(${hostEnum}, &buscfg, SPI_DMA_CH_AUTO);`,
    `    (void)_r;`,
    `    __esp32_display_bus_ready = true;`,
    `    if (!__esp32_display.dev) {`,
    `      spi_bus_add_device(${hostEnum}, &devcfg, &__esp32_display.dev);`,
    `    }`,
    `  } else if (!__esp32_display.dev) {`,
    `#pragma GCC diagnostic push`,
    `#pragma GCC diagnostic ignored "-Wmissing-field-initializers"`,
    `    spi_device_interface_config_t devcfg = {`,
    `      .mode = ${spiMode},`,
    `      .clock_speed_hz = ${spiHz},`,
    `      .spics_io_num = -1,`,
    `      .queue_size = 4,`,
    `    };`,
    `#pragma GCC diagnostic pop`,
    `    spi_bus_add_device(${hostEnum}, &devcfg, &__esp32_display.dev);`,
    `  }`,
    `  __esp32_display.ready = true;`,
    `}`,
  ].join("\n");
}

/**
 * The C++ helper functions emitted before the adapter surface: cmd/data
 * transfers via spi_device_polling_transmit with software CS/DC control.
 */
export function esp32SpiCmdDataHelpers(): string {
  return [
    `// Send a single command byte (DC low).`,
    `static inline void __esp32_spi_cmd(uint8_t c) {`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 0);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `  spi_transaction_t t = {};`,
    `  t.length = 8;`,
    `  t.tx_buffer = &c;`,
    `  spi_device_polling_transmit(__esp32_display.dev, &t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    ``,
    `// Send a single data byte (DC high).`,
    `static inline void __esp32_spi_data1(uint8_t d) {`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `  spi_transaction_t t = {};`,
    `  t.length = 8;`,
    `  t.tx_buffer = &d;`,
    `  spi_device_polling_transmit(__esp32_display.dev, &t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    ``,
    `// Send a command followed by N data bytes. The entire cmd+data sequence`,
    `// happens in a SINGLE CS-low window — CS must NOT rise between the command`,
    `// byte and the data bytes, or the panel treats the data as a new command.`,
    `// (Adafruit_SPITFT::sendCommand does the same: one CS-low for the whole`,
    `// transaction.)`,
    `static inline void __esp32_spi_cmd_data(const uint8_t* bytes, uint8_t n) {`,
    `  // First byte is the command (DC low); remaining are data (DC high).`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 0);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `  spi_transaction_t cmd_t = {};`,
    `  cmd_t.length = 8;`,
    `  cmd_t.tx_buffer = &bytes[0];`,
    `  spi_device_polling_transmit(__esp32_display.dev, &cmd_t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);`,
    `  for (uint8_t i = 1; i < n; i++) {`,
    `    spi_transaction_t t = {};`,
    `    t.length = 8;`,
    `    t.tx_buffer = &bytes[i];`,
    `    spi_device_polling_transmit(__esp32_display.dev, &t);`,
    `  }`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    ``,
    `// Pulse the RST pin low for 10 ms then high — called once in display_init.`,
    `static inline void __esp32_spi_reset() {`,
    `  if (__esp32_display.rst_pin < 0) return;`,
    `  gpio_set_direction((gpio_num_t)__esp32_display.rst_pin, GPIO_MODE_OUTPUT);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.rst_pin, 0);`,
    `  vTaskDelay(pdMS_TO_TICKS(10));`,
    `  gpio_set_level((gpio_num_t)__esp32_display.rst_pin, 1);`,
    `  vTaskDelay(pdMS_TO_TICKS(10));`,
    `}`,
  ].join("\n");
}

/**
 * The panel-ops struct + writePixel/fillRect/setAddrWindow/writePixels ops
 * for an SPI-driven RGB565 TFT (ILI9341, ST7796S).
 *
 * setAddrWindow sends 0x2A (column) + 0x2B (page) + 0x2C (write) — standard
 * for ILI9341-class controllers. writePixels streams RGB565 big-endian.
 */
export function esp32SpiPanelOps(addrWindowCmds: "ili9341" | "st7796"): string {
  const colCmd = "0x2A";
  const pageCmd = "0x2B";
  const writeCmd = "0x2C";
  return [
    `// ── Panel-ops consumed by CuttlefishGFX ─────────────────────────────────`,
    `static void __esp32_op_startWrite(void* /*ctx*/) {`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `}`,
    `static void __esp32_op_endWrite(void* /*ctx*/) {`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    `static void __esp32_op_setAddrWindow(void* /*ctx*/, int16_t x, int16_t y, int16_t w, int16_t h) {`,
    `  uint32_t xs = (uint32_t)x, xe = (uint32_t)(x + w - 1);`,
    `  uint32_t ys = (uint32_t)y, ye = (uint32_t)(y + h - 1);`,
    `  uint8_t col[5]  = { ${colCmd}, (uint8_t)(xs >> 8), (uint8_t)(xs & 0xFF), (uint8_t)(xe >> 8), (uint8_t)(xe & 0xFF) };`,
    `  uint8_t page[5] = { ${pageCmd}, (uint8_t)(ys >> 8), (uint8_t)(ys & 0xFF), (uint8_t)(ye >> 8), (uint8_t)(ye & 0xFF) };`,
    `  __esp32_spi_cmd_data(col, 5);`,
    `  __esp32_spi_cmd_data(page, 5);`,
    `  // NOTE: do NOT send RAMWR (0x2C) here. The caller (writePixels/fillRect/`,
    `  // writePixel) sends RAMWR + pixel data in a SINGLE CS-low window. If RAMWR`,
    `  // were sent here via __esp32_spi_cmd, CS would rise between RAMWR and the`,
    `  // pixel data, terminating the write window — the panel would ignore the`,
    `  // pixels and stay in its previous state (the white-screen bug).`,
    `}`,
    `static void __esp32_op_writePixels(void* /*ctx*/, const uint16_t* px, uint32_t n) {`,
    `  // Stream RGB565 big-endian (high byte first, per ILI9341/ST7796 datasheet).`,
    `  // RAMWR + pixel data in a SINGLE CS-low window (CS must not rise between`,
    `  // RAMWR and pixels or the panel terminates the write window).`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `  uint8_t ramwr = ${writeCmd};`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 0);  // command`,
    `  spi_transaction_t cmd_t = {};`,
    `  cmd_t.length = 8; cmd_t.tx_buffer = &ramwr;`,
    `  spi_device_polling_transmit(__esp32_display.dev, &cmd_t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);  // data follows`,
    `  uint32_t remaining = n;`,
    `  const uint16_t* p = px;`,
    `  while (remaining > 0) {`,
    `    uint32_t chunk = remaining > 1024 ? 1024 : remaining;`,
    `    uint8_t buf[2048];`,
    `    for (uint32_t i = 0; i < chunk; i++) {`,
    `      buf[i * 2]     = (uint8_t)(*p >> 8);    // high byte first`,
    `      buf[i * 2 + 1] = (uint8_t)(*p & 0xFF);`,
    `      p++;`,
    `    }`,
    `    spi_transaction_t t = {};`,
    `    t.length = chunk * 16;`,
    `    t.tx_buffer = buf;`,
    `    spi_device_polling_transmit(__esp32_display.dev, &t);`,
    `    remaining -= chunk;`,
    `  }`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    `static void __esp32_op_writePixel(void* /*ctx*/, int16_t x, int16_t y, uint16_t c) {`,
    `  __esp32_op_setAddrWindow(NULL, x, y, 1, 1);`,
    `  // RAMWR + pixel in one CS-low window.`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `  uint8_t ramwr = ${writeCmd};`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 0);`,
    `  spi_transaction_t cmd_t = {};`,
    `  cmd_t.length = 8; cmd_t.tx_buffer = &ramwr;`,
    `  spi_device_polling_transmit(__esp32_display.dev, &cmd_t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);`,
    `  uint16_t swapped = __builtin_bswap16(c);  // big-endian on wire`,
    `  spi_transaction_t t = {};`,
    `  t.length = 16;`,
    `  t.tx_buffer = &swapped;`,
    `  spi_device_polling_transmit(__esp32_display.dev, &t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    `static void __esp32_op_fillRect(void* /*ctx*/, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) {`,
    `  __esp32_op_setAddrWindow(NULL, x, y, w, h);`,
    `  uint32_t n = (uint32_t)w * (uint32_t)h;`,
    `  // RAMWR + pixel data in a SINGLE CS-low window.`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 0);`,
    `  uint8_t ramwr = ${writeCmd};`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 0);`,
    `  spi_transaction_t cmd_t = {};`,
    `  cmd_t.length = 8; cmd_t.tx_buffer = &ramwr;`,
    `  spi_device_polling_transmit(__esp32_display.dev, &cmd_t);`,
    `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);`,
    `  uint16_t swapped = __builtin_bswap16(c);  // big-endian on wire`,
    `  uint8_t buf[2048];`,
    `  for (uint16_t i = 0; i < 1024; i++) {`,
    `    buf[i * 2]     = (uint8_t)(swapped >> 8);`,
    `    buf[i * 2 + 1] = (uint8_t)(swapped & 0xFF);`,
    `  }`,
    `  while (n > 0) {`,
    `    uint32_t chunk = n > 1024 ? 1024 : n;`,
    `    spi_transaction_t t = {};`,
    `    t.length = chunk * 16;`,
    `    t.tx_buffer = buf;`,
    `    spi_device_polling_transmit(__esp32_display.dev, &t);`,
    `    n -= chunk;`,
    `  }`,
    `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
    `}`,
    `static int16_t __esp32_op_width(void* /*ctx*/)  { return __esp32_display.width; }`,
    `static int16_t __esp32_op_height(void* /*ctx*/) { return __esp32_display.height; }`,
    ``,
      `const CuttlefishPanelOps __esp32_display_ops = {`,
      `  __esp32_op_startWrite,`,
      `  __esp32_op_endWrite,`,
      `  __esp32_op_setAddrWindow,`,
      `  __esp32_op_writePixels,`,
      `  __esp32_op_writePixel,`,
      `  __esp32_op_fillRect,`,
      `  __esp32_op_width,`,
      `  __esp32_op_height,`,
      `  nullptr,  // flush — direct-mode panel, no backing store`,
      `};`,
  ].join("\n");
}

/**
 * The display_* adapter surface — forwarders into the CuttlefishGFX instance
 * backed by __esp32_display_ops. This is the canonical list the runtime
 * ui_display_* shim layer calls (RGB565 variant for SPI TFTs).
 */
export function esp32SpiAdapterSurface(): string {
  return [
    `static inline void display_startWrite() { __esp32_op_startWrite(NULL); }`,
    `static inline void display_endWrite()   { __esp32_op_endWrite(NULL); }`,
    `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {`,
    `  __esp32_op_setAddrWindow(NULL, x, y, w, h);`,
    `}`,
    `static inline void display_writePixels(uint16_t* pixels, uint32_t count) {`,
    `  __esp32_op_writePixels(NULL, pixels, count);`,
    `}`,
    ``,
    `static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) {`,
    `  return new CuttlefishCanvas16(w, h);`,
    `}`,
    `static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {`,
    `#if defined(ESP32) && defined(BOARD_HAS_PSRAM)`,
    `  return new (ps_malloc(sizeof(CuttlefishCanvas16))) CuttlefishCanvas16(w, h);`,
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
    `static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {`,
    `  c->fillRect(x, y, w, h, (uint16_t)color);`,
    `}`,
    ``,
    `// ── Target-polymorphic draw ─────────────────────────────────────────────`,
    `static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x, y, (uint16_t)color); }`,
    `static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }`,
    `static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }`,
    `static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {`,
    `  t->drawRGBBitmap(x, y, bitmap, w, h);  // CuttlefishGFX draws via ops->writePixels`,
    `}`,
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
    `static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool wp) { t->setTextWrap(wp); }`,
    `static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); }`,
  ].join("\n");
}
