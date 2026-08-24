// Host probe stubs: minimal Adafruit-GFX-shaped display/canvas so the
// cuttlefish runtime header can run on the desktop. Everything renders into
// in-memory RGB565 buffers; band pushes copy rows. Text glyphs are synthetic
// (deterministic per-char patterns) — enough to see WHERE text painted.
#pragma once
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdlib>

// Probe instrumentation counters.
static uint32_t probeFillCalls = 0;
static int probeInScreenBands = 0;
static uint32_t probePrintCalls = 0;
static uint32_t probeWritePixelsCalls = 0;
static uint32_t probeSetAddrWindowCalls = 0;

class CuttlefishDisplayTarget {
 public:
  int16_t w;
  int16_t h;
  uint16_t* buf;  // RGB565, row-major, owned
  int16_t cursorX = 0;
  int16_t cursorY = 0;
  uint16_t textFg = 0xFFFF;
  uint16_t textBg = 0x0000;
  uint8_t textTs = 1;
  bool wrap = false;
  explicit CuttlefishDisplayTarget(int16_t width, int16_t height)
      : w(width), h(height), buf(new uint16_t[static_cast<uint32_t>(width) * height]()) {}
  virtual ~CuttlefishDisplayTarget() { delete[] buf; }
  void setPx(int16_t x, int16_t y, uint16_t c) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    buf[static_cast<uint32_t>(y) * w + x] = c;
  }
  uint16_t getPx(int16_t x, int16_t y) const {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return buf[static_cast<uint32_t>(y) * w + x];
  }
  void fillRectRaw(int16_t x, int16_t y, int16_t fw, int16_t fh, uint16_t c) {
    for (int16_t yy = y; yy < y + fh; yy++)
      for (int16_t xx = x; xx < x + fw; xx++) setPx(xx, yy, c);
  }
};

class CuttlefishCanvas16 : public CuttlefishDisplayTarget {
 public:
  CuttlefishCanvas16(int16_t width, int16_t height) : CuttlefishDisplayTarget(width, height) {}
};

static CuttlefishDisplayTarget* probeHostDisplay() {
  static CuttlefishDisplayTarget* d = new CuttlefishDisplayTarget(480, 320);
  return d;
}

static inline CuttlefishDisplayTarget* display_defaultTarget() { return probeHostDisplay(); }
static inline int16_t display_width() { return probeHostDisplay()->w; }
static inline int16_t display_height() { return probeHostDisplay()->h; }
static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t ? t->w : 0; }
static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t ? t->h : 0; }

static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) { if (t) { probeFillCalls++; if (t != probeHostDisplay() && t->w == 460) fprintf(stderr, "[cfill] buf=%p x=%d y=%d w=%d h=%d c=%04x\n", (void*)t->buf, x, y, w, h, c); t->fillRectRaw(x, y, w, h, c); } }
static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) {
  if (!t) return;
  t->fillRectRaw(x, y, w, 1, c);
  t->fillRectRaw(x, y + h - 1, w, 1, c);
  t->fillRectRaw(x, y, 1, h, c);
  t->fillRectRaw(x + w - 1, y, 1, h, c);
}
static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, uint16_t c) { if (t) t->fillRectRaw(x, y, w, 1, c); }
static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t h, uint16_t c) { if (t) t->fillRectRaw(x, y, 1, h, c); }
static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) {
  if (!t) return;
  int16_t dx = x1 > x0 ? x1 - x0 : x0 - x1;
  int16_t dy = y1 > y0 ? y1 - y0 : y0 - y1;
  int16_t sx = x0 < x1 ? 1 : -1;
  int16_t sy = y0 < y1 ? 1 : -1;
  int16_t err = dx - dy;
  for (;;) {
    t->setPx(x0, y0, c);
    if (x0 == x1 && y0 == y1) break;
    int16_t e2 = err * 2;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}
static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, uint16_t c) { if (t) t->setPx(x, y, c); }
static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const uint16_t* bmp, int16_t w, int16_t h) {
  if (!t) return;
  for (int16_t yy = 0; yy < h; yy++)
    for (int16_t xx = 0; xx < w; xx++)
      t->setPx(x + xx, y + yy, bmp[static_cast<uint32_t>(yy) * w + xx]);
}
static void probeFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t c) {
  if (!t) return;
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  t->fillRectRaw(x + r, y, w - 2 * r, h, c);
  t->fillRectRaw(x, y + r, r, h - 2 * r, c);
  t->fillRectRaw(x + w - r, y + r, r, h - 2 * r, c);
  for (int16_t dy = 0; dy < r; dy++) {
    int16_t dx = static_cast<int16_t>(r * r - (r - dy) * (r - dy));
    // crude circle: scan the quarter
    int16_t sx = 0;
    while (sx * sx < r * r - (r - dy) * (r - dy)) sx++;
    if (sx > 0) sx--;
    t->fillRectRaw(x + r - 1 - sx, y + dy, sx + 1, 1, c);
    t->fillRectRaw(x + w - r, y + dy, sx + 1, 1, c);
    t->fillRectRaw(x + r - 1 - sx, y + h - 1 - dy, sx + 1, 1, c);
    t->fillRectRaw(x + w - r, y + h - 1 - dy, sx + 1, 1, c);
  }
}
static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t c) { probeFillRoundRect(t, x, y, w, h, r, c); }
static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t c) { if (t) display_targetDrawRect(t, x, y, w, h, c); }
static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t cx, int16_t cy, int16_t r, uint16_t c) {
  if (!t) return;
  for (int16_t dy = -r; dy <= r; dy++)
    for (int16_t dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) t->setPx(cx + dx, cy + dy, c);
}
static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t cx, int16_t cy, int16_t r, uint16_t c) {
  if (!t) return;
  for (int16_t a = 0; a < 360; a += 4) {
    float rad = a * 3.14159265f / 180.0f;
    t->setPx(cx + static_cast<int16_t>(r * rad), cy + static_cast<int16_t>(r * rad), c);
  }
}
static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { if (t) { t->cursorX = x; t->cursorY = y; } }
static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, uint16_t fg, uint16_t bg) { if (t) { t->textFg = fg; t->textBg = bg; } }
static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, uint16_t fg) { if (t) { t->textFg = fg; } }
static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { if (t) t->textTs = s ? s : 1; }
static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool wr) { if (t) t->wrap = wr; }

// Synthetic 5x7 glyph: deterministic per-char pattern (probe only cares that
// SOMETHING paints in the text band).
static void probeDrawChar(CuttlefishDisplayTarget* t, char ch) {
  uint32_t seed = static_cast<uint8_t>(ch) * 2654435761u;
  uint8_t ts = t->textTs;
  for (int gy = 0; gy < 7; gy++) {
    seed = seed * 1103515245u + 12345u;
    uint8_t rowBits = static_cast<uint8_t>((seed >> 16) & 0x1F);
    if (ch == ' ') rowBits = 0;
    for (int gx = 0; gx < 5; gx++) {
      uint16_t color = (rowBits >> (4 - gx)) & 1 ? t->textFg : t->textBg;
      t->fillRectRaw(t->cursorX + gx * ts, t->cursorY + gy * ts, ts, ts, color);
    }
  }
  t->cursorX = static_cast<int16_t>(t->cursorX + 6 * ts);
}
static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* text) { probePrintCalls++;
  if (t) fprintf(stderr, "[print] tgt=%s %dx%d cur=(%d,%d) fg=%04x bg=%04x ts=%u '%s'\n", t == probeHostDisplay() ? "disp" : "canvas", t->w, t->h, t->cursorX, t->cursorY, t->textFg, t->textBg, t->textTs, text);
  if (!t) return;
  for (const char* p = text; *p; p++) probeDrawChar(t, *p);
}

// Non-target aliases (some runtime paths call these on the default target).
static inline void display_draw_pixel(int16_t x, int16_t y, uint16_t c) { display_targetDrawPixel(probeHostDisplay(), x, y, c); }
static inline void display_draw_rgb_bitmap(int16_t x, int16_t y, const uint16_t* bmp, int16_t w, int16_t h) { display_targetDrawRGBBitmap(probeHostDisplay(), x, y, bmp, w, h); }
static inline void display_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) { display_targetFillRect(probeHostDisplay(), x, y, w, h, c); }
static inline void display_fill_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t c) { probeFillRoundRect(probeHostDisplay(), x, y, w, h, r, c); }
static inline void display_draw_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) { display_targetDrawRect(probeHostDisplay(), x, y, w, h, c); }
static inline void display_draw_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t c) { display_targetDrawRoundRect(probeHostDisplay(), x, y, w, h, r, c); }
static inline void display_draw_fast_hline(int16_t x, int16_t y, int16_t w, uint16_t c) { display_targetDrawFastHLine(probeHostDisplay(), x, y, w, c); }
static inline void display_draw_fast_vline(int16_t x, int16_t y, int16_t h, uint16_t c) { display_targetDrawFastVLine(probeHostDisplay(), x, y, h, c); }
static inline void display_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) { display_targetDrawLine(probeHostDisplay(), x0, y0, x1, y1, c); }
static inline void display_fill_circle(int16_t cx, int16_t cy, int16_t r, uint16_t c) { display_targetFillCircle(probeHostDisplay(), cx, cy, r, c); }
static inline void display_draw_circle(int16_t cx, int16_t cy, int16_t r, uint16_t c) { display_targetDrawCircle(probeHostDisplay(), cx, cy, r, c); }
static inline void display_set_cursor(int16_t x, int16_t y) { display_targetSetCursor(probeHostDisplay(), x, y); }
static inline void display_set_text_color(uint16_t fg, uint16_t bg) { display_targetSetTextColorBg(probeHostDisplay(), fg, bg); }
static inline void display_set_text_color_solid(uint16_t fg) { display_targetSetTextColor(probeHostDisplay(), fg); }
static inline void display_set_text_size(uint8_t s) { display_targetSetTextSize(probeHostDisplay(), s); }
static inline void display_set_text_wrap(bool wr) { display_targetSetTextWrap(probeHostDisplay(), wr); }
static inline void display_print(const char* text) { display_targetPrint(probeHostDisplay(), text); }
static inline void display_fillScreen(uint16_t c) { probeHostDisplay()->fillRectRaw(0, 0, 480, 320, c); }

// SPI-style transaction surface used by ui_push_canvas_rect.
static inline void display_startWrite() {}
static inline void display_endWrite() {}
static int16_t probeAddrX = 0;
static int16_t probeAddrY = 0;
static int16_t probeAddrW = 0;
static int16_t probeAddrH = 0;
static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) { probeSetAddrWindowCalls++;
  fprintf(stderr, "[push] addr x=%d y=%d w=%d h=%d\n", x, y, w, h);
  probeAddrX = x; probeAddrY = y; probeAddrW = w; probeAddrH = h;
}
static inline void display_writePixels(const uint16_t* pixels, uint32_t count) { probeWritePixelsCalls++;
  { uint32_t cardPx = 0; for (uint32_t k = 0; k < count; k++) if (pixels[k] == 0x39e7) cardPx++;
    fprintf(stderr, "[push] writePixels count=%u cardPx=%u first=%04x buf=%p\n", count, cardPx, count ? pixels[0] : 0, (const void*)pixels); }
  CuttlefishDisplayTarget* d = probeHostDisplay();
  {
    // After blitting, verify a known text pixel from the payload landed.
    uint32_t firstText = 0xFFFFFFFF;
    for (uint32_t k = 0; k < count && firstText == 0xFFFFFFFF; k++)
      if (pixels[k] == 0xe71c) firstText = k;
    if (firstText != 0xFFFFFFFF) {
      int32_t ex = probeAddrX + static_cast<int32_t>(firstText % static_cast<uint32_t>(probeAddrW > 0 ? probeAddrW : 1));
      int32_t ey = probeAddrY + static_cast<int32_t>(firstText / static_cast<uint32_t>(probeAddrW > 0 ? probeAddrW : 1));
      fprintf(stderr, "[push] firstText k=%u -> display (%d,%d) after=%04x\n", firstText, ex, ey, d->getPx(static_cast<int16_t>(ex), static_cast<int16_t>(ey)));
    }
  }
  for (uint32_t k = 0; k < count; k++) {
    int32_t x = probeAddrX + static_cast<int32_t>(k % static_cast<uint32_t>(probeAddrW > 0 ? probeAddrW : 1));
    int32_t y = probeAddrY + static_cast<int32_t>(k / static_cast<uint32_t>(probeAddrW > 0 ? probeAddrW : 1));
    d->setPx(static_cast<int16_t>(x), static_cast<int16_t>(y), pixels[k]);
  }
}
static inline void display_partial_refresh(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }

// Canvas allocation: mimic a no-PSRAM embedded heap — small canvases
// (band/repair, a few KB) succeed, a full-screen framebuffer (300KB) fails,
// so the runtime takes the same band-compositor path as the device.
// probeCanvasFailEvery > 0 additionally fails every Nth allocation,
// simulating the intermittent fragmentation failures a long-running device
// heap exhibits (scroll render locks, ladder fallbacks).
static uint32_t probeCanvasAllocCounter = 0;
static uint32_t probeCanvasFailEvery = 0;
static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  if (static_cast<uint32_t>(w) * static_cast<uint32_t>(h) * 2 > 40000u) return nullptr;
  probeCanvasAllocCounter++;
  if (probeCanvasFailEvery > 0 && (probeCanvasAllocCounter % probeCanvasFailEvery) == 0) return nullptr;
  return new CuttlefishCanvas16(w, h);
}
static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) { return display_createCanvas(w, h); }
static inline void display_deleteCanvas(CuttlefishCanvas16* c) { delete c; }
static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c ? c->w : 0; }
static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c ? c->h : 0; }
static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* c) { return c ? c->buf : nullptr; }
static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t col) { if (c) { if (c->w == 460) fprintf(stderr, "[seed] canvas buf=%p x=%d y=%d w=%d h=%d col=%04x\n", (void*)c->buf, x, y, w, h, col); c->fillRectRaw(x, y, w, h, col); } }
static inline void display_canvasFillScreen(CuttlefishCanvas16* c, uint16_t col) { if (c) c->fillRectRaw(0, 0, c->w, c->h, col); }
static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c ? c->getPx(x, y) : 0; }

// Arduino-compat shims the runtime header expects from the framework adapter.
static uint32_t probeMillis = 0;
static inline unsigned long millis() { return probeMillis; }
static inline void probeAdvanceMillis(uint32_t ms) { probeMillis += ms; }
#define LOW 0
#define HIGH 1
static inline int digitalRead(uint8_t) { return HIGH; }
static inline long constrain(long x, long a, long b) { return x < a ? a : (x > b ? b : x); }
static inline void __ui_kb_set_onchange() {}

struct ProbeFillGuard {
  ~ProbeFillGuard() = default;
};
