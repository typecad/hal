// ---------------------------------------------------------------------------
// eink-mono display adapter — 1-bit B&W e-ink panels (SSD1680-class, e.g. the
// common 296×128 / 250×122 breakouts). Deferred refresh: no fillScreen on init
// (a full clear flashes), and a partial-refresh entry point the runtime's dirty-
// rect union calls once per frame.
//
// Library note: targets Adafruit_EPD (Adafruit_SSD168x). The exact partial-
// refresh method name varies by library (Adafruit_EPD: refreshPartial / GxEPD:
// updateWindow). Verify against the target library before flashing — the shim
// shape is correct; the method call is library-specific. TODO Phase 5.
// ---------------------------------------------------------------------------

import type { DisplayAdapterGenerator } from "../display-adapter.js";

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
      "  __tc_display.refreshPartial(x, y, (uint16_t)w, (uint16_t)h);",
      "}",
      // drawPixel goes through GFX into the EPD buffer; partial_refresh publishes it.
      "static inline void display_fillScreen(uint32_t color) { __tc_display.fillScreen(color ? EPD_WHITE : EPD_BLACK); }",
    ].join("\n"),
  };
};
