// Slice of the C++ runtime header (original source lines 753-901).
// Persistent canvas release/create/get/shift/repair/warn helpers.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitCanvasHelpers(): string {
  return `
// heap. Called from ui_navigate. Safe with null pointers.
static inline void ui_release_canvas_state() {
  display_deleteCanvas(__ui_container_canvas); __ui_container_canvas = nullptr;
  display_deleteCanvas(__ui_list_canvas);      __ui_list_canvas = nullptr;
  __ui_list_canvas_node = -1;
  display_deleteCanvas(__ui_node_canvas);      __ui_node_canvas = nullptr;
  display_deleteCanvas(__ui_repair_canvas);    __ui_repair_canvas = nullptr;
}

// Lazily allocate/reuse a viewport-sized canvas for a scroll container. Resizes
// when the container's box changes; returns null if allocation fails (caller
// falls back to Mode C direct redraw). Only used on full render tiers.
// Prefers PSRAM when available (ESP32 + BOARD_HAS_PSRAM + psramFound) so large
// viewport canvases (e.g. 116KB+ for a full-width scroll region on a 480x320
// panel) don't exhaust internal SRAM. Falls back to internal SRAM otherwise.
static inline CuttlefishCanvas16* ui_create_canvas_best(int16_t w, int16_t h) {
#if defined(ESP32) && defined(BOARD_HAS_PSRAM)
  if (psramFound()) {
    CuttlefishCanvas16* c = display_createCanvasPsram(w, h);
    if (c && display_canvasBuffer(c)) return c;
    // PSRAM allocation failed (rare — fragmented PSRAM) → fall through to SRAM.
  }
#endif
  return display_createCanvas(w, h);
}

static inline CuttlefishCanvas16* ui_get_container_canvas(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_container_canvas ||
      display_canvasWidth(__ui_container_canvas) != w ||
      display_canvasHeight(__ui_container_canvas) != h) {
    display_deleteCanvas(__ui_container_canvas);
    __ui_container_canvas = ui_create_canvas_best(w, h);
  }
  return (__ui_container_canvas && display_canvasBuffer(__ui_container_canvas))
    ? __ui_container_canvas : nullptr;
}

// Defined after the node table by UI lowering (scroll overflow nodes with ids).
static inline const char* __ui_scroll_node_id(uint16_t idx);

// Emit a one-time Serial warning when scroll rendering cannot be accurate due
// to heap limits. reason: 0=canvas alloc failed, 1=viewport exceeds budget,
// 2=Mode C strip fallback (reduced accuracy).
static inline void ui_warn_scroll_memory(uint16_t nodeIdx, uint8_t reason) {
  if (nodeIdx >= __ui_node_count) return;
  if (!__ui_scroll_mem_warned) return;
  if (__ui_scroll_mem_warned[nodeIdx]) return;
  __ui_scroll_mem_warned[nodeIdx] = 1;

  int16_t vw = __ui_nodes[nodeIdx].box.w;
  int16_t vh = __ui_nodes[nodeIdx].box.h;
  uint32_t need = (uint32_t)(vw > 0 ? vw : 0) * (uint32_t)(vh > 0 ? vh : 0) * 2u;
  const char* id = __ui_scroll_node_id(nodeIdx);
  const char* label = (id && id[0]) ? id : "scroll viewport";
  const char* reasonText = "scroll canvas allocation failed";
  if (reason == 1) reasonText = "scroll viewport exceeds compile-time canvas budget";
  else if (reason == 2) reasonText = "using Mode C strip fallback (smooth scroll canvas unavailable)";

#if defined(ESP32) && defined(ARDUINO)
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t maxAlloc = ESP.getMaxAllocHeap();
  Serial.printf(
    "[cuttlefish] WARNING: #%s (%dx%d) needs %lu bytes for accurate scroll — %s. "
    "heap free=%lu max_alloc=%lu budget=%d. "
    "Shrink the scroll viewport in CSS, trim fonts/images, or use PSRAM.\\n",
    label, vw, vh, (unsigned long)need, reasonText,
    (unsigned long)freeHeap, (unsigned long)maxAlloc, UI_SCROLL_CANVAS_BUDGET_BYTES);
#elif defined(ESP8266) && defined(ARDUINO)
  uint32_t freeHeap = ESP.getFreeHeap();
  Serial.printf(
    "[cuttlefish] WARNING: #%s (%dx%d) needs %lu bytes for accurate scroll — %s. "
    "heap free=%lu budget=%d. "
    "Shrink the scroll viewport in CSS, trim fonts/images, or reduce UI footprint.\\n",
    label, vw, vh, (unsigned long)need, reasonText,
    (unsigned long)freeHeap, UI_SCROLL_CANVAS_BUDGET_BYTES);
#else
  // Non-Arduino target (e.g. SDL native): no Serial, so use standard-C printf.
  // The native framework forces <cstdio> so printf is available here.
  printf(
    "[cuttlefish] WARNING: #%s (%dx%d) needs %lu bytes for accurate scroll — %s. "
    "budget=%d. Shrink the scroll viewport in CSS or trim UI assets.\\n",
    label, vw, vh, (unsigned long)need, reasonText, UI_SCROLL_CANVAS_BUDGET_BYTES);
#endif
}

// Shift the canvas buffer vertically by deltaY (cheap memmove of existing
// pixels), then fill the exposed band with bg. Reports the exposed band via
// *exposedY/*exposedH so the caller can redraw only that strip (Mode B).
static inline void ui_shift_container_canvas(CuttlefishCanvas16* canvas, int16_t deltaY, UI_COLOR_T bg,
                                             int16_t* exposedY, int16_t* exposedH) {
  if (exposedY) *exposedY = 0;
  if (exposedH) *exposedH = 0;
  if (!canvas || !display_canvasBuffer(canvas)) return;
  int16_t w = display_canvasWidth(canvas);
  int16_t h = display_canvasHeight(canvas);
  int16_t shift = deltaY < 0 ? -deltaY : deltaY;
  if (shift <= 0 || shift >= h) {
    display_canvasFillScreen(canvas, bg);
    if (exposedY) *exposedY = 0;
    if (exposedH) *exposedH = h;
    return;
  }
  UI_COLOR_T* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  // Reserve the rightmost 4px gutter so the memmove never smears scrollbar
  // pixels; the gutter is repainted separately by ui_draw_scrollbar.
  int16_t contentW = w > 4 ? w - 4 : w;
  // deltaY > 0: scrollY increased → finger moved up → content moves up.
  // Cached rows shift toward LOWER indices; the exposed band is at the BOTTOM.
  // deltaY < 0: content moves down → rows shift toward higher indices; exposed
  // band at the TOP. (Matches the proven pre-rewrite direction.)
  if (deltaY > 0) {
    for (int16_t row = 0; row < h - shift; row++) {
      memmove(pixels + (int32_t)row * stride,
              pixels + (int32_t)(row + shift) * stride,
              (size_t)contentW * sizeof(UI_COLOR_T));
    }
    if (exposedY) *exposedY = h - shift;
  } else {
    for (int16_t row = h - shift - 1; row >= 0; row--) {
      memmove(pixels + (int32_t)(row + shift) * stride,
              pixels + (int32_t)row * stride,
              (size_t)contentW * sizeof(UI_COLOR_T));
    }
    if (exposedY) *exposedY = 0;
  }
  int16_t fillY = deltaY > 0 ? h - shift : 0;
  display_canvasFillRect(canvas, 0, fillY, contentW, shift, bg);
  if (w > contentW) {
    display_canvasFillRect(canvas, contentW, 0, w - contentW, h, bg);
  }
  if (exposedH) *exposedH = shift;
}

// Repair canvas: parent-seeded background repaints + exposed-strip redraws.
// Grow-only between navigations so small scroll-delta changes do not allocate
// and free a new strip canvas during drag.
static inline CuttlefishCanvas16* ui_get_repair_canvas(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_repair_canvas || !display_canvasBuffer(__ui_repair_canvas) ||
      display_canvasWidth(__ui_repair_canvas) < w ||
      display_canvasHeight(__ui_repair_canvas) < h) {
    display_deleteCanvas(__ui_repair_canvas);
    __ui_repair_canvas = ui_create_canvas_best(w, h);
  }
  return (__ui_repair_canvas && display_canvasBuffer(__ui_repair_canvas))
    ? __ui_repair_canvas : nullptr;
}`;
}
