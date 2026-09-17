// ---------------------------------------------------------------------------
// Shared C++ sections for the Zephyr UI display adapters.
//
// The canvas lifecycle + target-polymorphic sections of the emitted adapter
// are transport-independent (they operate on CuttlefishCanvas16 /
// CuttlefishDisplayTarget and never touch the panel), so both transports
// (direct-spi in ui-adapter.ts, zephyr-display in ui-adapter-native.ts)
// emit them verbatim from this module. Keeping one copy prevents the two
// transports from drifting apart.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

/** Offscreen canvas lifecycle + accessors (malloc + placement-new; PSRAM via
 *  Zephyr's shared multi-heap when BOARD_HAS_PSRAM). */
export const CANVAS_LIFECYCLE_SECTION = `
// ── Canvas lifecycle + accessors (offscreen rgb565 compositing) ──────────
// Allocate the canvas object via malloc + placement-new (not operator new).
// Under CONFIG_REQUIRES_FULL_LIBCPP without CONFIG_CPP_EXCEPTIONS, operator new
// throws std::bad_alloc on OOM and the nothrow wrapper's internal catch cannot
// unwind (no EH runtime) → std::terminate → abort. malloc returns NULL on
// failure with no exception path; placement-new then constructs the object in
// place (vtable included). display_deleteCanvas mirrors with an explicit dtor
// + free. The runtime's callers already null-check the return, so an OOM
// degrades gracefully instead of aborting.
static inline CuttlefishCanvas16* display_createCanvas(int16_t cw, int16_t ch) {
  void* mem = malloc(sizeof(CuttlefishCanvas16));
  if (!mem) return nullptr;
  return new (mem) CuttlefishCanvas16(cw, ch);
}
// psramFound() shim: the Arduino ESP32 core provides this, but Zephyr does not.
// Under BOARD_HAS_PSRAM the ESP heap serves PSRAM, so report it as present. The
// runtime's ui_create_canvas_best calls this under #if defined(BOARD_HAS_PSRAM).
#if defined(BOARD_HAS_PSRAM) && !defined(psramFound)
#include <zephyr/multi_heap/shared_multi_heap.h>
static inline bool psramFound() {
  // Compile-time truth: if BOARD_HAS_PSRAM is defined, the build targets a
  // PSRAM board with CONFIG_ESP_SPIRAM enabled (the framework emits both).
  return true;
}
// Allocate from PSRAM via Zephyr's shared multi-heap (the ESP32 SoC code
// registers PSRAM as an SMH_REG_ATTR_EXTERNAL region at boot).
static inline void* ui_psram_malloc(size_t bytes) {
  return shared_multi_heap_alloc(SMH_REG_ATTR_EXTERNAL, bytes);
}
#endif
static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t cw, int16_t ch) {
  // Allocate the pixel buffer in PSRAM (large: w*h*2 bytes) and the small
  // canvas object in SRAM. The canvas takes ownership of the PSRAM buffer and
  // frees it via free() in its dtor (the SMH allocator's free is compatible
  // with the standard k_free/free path). Returns nullptr if PSRAM isn't
  // available or the allocation fails — ui_create_canvas_best falls back.
#if defined(BOARD_HAS_PSRAM)
  if ((cw > 0) && (ch > 0)) {
    size_t bytes = static_cast<size_t>(cw) * static_cast<size_t>(ch) * sizeof(uint16_t);
    uint16_t* psramBuf = static_cast<uint16_t*>(ui_psram_malloc(bytes));
    if (psramBuf) {
      void* mem = malloc(sizeof(CuttlefishCanvas16));
      if (mem) {
        return new (mem) CuttlefishCanvas16(cw, ch, psramBuf, 1);
      }
      free(psramBuf);
    }
  }
#else
  (void)cw; (void)ch;
#endif
  return nullptr;
}
static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) {
  if (!canvas) return;
  canvas->~CuttlefishCanvas16();
  free(canvas);
}
static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c->width(); }
static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c->height(); }
// Canvas buffers are addressed in UI_COLOR_T units by every runtime caller;
// the underlying CuttlefishCanvas16 storage is 16-bit (the 565/mono world the
// canvas machinery was built for). Gray8/full-frame targets never allocate
// canvases, so the reinterpret never dereferences on those builds.
static inline UI_COLOR_T* display_canvasBuffer(CuttlefishCanvas16* c) {
  return reinterpret_cast<UI_COLOR_T*>(c->getBuffer());
}
static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c->getPixel(x, y); }
static inline void display_canvasFillScreen(CuttlefishCanvas16* c, UI_COLOR_T color) { c->fillScreen(static_cast<uint16_t>(color)); }
static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t cw, int16_t ch, UI_COLOR_T color) {
  c->fillRect(x, y, cw, ch, static_cast<uint16_t>(color));
}
`;

/** Target-polymorphic draw passthroughs (panel or canvas via
 *  CuttlefishDisplayTarget*). Pure virtual dispatch on the target object. */
export const TARGET_FORWARDERS_SECTION = `
// ── Target-polymorphic draw (panel or canvas via CuttlefishDisplayTarget*) ─
static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x, y, static_cast<uint16_t>(color)); }
static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }
static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }
static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const UI_COLOR_T* bitmap, int16_t bw, int16_t bh) {
  t->drawRGBBitmap(x, y, reinterpret_cast<const uint16_t*>(bitmap), bw, bh);
}
static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, UI_COLOR_T color) { t->fillRect(x, y, bw, bh, static_cast<uint16_t>(color)); }
static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, UI_COLOR_T color) { t->drawFastHLine(x, y, bw, static_cast<uint16_t>(color)); }
static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bh, UI_COLOR_T color) { t->drawFastVLine(x, y, bh, static_cast<uint16_t>(color)); }
static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, int16_t r, UI_COLOR_T color) { t->fillRoundRect(x, y, bw, bh, r, static_cast<uint16_t>(color)); }
static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, UI_COLOR_T color) { t->drawRect(x, y, bw, bh, static_cast<uint16_t>(color)); }
static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, int16_t r, UI_COLOR_T color) { t->drawRoundRect(x, y, bw, bh, r, static_cast<uint16_t>(color)); }
static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) { t->drawLine(x0, y0, x1, y1, static_cast<uint16_t>(color)); }
static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->fillCircle(x, y, r, static_cast<uint16_t>(color)); }
static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->drawCircle(x, y, r, static_cast<uint16_t>(color)); }
static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { t->setCursor(x, y); }
static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, UI_COLOR_T fg) { t->setTextColor(static_cast<uint16_t>(fg)); }
static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, UI_COLOR_T fg, UI_COLOR_T bg) { t->setTextColor(static_cast<uint16_t>(fg), static_cast<uint16_t>(bg)); }
static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { t->setTextSize(s); }
static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool wp) { t->setTextWrap(wp); }
static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); }
`;

/** The marker line every adapter stamps into its includes so the toolchain
 *  can recover the emitting profile. Pairs with displayFactsLine() from
 *  profiles.ts, which adapters emit alongside it (the facts line carries
 *  synthesized, compatible-driven profiles too). */
export function profileMarkerLine(driver: string): string {
  return `// typecad-display-profile: ${driver}`;
}
