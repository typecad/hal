#define CuttlefishDisplayTarget Adafruit_GFX
#define CuttlefishCanvas16 GFXcanvas16
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Arduino.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// TypeCAD Native Polyfills
#ifndef CUTTLEFISH_STR_BUF_SIZE
#define CUTTLEFISH_STR_BUF_SIZE 64
#endif

// String helpers
struct __tc_str_ptr {
    char buf[CUTTLEFISH_STR_BUF_SIZE];
    __tc_str_ptr(const char* s = "") { strncpy(buf, s, CUTTLEFISH_STR_BUF_SIZE - 1); buf[CUTTLEFISH_STR_BUF_SIZE - 1] = 0; }
    __tc_str_ptr(const __tc_str_ptr& o) { memcpy(buf, o.buf, CUTTLEFISH_STR_BUF_SIZE); }
    __tc_str_ptr& operator=(const __tc_str_ptr& o) { memcpy(buf, o.buf, CUTTLEFISH_STR_BUF_SIZE); return *this; }
    __tc_str_ptr& operator=(const char* s) { strncpy(buf, s, CUTTLEFISH_STR_BUF_SIZE - 1); buf[CUTTLEFISH_STR_BUF_SIZE - 1] = 0; return *this; }
    const char* c_str() const { return buf; }
    size_t size() const { return ::strlen(buf); }
    size_t length() const { return ::strlen(buf); }
    int indexOf(const char* s) const { const char* p = strstr(buf, s); return p ? p - buf : -1; }
    operator const char*() const { return buf; }
    bool operator==(const char* o) const { return strcmp(buf, o) == 0; }
    bool operator!=(const char* o) const { return strcmp(buf, o) != 0; }
    bool operator==(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) == 0; }
    bool operator!=(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) != 0; }
};
inline size_t (strlen)(const __tc_str_ptr& s) { return ::strlen(s.buf); }

#define UI_COLOR_DEPTH 565
#define UI_COLOR_T uint16_t
#define UI_DIM_MASK 0x7BEFu
Adafruit_ILI9341 __tc_display = Adafruit_ILI9341(5, 21, 22);
// --- Display adapter: ILI9341 ---

static inline void display_init() {
  __tc_display.begin();
  __tc_display.setRotation(1);
  __tc_display.fillScreen(0x0000);
}

static inline void display_fillScreen(uint16_t color) {
  __tc_display.fillScreen(color);
}

static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }
static inline int16_t display_width() { return __tc_display.width(); }
static inline int16_t display_height() { return __tc_display.height(); }

static inline void display_startWrite() { __tc_display.startWrite(); }
static inline void display_endWrite() { __tc_display.endWrite(); }
static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {
  __tc_display.setAddrWindow(x, y, w, h);
}
static inline void display_writePixels(uint16_t* pixels, uint32_t count) {
  __tc_display.writePixels(pixels, count);
}

static inline CuttlefishCanvas16* display_createCanvas(int16_t w, int16_t h) {
  return new GFXcanvas16(w, h);
}
static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t w, int16_t h) {
#if defined(ESP32) && defined(BOARD_HAS_PSRAM)
  return new (ps_malloc(sizeof(GFXcanvas16))) GFXcanvas16(w, h);
#else
  (void)w; (void)h;
  return nullptr;
#endif
}
static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) { delete canvas; }
static inline int16_t display_canvasWidth(CuttlefishCanvas16* canvas) { return canvas->width(); }
static inline int16_t display_canvasHeight(CuttlefishCanvas16* canvas) { return canvas->height(); }
static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* canvas) { return canvas->getBuffer(); }
static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* canvas, int16_t x, int16_t y) { return canvas->getPixel(x, y); }
static inline void display_canvasFillScreen(CuttlefishCanvas16* canvas, UI_COLOR_T color) { canvas->fillScreen((uint16_t)color); }
static inline void display_canvasFillRect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  canvas->fillRect(x, y, w, h, (uint16_t)color);
}

static inline void display_targetDrawPixel(CuttlefishDisplayTarget* target, int16_t x, int16_t y, UI_COLOR_T color) { target->drawPixel(x, y, (uint16_t)color); }
static inline int16_t display_targetWidth(CuttlefishDisplayTarget* target) { return target->width(); }
static inline int16_t display_targetHeight(CuttlefishDisplayTarget* target) { return target->height(); }
static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* target, int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {
  target->drawRGBBitmap(x, y, bitmap, w, h);
}
static inline void display_targetFillRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  target->fillRect(x, y, w, h, (uint16_t)color);
}
static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, UI_COLOR_T color) {
  target->drawFastHLine(x, y, w, (uint16_t)color);
}
static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t h, UI_COLOR_T color) {
  target->drawFastVLine(x, y, h, (uint16_t)color);
}
static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {
  target->fillRoundRect(x, y, w, h, r, (uint16_t)color);
}
static inline void display_targetDrawRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  target->drawRect(x, y, w, h, (uint16_t)color);
}
static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {
  target->drawRoundRect(x, y, w, h, r, (uint16_t)color);
}
static inline void display_targetDrawLine(CuttlefishDisplayTarget* target, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) {
  target->drawLine(x0, y0, x1, y1, (uint16_t)color);
}
static inline void display_targetFillCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {
  target->fillCircle(x, y, r, (uint16_t)color);
}
static inline void display_targetDrawCircle(CuttlefishDisplayTarget* target, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {
  target->drawCircle(x, y, r, (uint16_t)color);
}
static inline void display_targetSetCursor(CuttlefishDisplayTarget* target, int16_t x, int16_t y) { target->setCursor(x, y); }
static inline void display_targetSetTextColor(CuttlefishDisplayTarget* target, UI_COLOR_T fg) { target->setTextColor((uint16_t)fg); }
static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* target, UI_COLOR_T fg, UI_COLOR_T bg) { target->setTextColor((uint16_t)fg, (uint16_t)bg); }
static inline void display_targetSetTextSize(CuttlefishDisplayTarget* target, uint8_t size) { target->setTextSize(size); }
static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* target, bool wrap) { target->setTextWrap(wrap); }
static inline void display_targetPrint(CuttlefishDisplayTarget* target, const char* text) { target->print(text); }
void ui_poll_touch();
#ifndef UI_COLOR_DEPTH
#define UI_COLOR_DEPTH 565
#endif
#define UI_SCROLL_MAX_OVERSCROLL 40
#define UI_SCROLL_STIFFNESS_X10 5
#define UI_SCROLL_EDGE_SNAP_PX 12
#define UI_SCROLL_DRAG_SCALE_X10 10
#define UI_SCROLL_INPUT_TIER_CAPACITIVE 0
#define UI_SCROLL_INPUT_TIER_RESISTIVE 0
#define UI_SCROLL_INPUT_TIER_NONE 1
#define UI_SCROLL_RENDER_TIER_FULL 1
#define UI_SCROLL_RENDER_TIER_CONSTRAINED 0
#define UI_SCROLL_CANVAS_BUDGET_BYTES 88000
void __ui_kb_set_onchange();

// ── TypeHAL UI runtime (emit once per TU) ──────────────────────────────────
#ifndef __TC_UI_RUNTIME
#define __TC_UI_RUNTIME
#include <stdint.h>
#include <string.h>
#define UI_TEXT_BUF 32   // max stored UI text chars, excluding the trailing NUL
#define UI_TEXT_LINE_BUF 96
#define UI_WS_NORMAL 0
#define UI_WS_NOWRAP 1
#define UI_WS_PRE 2
#define UI_WS_PRE_LINE 3
#ifndef UI_MAX_BUFFERED_PAINT_PIXELS
#define UI_MAX_BUFFERED_PAINT_PIXELS 20000
#endif
#ifndef UI_USE_FULL_FRAMEBUFFER
#define UI_USE_FULL_FRAMEBUFFER 0
#endif
#ifndef UI_TRANSITION_SNAP_MS
#define UI_TRANSITION_SNAP_MS 100
#endif
// Scroll physics + capability defaults. The per-TU #define overrides emitted
// by the UI emitter (from resolveScrollConfig) hit BEFORE this header, so these
// #ifndef guards adopt the configured values. Spec: 2026-06-28-scroll-engine-rewrite-design.md
#ifndef UI_SCROLL_MAX_OVERSCROLL
#define UI_SCROLL_MAX_OVERSCROLL 40
#endif
#ifndef UI_SCROLL_STIFFNESS_X10
#define UI_SCROLL_STIFFNESS_X10 5
#endif
#ifndef UI_SCROLL_EDGE_SNAP_PX
#define UI_SCROLL_EDGE_SNAP_PX 12
#endif
#ifndef UI_SCROLL_DRAG_SCALE_X10
#define UI_SCROLL_DRAG_SCALE_X10 10
#endif
#ifndef UI_SCROLL_SETTLE_MS
#define UI_SCROLL_SETTLE_MS 180
#endif
#ifndef UI_SCROLL_DEADBAND_PX
#define UI_SCROLL_DEADBAND_PX 2
#endif
// Capability tier flags (emitted per-TU before this header; defaults = full).
#ifndef UI_SCROLL_INPUT_TIER_CAPACITIVE
#define UI_SCROLL_INPUT_TIER_CAPACITIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_RESISTIVE
#define UI_SCROLL_INPUT_TIER_RESISTIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_NONE
#define UI_SCROLL_INPUT_TIER_NONE 0
#endif
#ifndef UI_SCROLL_RENDER_TIER_FULL
#define UI_SCROLL_RENDER_TIER_FULL 1
#endif
#ifndef UI_SCROLL_RENDER_TIER_CONSTRAINED
#define UI_SCROLL_RENDER_TIER_CONSTRAINED 0
#endif
#if (UI_SCROLL_INPUT_TIER_CAPACITIVE + UI_SCROLL_INPUT_TIER_RESISTIVE + UI_SCROLL_INPUT_TIER_NONE) == 0
#define UI_SCROLL_INPUT_TIER_RESISTIVE 1
#endif
#define UI_SCROLL_HAS_TOUCH (UI_SCROLL_INPUT_TIER_CAPACITIVE || UI_SCROLL_INPUT_TIER_RESISTIVE)
#define UI_SCROLL_ELASTIC (UI_SCROLL_RENDER_TIER_FULL)
// Telemetry: emits per-frame scrollY/overscrollPx/dy over Serial when defined.
#ifndef UI_SCROLL_DEBUG
#define UI_SCROLL_DEBUG 0
#endif
#ifndef UI_SCROLL_CANVAS_BUDGET_BYTES
#define UI_SCROLL_CANVAS_BUDGET_BYTES 88000
#endif
#if defined(ESP32) || defined(ESP8266)
#include <Esp.h>
#endif

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT, NODE_IMG, NODE_LIST, NODE_CANVAS };
enum UIProperty { PROP_BG, PROP_FG, PROP_TEXT, PROP_VISIBLE, PROP_BORDER_COLOR, PROP_VALUE };

struct UIRect { int16_t x, y, w, h; };
struct UIFontGlyph {
  uint16_t codepoint;
  int8_t xOffset;
  int8_t yOffset;
  uint8_t width;
  uint8_t height;
  uint8_t advance;
  uint16_t dataOffset; // 4-bit alpha pixel offset
};
struct UIFontFace {
  uint8_t id;
  uint8_t glyphCount;
  uint8_t lineHeight;
  uint8_t baseline;
  const UIFontGlyph* glyphs;
  const uint8_t* alpha;
};
struct UINode {
  UIRect box;
  uint32_t bg;
  uint32_t fg;
  UINodeKind kind;
  const char* text;
  char textBuffer[UI_TEXT_BUF + 1]; // dynamic text — read only when hasTextBinding == 1
  uint8_t hasTextBinding;       // set by ui_init when a PROP_TEXT binding targets this node
  const uint8_t* font;
  uint8_t hasBg;
  uint8_t textAlign;    // 0=left, 1=center, 2=right
  uint8_t textSize;     // GFX text size: 1-4
  uint8_t lineHeight;   // px per text line (0 = font default)
  int8_t letterSpacing; // px between chars (0 = default advance)
  uint8_t fontAntialias; // 1 = smooth text edges when UI_AA is available
  uint8_t fontFace;     // 0 = classic GFX bitmap font; otherwise UIFontFace id
  uint32_t borderColor; // resolved color for the border (0 = use fg)
  uint8_t borderStyle;  // 0=none, 1=solid, 2=dashed
  uint8_t borderWidth;  // px, 0=none (uniform fallback)
  uint8_t borderTopWidth;    // per-side; equals borderWidth when uniform
  uint8_t borderRightWidth;
  uint8_t borderBottomWidth;
  uint8_t borderLeftWidth;
  uint8_t hasPerSideBorder;  // 1 when any per-side width differs from borderWidth
  uint8_t borderRadius; // px, 0=square
  uint8_t paddingTop;
  uint8_t paddingRight;
  uint8_t paddingBottom;
  uint8_t paddingLeft;
  uint8_t gradientEnabled; // 0=none, 1=vertical, 2=horizontal
  uint32_t gradientColor1;
  uint32_t gradientColor2;
  uint32_t outlineColor;
  uint8_t outlineStyle; // 0=none, 1=solid, 2=dashed
  uint8_t outlineWidth;
  int16_t zIndex;      // effective draw layer; higher layers draw later
  int16_t transformOffsetX; // draw-only transform: translate(...)
  int16_t transformOffsetY;
  int16_t rotateDeg;
  int8_t pressedOffsetX; // draw-only :pressed offset, no Yoga relayout
  int8_t pressedOffsetY;
  uint8_t shadowCount;  // 0-4 active shadows
  int8_t shadowOffsetX[4];
  int8_t shadowOffsetY[4];
  uint8_t shadowBlur[4];
  uint32_t shadowColor[4];
  uint8_t shadowAlpha[4];
  uint8_t shadowInset[4]; // 0=outset, 1=inset
  uint8_t textShadowCount;
  int8_t textShadowOffsetX;
  int8_t textShadowOffsetY;
  uint8_t textShadowBlur;
  uint32_t textShadowColor;
  uint8_t textShadowAlpha;
  uint8_t underline;    // text-decoration: 0=none,1=underline,2=line-through,3=both
  uint8_t textOverflow; // text-overflow: 0=clip, 1=ellipsis (truncate + ...)
  uint8_t nowrap;       // 1 = no text wrapping (white-space: nowrap/pre)
  uint8_t whiteSpaceMode; // 0=normal, 1=nowrap, 2=pre, 3=pre-line
  uint8_t visible;      // 0=hidden, 1=visible
  uint8_t opacity;      // 0-100
  uint32_t clearColor;  // ancestor's background — used to wipe transparent text before redraw
  int16_t lastTextWidth;
  int16_t lastTextHeight;
  uint32_t layoutCacheKey;  // 0 = invalid; non-zero hashes layout inputs
  uint16_t layoutMetricsW;  // cached ui_text_layout_metrics width
  uint16_t layoutMetricsH;  // cached ui_text_layout_metrics height
  // scroll (unified: containers and virtualized lists share these)
  uint8_t scrollable;   // 1 = children offset by scrollY, clipped to this box
  uint8_t virtualized;  // 1 = children produced by list*Fn callbacks (<list>)
  int16_t scrollY;      // committed offset (always in [0, maxScroll]); draw subtracts it
  int16_t contentHeight; // total child height (clamp bound + scrollbar ratio)
  int16_t overscrollPx; // elastic excursion past a boundary (0 in-bounds; +top, -bottom)
  uint8_t settling;     // 1 while a bounce-back/snap animation runs
  int16_t lastPaintedScrollY;  // scrollY at last container repaint (Mode B shift delta)
  uint16_t listCount;   // virtualized: current item count (refreshed each frame)
  uint16_t (*listCountFn)(void);
  void (*listItemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*listTapFn)(uint16_t idx);  // nullptr if no tap handler
  uint16_t parent;      // 0xFFFF = root/no parent (UI_NO_PARENT)
  uint16_t subtreeEnd;  // exclusive pre-order end index
  uint8_t screenId;     // which <screen> this node belongs to (for navigation)
  uint8_t imgDataId;    // index into __ui_images[] (255 = no image)
  uint8_t objectFit;    // 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down
  uint16_t listItemHeight; // px per item for <list> (0 = not a list)
  int16_t rangeMin;     // for <range>: minimum value
  int16_t rangeMax;     // for <range>: maximum value
  int16_t maxlen;       // for <input>: max character length (0 = UI_TEXT_BUF)
  uint16_t canvasW;        // canvas buffer width  (for <canvas>)
  uint16_t canvasH;        // canvas buffer height (for <canvas>)
  // Rich-text runs (runCount > 0 for text nodes with mixed inline content).
  // The node references a contiguous slice of the global run / segment / line
  // arrays; geometry is precomputed at transpile time (runs are static-only).
  uint8_t runCount;       // number of runs in this node (0 = plain single-string text)
  uint8_t richLineCount;  // number of wrapped lines
  uint16_t runStart;      // first index into __ui_runs[]
  uint16_t richSegStart;  // first index into __ui_rich_segs[]
  uint16_t richSegCount;  // total segments across all lines
  uint16_t richLineStart; // first index into __ui_rich_lines[]
  // runtime slot
  uint8_t dirty;
  int16_t value;  // unified element state
};
// Rich-text run: one piece of styled inline text within a node's run list.
struct UIRichRun {
  const char* text;
  uint32_t fg;
  uint8_t textSize;
  uint8_t fontFace;
  uint8_t underline;     // 0=none,1=underline,2=line-through,3=both
  int8_t letterSpacing;
  int8_t linkTarget;     // resolved screen index, -1 = not a link
};
// One laid-out segment of a run on one line (precomputed geometry).
struct UIRichSeg {
  uint8_t runIndex;      // index into the node's runs (0..runCount-1)
  const char* text;
  int16_t x;             // offset from the line's left edge (pre-alignment)
  uint16_t w;            // measured width
  uint8_t line;          // which line (0..richLineCount-1) this segment is on
};
// One wrapped line of rich text (precomputed).
struct UIRichLine {
  int16_t y;             // top y relative to the node's text top
  uint16_t h;            // line height (tallest run on this line)
  int16_t baseline;      // baseline y (for mixed-size baseline alignment)
  uint16_t w;            // total line width (for alignment)
};
struct UITransition {
  uint16_t node;
  UIProperty prop;
  uint16_t durationMs;
  // The :pressed and base-state target colors. ui_on_press arms toward
  // pressedTarget; ui_on_release arms toward baseTarget.
  uint32_t pressedTarget;
  uint32_t baseTarget;
  // runtime
  uint16_t elapsed;
  uint32_t prevValue;
  uint32_t targetValue;
  uint8_t  active;
};
struct UIBinding {
  uint16_t node;
  UIProperty prop;
  uint32_t (*fn)(void);       // for color/numeric bindings
  void (*textFn)(char* buf, uint8_t size); // for text bindings (PROP_TEXT): fills buf
};

// Color lerp for transitions (rgb565). For mono, this collapses to a snap.
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  // Lerp in 888 internally for smoother color transitions (keyframe animation,
  // :pressed transitions). Unpack 565→888, lerp at 8-bit, re-quantize to 565.
  uint8_t ar5 = (a >> 11) & 0x1f, ag6 = (a >> 5) & 0x3f, ab5 = a & 0x1f;
  uint8_t br5 = (b >> 11) & 0x1f, bg6 = (b >> 5) & 0x3f, bb5 = b & 0x1f;
  uint16_t ar8 = (ar5 << 3) | (ar5 >> 2), ag8 = (ag6 << 2) | (ag6 >> 4), ab8 = (ab5 << 3) | (ab5 >> 2);
  uint16_t br8 = (br5 << 3) | (br5 >> 2), bg8 = (bg6 << 2) | (bg6 >> 4), bb8 = (bb5 << 3) | (bb5 >> 2);
  int16_t r = (int16_t)(ar8 + (int16_t)((br8 - ar8) * k100 / 100));
  int16_t g = (int16_t)(ag8 + (int16_t)((bg8 - ag8) * k100 / 100));
  int16_t bl = (int16_t)(ab8 + (int16_t)((bb8 - ab8) * k100 / 100));
  return ((uint16_t)((r >> 3) & 0x1f) << 11) | ((uint16_t)((g >> 2) & 0x3f) << 5) | (uint16_t)((bl >> 3) & 0x1f);
}

// RGB888 lerp — for transitions on RGB888/RGB666 targets (Phase 2+). Unused in
// Phase 1; the 565 lerp_color above remains the active path for TFT targets,
// whose node colors are still emitted as 565 values stored in uint32_t fields.
static inline uint32_t lerp_color_888(uint32_t a, uint32_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  uint8_t ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  uint8_t br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  int16_t r = ar + (int16_t)(((int16_t)br - (int16_t)ar) * k100 / 100);
  int16_t g = ag + (int16_t)(((int16_t)bg - (int16_t)ag) * k100 / 100);
  int16_t bl = ab + (int16_t)(((int16_t)bb - (int16_t)ab) * k100 / 100);
  return ((uint32_t)(r & 0xff) << 16) | ((uint32_t)(g & 0xff) << 8) | (uint32_t)(bl & 0xff);
}

// Declared by the lowering output (the tables). Matches the mutable (non-const)
// definitions: ui_tick updates node bg/dirty and transition elapsed/active.
extern UINode __ui_nodes[];
extern UITransition __ui_trans[];
extern UIBinding __ui_bindings[];
extern const UIFontFace __ui_font_faces[];
// Rich-text run / segment / line tables (parallel arrays; nodes reference
// contiguous slices via runStart/richSegStart/richLineStart + counts).
extern UIRichRun __ui_runs[];
extern UIRichSeg __ui_rich_segs[];
extern UIRichLine __ui_rich_lines[];
extern const uint16_t __ui_node_count;
extern const uint16_t __ui_trans_count;
extern const uint16_t __ui_binding_count;
extern const uint16_t __ui_run_count;
extern const uint16_t __ui_rich_seg_count;
extern const uint16_t __ui_rich_line_count;

// ── Color depth → blend/lerp selection ───────────────────────────────────────
// UI_COLOR_DEPTH is emitted by the UI emitter from the display profile's
// colorFormat (565 for TFT byte-identity, 888 for rgb666+). The value depth
// and the blend math MUST switch together: on 565, node fields hold 565 values
// and ui_blend565 is correct; on 888, node fields hold 888 values and
// ui_blend888 is correct. Forward-declare the four functions and define the
// ui_blend/UI_LERP_COLOR macros here (before any call site) so they resolve
// everywhere; the function bodies are defined later in this header.
#ifndef UI_COLOR_DEPTH
#define UI_COLOR_DEPTH 565
#endif
// Color value type tracks the depth: 888 holds 24-bit RGB (R<<16|G<<8|B),
// 565 holds 16-bit. Draw wrappers and locals use UI_COLOR_T so 888 is not
// narrowed before reaching the HAL. Under 565/mono this is uint16_t and the
// emitted code is byte-identical with the pre-widening runtime.
#if UI_COLOR_DEPTH == 888
  #ifndef UI_COLOR_T
    #define UI_COLOR_T uint32_t
  #endif
  #ifndef UI_DIM_MASK
    #define UI_DIM_MASK 0x7F7F7Fu   // halve each 8-bit channel independently
  #endif
#else
  #ifndef UI_COLOR_T
    #define UI_COLOR_T uint16_t
  #endif
  #ifndef UI_DIM_MASK
    #define UI_DIM_MASK 0x7BEFu     // 565 dim mask (top bit clear per channel)
  #endif
#endif
static inline uint16_t ui_blend565(uint16_t fg, uint16_t bg, uint8_t opacity);
static inline uint32_t ui_blend888(uint32_t fg, uint32_t bg, uint8_t opacity);
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100);
static inline uint32_t lerp_color_888(uint32_t a, uint32_t b, uint8_t k100);
#if UI_COLOR_DEPTH == 888
  #define ui_blend(fg, bg, op)        ui_blend888((uint32_t)(fg), (uint32_t)(bg), (op))
  #define UI_LERP_COLOR(a, b, k)      lerp_color_888((uint32_t)(a), (uint32_t)(b), (k))
#else
  #define ui_blend(fg, bg, op)        ui_blend565((uint16_t)(fg), (uint16_t)(bg), (op))
  #define UI_LERP_COLOR(a, b, k)      lerp_color((uint16_t)(a), (uint16_t)(b), (k))
#endif

// ── 1-bit mono snap (UI_NATIVE_MONO) ─────────────────────────────────────────
// On a B&W e-ink panel, any color value must resolve to black or white. Node
// fields are pre-snapped at transpile, but blended/lerped runtime values
// (opacity, shadows, gradients) need a defensive snap in the draw path. The
// macro is a no-op on color targets so TFT output is byte-identical.
#ifdef UI_NATIVE_MONO
// Snap an RGB888 value to 1-bit mono (white/black) by luminance.
static inline uint32_t ui_snap_mono(uint32_t c) {
  uint8_t r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  // Match the transpile-time toMono threshold: (0.299r + 0.587g + 0.114b)/255 >= 0.27.
  // Integer form: 299r+587g+114b >= 68850 (= 0.27*255*1000). Verified 0 mismatches.
  return ((uint32_t)(299 * r + 587 * g + 114 * b) >= 68850u) ? 0xffffffu : 0x000000u;
}
// Snap an RGB565 value to 1-bit mono. Mono panels run at UI_COLOR_DEPTH 565, so
// node fields hold 565 values; reconstruct 8-bit channels then apply the threshold.
// Pre-snapped values (0x0000/0x0001/0xffff) pass through directly — the
// transpiler resolves #ffffff/#000000 to 0x0001/0x0000 on mono targets.
static inline uint16_t ui_snap_mono565(uint16_t c) {
  if (c == 0x0000u) return 0x0000u;
  if (c == 0x0001u || c == 0xffffu) return 0xffffu;
  uint8_t r5 = (c >> 11) & 0x1f, g6 = (c >> 5) & 0x3f, b5 = c & 0x1f;
  uint8_t r = (r5 << 3) | (r5 >> 2), g = (g6 << 2) | (g6 >> 4), b = (b5 << 3) | (b5 >> 2);
  return ((uint32_t)(299 * r + 587 * g + 114 * b) >= 68850u) ? 0xffffu : 0x0000u;
}
#define UI_MAYBE_SNAP_MONO(c)    (ui_snap_mono((uint32_t)(c)))
#define UI_MAYBE_SNAP_MONO565(c) (ui_snap_mono565((uint16_t)(c)))
#else
#define UI_MAYBE_SNAP_MONO(c)    (c)
#define UI_MAYBE_SNAP_MONO565(c) (c)
#endif

// ── Per-frame refresh dispatch ──────────────────────────────────────────────
// Three mutually-exclusive compile-time paths, in priority order:
//   1. UI_REQUIRES_BACKING_STORE (e-ink): dirty-rect accumulator + partial refresh.
//   2. UI_BATCH_SPI_WRITES (TFT immediate): one startWrite/endWrite per frame.
//   3. default (SDL native host): no-ops.
// Exactly one branch ever compiles — the emitter's guards ensure the first two
// are never both defined (UI_REQUIRES_BACKING_STORE ⟹ requiresBackingStore,
// UI_BATCH_SPI_WRITES ⟹ immediate && !requiresBackingStore).
#if defined(UI_REQUIRES_BACKING_STORE)
  // e-ink / deferred-partial: dirty-rect accumulator. Each painted node reports
  // its paint rect; at frame end the union is refreshed as one partial update
  // via display_partial_refresh.
  #define UI_REFRESH_MAX_RECTS 16
  struct UIRect16 { int16_t x, y, w, h; };
  static UIRect16 __ui_refresh_rects[UI_REFRESH_MAX_RECTS];
  static uint8_t __ui_refresh_rect_n = 0;
  static inline void ui_refresh_begin_frame() { __ui_refresh_rect_n = 0; }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) {
    if (w <= 0 || h <= 0) return;
    if (__ui_refresh_rect_n < UI_REFRESH_MAX_RECTS) {
      __ui_refresh_rects[__ui_refresh_rect_n].x = x;
      __ui_refresh_rects[__ui_refresh_rect_n].y = y;
      __ui_refresh_rects[__ui_refresh_rect_n].w = w;
      __ui_refresh_rects[__ui_refresh_rect_n].h = h;
      __ui_refresh_rect_n++;
    }
    // TODO Phase 5: coalesce overlapping rects into a tighter union; cap by
    // refresh budget; trigger a periodic full refresh for ghost clearing.
  }
  // Union all accumulated rects and issue one partial refresh of the bounding
  // region via the shim's display_partial_refresh entry point.
  static inline void ui_refresh_flush() {
    if (__ui_refresh_rect_n == 0) return;
    int16_t x0 = 32767, y0 = 32767, x1 = -32768, y1 = -32768;
    for (uint8_t i = 0; i < __ui_refresh_rect_n; i++) {
      const UIRect16& r = __ui_refresh_rects[i];
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      int16_t rx1 = (int16_t)(r.x + r.w), ry1 = (int16_t)(r.y + r.h);
      if (rx1 > x1) x1 = rx1;
      if (ry1 > y1) y1 = ry1;
    }
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > display_width()) x1 = display_width();
    if (y1 > display_height()) y1 = display_height();
    if (x1 > x0 && y1 > y0) {
      display_partial_refresh(x0, y0, (int16_t)(x1 - x0), (int16_t)(y1 - y0));
    }
  }
#elif defined(UI_BATCH_SPI_WRITES)
  // TFT immediate-refresh batching (CURRENTLY UNUSED — see note below).
  // Wraps the frame's draws in ONE SPI transaction so all per-node writes share
  // a single CS-asserted burst. add_rect is a no-op: TFT has no partial-refresh
  // concept; the per-node draws already target the right pixels.
  //
  // NOTE: this branch is left in place but the emitter does NOT define
  // UI_BATCH_SPI_WRITES by default. The design assumed Adafruit_SPITFT's
  // startWrite/endWrite are reference-counted (nested calls = no-op for CS),
  // but the Adafruit_GFX version in this repo is NOT — every endWrite raises
  // CS unconditionally. So an outer frame startWrite gets closed by the first
  // inner draw's endWrite → black screen. Re-enable only after either (a)
  // upgrading to a ref-counted Adafruit_GFX or (b) adding a runtime flag the
  // inner draw primitives check to skip their own startWrite/endWrite.
  // See docs/superpowers/specs/2026-07-06-tft-spi-write-batching-design.md.
  static inline void ui_refresh_begin_frame() { display_startWrite(); }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }
  static inline void ui_refresh_flush() { display_endWrite(); }
#else
  // No batching (e.g. SDL native host render): true no-ops.
  #define ui_refresh_begin_frame()  ((void)0)
  #define ui_refresh_add_rect(x, y, w, h) ((void)0)
  #define ui_refresh_flush()        ((void)0)
#endif

// ── Multi-screen navigation ─────────────────────────────────────────────────
// Touch/scroll/keyboard state reset by navigation.
static uint8_t __ui_touch_state = 0;
static int16_t __ui_touch_node = -1;  // int16: node index can exceed 127
// Unified scroll gesture: one owning scroll container per gesture, one baseline.
// overscrollPx/settling live on the node; only the settle-animation state is here.
static int16_t __ui_scroll_node = -1;            // owning scroll container (int16: node index can exceed 127)
// Per-node flag: 1 if the scroll-container loop successfully allocated a Mode B
// canvas for this node on a recent frame. ui_apply_scroll_delta gates scrolling
// on this — containers whose canvas won't fit (fragmented heap / no PSRAM) are
// frozen-but-not-torn rather than allowed to scroll with unclipped children.
// Sized at runtime via __ui_node_count; defaults to all-zero (lock until proven).
static uint8_t* __ui_scroll_canvas_ok = nullptr;
// One-shot scroll memory warnings (indexed by node).
static uint8_t* __ui_scroll_mem_warned = nullptr;
// Precomputed draw order (lower z-index first, then source index). Built once in
// ui_init; zIndex is static after mount so this stays valid for the app lifetime.
static uint16_t* __ui_draw_order = nullptr;
// Non-virtualized scroll-container node indices (built once in ui_init).
static uint16_t* __ui_scroll_owners = nullptr;
static uint16_t __ui_scroll_owner_count = 0;
// First NODE_FILL on the active screen (for framebuffer bg seed).
static uint16_t __ui_active_screen_bg_node = 0xFFFF;
static uint32_t __ui_settle_start_ms = 0;        // when the active settle animation began
static int16_t __ui_settle_from_overscroll = 0;  // settle start value (bounce-back)
static int16_t __ui_settle_from_scrollY = 0;     // settle start value (edge snap; sign: +toward 0, -toward max)
static uint8_t __ui_kb_visible = 0;

static uint8_t __ui_active_screen = 0;   // which screen is visible/interactive
extern const uint16_t __ui_screen_count;  // total number of screens (emitted by lowering)

// ── Image assets ────────────────────────────────────────────────────────────
struct UIImage { uint16_t w; uint16_t h; const UI_COLOR_T* data; };
extern const UIImage __ui_images[];
extern const uint16_t __ui_image_count;

// ── @keyframes animations ───────────────────────────────────────────────────
struct UIKeyframeStop {
  uint8_t percent;
  uint8_t props; // bitmask: 1=background, 2=color, 4=opacity, 8=transform, 16=size
  uint32_t bg;
  uint32_t fg;
  uint8_t opacity;
  int16_t transformOffsetX;
  int16_t transformOffsetY;
  int16_t translatePctX;
  int16_t translatePctY;
  int16_t scaleX;
  int16_t scaleY;
  int16_t rotateDeg;
  int16_t width;
  int16_t height;
};
#define UI_KF_BG 1
#define UI_KF_FG 2
#define UI_KF_OPACITY 4
#define UI_KF_TRANSFORM 8
#define UI_KF_SIZE 16
struct UIKeyframeSet {
  uint8_t stopCount;
  const UIKeyframeStop* stops;
};
struct UIAnimation {
  uint16_t node;
  uint8_t keyframeSet;
  uint16_t durationMs;
  uint16_t delayMs;
  int16_t iterations;
  int16_t baseWidth;
  int16_t baseHeight;
  int8_t originX;
  int8_t originY;
  uint8_t timingFunction;  // UI_TIMING_* — applied to the lerp factor between stops
  uint32_t elapsed;
  uint8_t active;
  uint32_t lastUpdateMs;  // throttle: only redraw every ~100ms to avoid tearing
};
// animation-timing-function codes (kept in sync with model.ts TIMING_*).
#define UI_TIMING_LINEAR 0
#define UI_TIMING_EASE_IN_OUT 1
#define UI_TIMING_EASE 2
#define UI_TIMING_EASE_IN 3
#define UI_TIMING_EASE_OUT 4

// Apply an easing curve to a 0..100 linear lerp factor. Pure integer math
// (no floats on device). Uses Newton-Raphson to solve the cubic-bezier x axis
// for the input k, then returns the bezier's y — identical algorithm + control
// points to easeCurveLerpK in model.ts so preview and device agree.
// Control points are /1000 fixed point; bezierX/Y(t) = 3(1-t)²t·c1 + 3(1-t)t²·c2 + t³.
static inline uint8_t ui_ease_lerp_k(uint8_t timing, uint8_t k) {
  if (timing == UI_TIMING_LINEAR || k == 0) return k;
  if (k >= 100) return 100;
  int32_t x1, y1, x2, y2;
  switch (timing) {
    case UI_TIMING_EASE_IN_OUT: x1 = 420; y1 = 0;   x2 = 580; y2 = 1000; break;
    case UI_TIMING_EASE:        x1 = 250; y1 = 100; x2 = 250; y2 = 1000; break;
    case UI_TIMING_EASE_IN:     x1 = 420; y1 = 0;   x2 = 1000; y2 = 1000; break;
    case UI_TIMING_EASE_OUT:    x1 = 0;   y1 = 0;   x2 = 580; y2 = 1000; break;
    default: return k;
  }
  // Control points are /1000 (0..1000 == 0..1). t is parametric, also /1000.
  // X(t) = 3(1-t)²t·x1 + 3(1-t)t²·x2 + t³. Solve X(t)=targetX for t by bisection,
  // then return Y(t). Bisection (not Newton-Raphson): Newton diverges for curves
  // whose x-derivative is ~0 near an endpoint (ease-out: x1=0), snapping the dot
  // to the wrong stop. X(t) is monotonic for valid CSS points, so bisection always
  // converges. Products of four /1000 values are /1e12; t³ is /1e9 (×1000 to align).
  // int64 accumulation avoids overflow (3e12 > INT32_MAX). Identical algorithm +
  // control points to easeCurveLerpK in model.ts — preview and device must agree.
  int32_t targetX = (int32_t)k * 10;          // input on the /1000 x axis
  int32_t lo = 0, hi = 1000;
  for (uint8_t i = 0; i < 14; i++) {
    int32_t t = (lo + hi) >> 1;
    int32_t mt = 1000 - t;
    int64_t termX1 = (int64_t)3 * mt * mt * t * x1;   // /1e12
    int64_t termX2 = (int64_t)3 * mt * t * t * x2;    // /1e12
    int64_t termX3 = (int64_t)t * t * t * 1000;       // /1e12 (t³ was /1e9)
    int32_t X = (int32_t)((termX1 + termX2 + termX3) / 1000000000LL);  // back to /1000
    if (X < targetX) lo = t; else hi = t;
  }
  int32_t t = (lo + hi) >> 1;
  int32_t mt = 1000 - t;
  int64_t termY1 = (int64_t)3 * mt * mt * t * y1;
  int64_t termY2 = (int64_t)3 * mt * t * t * y2;
  int64_t termY3 = (int64_t)t * t * t * 1000;
  int32_t Y = (int32_t)((termY1 + termY2 + termY3) / 1000000000LL);  // /1000
  return (uint8_t)(Y / 10);  // back to /100
}
extern const UIKeyframeSet __ui_keyframe_sets[];
extern const uint16_t __ui_keyframe_set_count;
extern UIAnimation __ui_anims[];
extern const uint16_t __ui_anim_count;

// ── List bindings ───────────────────────────────────────────────────────────
struct UIListBinding {
  uint16_t node;
  uint16_t (*countFn)(void);
  void (*itemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*tapFn)(uint16_t idx);  // optional: called when an item is tapped
};
extern UIListBinding __ui_list_bindings[];
extern const uint16_t __ui_list_binding_count;

// ── Canvas bindings (ui.drawCanvas) ─────────────────────────────────────────
// Each canvas node's user-supplied draw function. Called each frame with the
// node's offscreen CuttlefishCanvas16 set as the active draw target, so the
// lowered callback body draws via the same ui_display_* wrappers as everything.
struct UICanvasBinding {
  uint16_t node;
  void (*fn)(CuttlefishCanvas16* canvas);
};
extern UICanvasBinding __ui_canvas_bindings[];
extern const uint16_t __ui_canvas_binding_count;

// ── Input bindings (two-way) ─────────────────────────────────────────────────
// ui.bindInput(node, cb) — cb fires with the node's current text whenever the
// bound <input>'s textBuffer changes (e.g. user typed via on-screen keyboard).
// lastSeen holds the previously-observed text so the runtime can detect change.
struct UIInputBinding {
  uint16_t node;
  void (*cb)(const char* text);
  char lastSeen[UI_TEXT_BUF + 1];
};
extern UIInputBinding __ui_input_bindings[];
extern const uint16_t __ui_input_binding_count;

// List bindings are now carried ON each node (listCountFn/listItemFn/listTapFn).
// The UIListBinding table below is still emitted by the lowering for the
// node-initializer to read at static-init time; the runtime never indexes it.

static uint8_t __ui_fade_opacity = 100;  // fade-in animation (0=transparent, 100=full)
static uint16_t __ui_fade_elapsed = 0;
static uint16_t __ui_fade_duration = 200; // ms

// Early forward declaration: ui_navigate (below) calls ui_release_canvas_state
// and ui_set_pressed (defined later) during screen changes. Needed on native
// (single TU, no Arduino auto-prototyper).
static inline void ui_release_canvas_state();
static inline void ui_set_pressed(uint16_t nodeIdx, uint8_t pressed);
static inline void ui_refresh_active_screen_bg_node();

// Navigate to a screen by index. Marks the new screen's nodes dirty + starts fade.
static inline void ui_navigate(uint8_t screenIdx) {
  if (screenIdx >= __ui_screen_count || screenIdx == __ui_active_screen) return;
  __ui_active_screen = screenIdx;
  ui_refresh_active_screen_bg_node();
  // Reset scroll/touch state so the old screen's scroll container doesn't
  // interfere with the new screen. Release any currently-pressed button FIRST:
  // navigation fires from a button's click handler during touch-down, so the
  // matching touch-up release would otherwise be suppressed by the reset below
  // and the button would stay stuck in its :pressed color.
  if (__ui_touch_node >= 0 && __ui_touch_node < __ui_node_count &&
      __ui_nodes[__ui_touch_node].kind == NODE_BUTTON && __ui_nodes[__ui_touch_node].value != 0) {
    ui_set_pressed((uint16_t)__ui_touch_node, 0);
  }
  __ui_scroll_node = -1;
  __ui_touch_node = -1;
  __ui_touch_state = 0;
  __ui_kb_visible = 0;
  // Free every persistent canvas so the new screen allocates into a clean,
  // unfragmented heap. Without this, the previous screen's canvas buffer stays
  // resident and fragments the heap, so the new screen's buffer can't get a
  // contiguous block (the "works first, then blanks until reset" symptom).
  ui_release_canvas_state();
  // Clear the entire display so old screen content doesn't show. On deferred-
  // refresh panels (e-ink) a full clear flashes, so skip it — the all-nodes-
  // dirty marking below drives a full repaint via partial refresh instead.
#ifndef UI_REFRESH_DEFERRED
  display_fillScreen(0x0000);
#endif
  // Mark all nodes dirty so the new screen fully redraws.
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
    __ui_nodes[i].layoutCacheKey = 0;
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) __ui_nodes[i].lastTextWidth = -1;
    else __ui_nodes[i].lastTextWidth = 0;
  }
}
extern const uint16_t __ui_font_face_count;

#define UI_NO_PARENT 0xFFFF   // sentinel: out of uint16_t node-index range

// Forward declarations suppress Arduino's auto-prototyper, which would insert
// prototypes before UIFontFace/UIFontGlyph are declared.
static inline const UIFontFace* ui_font_face(uint8_t id);
static inline const UIFontGlyph* ui_font_glyph(const UIFontFace* face, uint16_t codepoint);
static inline uint8_t ui_font_alpha_at(const UIFontFace* face, const UIFontGlyph* glyph, uint16_t pixelIndex);
static inline uint16_t ui_asset_text_width(const char* text, const UIFontFace* face);
static inline uint8_t ui_asset_text_height(const UIFontFace* face);
static inline uint8_t ui_draw_asset_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t antialias, uint8_t fontFace);
static inline uint16_t ui_text_width(const char* text, uint8_t ts, uint8_t fontFace, int8_t letterSpacing);
struct UITextLine;
static inline uint8_t ui_text_next_line(const char** cursor, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, UITextLine* out);
static inline void ui_text_layout_metrics(const char* text, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, uint8_t lineHeight, uint16_t* outW, uint16_t* outH);
static inline void ui_invalidate_text_layout_cache(uint16_t nodeIdx);
static inline uint16_t ui_node_text_max_width(uint16_t nodeIdx);
static inline void ui_node_text_layout_metrics(uint16_t nodeIdx, uint16_t textMaxW, uint16_t* outW, uint16_t* outH);
static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah, int16_t bx, int16_t by, int16_t bw, int16_t bh);
static inline uint8_t ui_is_effectively_visible(uint16_t nodeIdx);
static inline uint8_t ui_node_draws_before(uint16_t a, uint16_t b);
static inline void ui_node_paint_rect(uint16_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH, UIRect* out);
static inline void ui_node_current_paint_rect(uint16_t nodeIdx, UIRect* out);
static inline uint8_t ui_subtree_current_paint_rect(uint16_t nodeIdx, UIRect* out);
static inline void ui_mark_overlapping_higher_layers_dirty(uint16_t nodeIdx);
static inline void ui_mark_overlapping_higher_layers_dirty_for_rect(uint16_t nodeIdx, const UIRect* r);
static inline void ui_mark_scroll_view_dirty(uint16_t scrollNode);
static inline void ui_release_canvas_state();
static inline void ui_set_visible(uint16_t nodeIdx, uint8_t visible);
static inline void ui_invalidate_scroll_canvas_for_node(uint16_t nodeIdx);
static inline uint8_t ui_clip_rect_to_rect(UIRect* r, const UIRect* clip);
static inline void ui_fill_rect_clipped(int16_t x, int16_t y, int16_t w, int16_t h, const UIRect* clip, UI_COLOR_T color);
static inline void ui_hline_clipped(int16_t x, int16_t y, int16_t w, const UIRect* clip, UI_COLOR_T color);
static inline void ui_vline_clipped(int16_t x, int16_t y, int16_t h, const UIRect* clip, UI_COLOR_T color);
static inline void ui_draw_rect_outline_clipped(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t style, uint8_t width, const UIRect* clip, UI_COLOR_T color);
static inline void ui_draw_node_decoration_clipped(uint16_t nodeIdx, int16_t drawY, const UIRect* clip);
// Forward declarations for functions used before their definition in the
// single native translation unit (Arduino's auto-prototyper hides this;
// native emits one TU so explicit forwards are needed).
static inline int8_t ui_rich_link_hit(uint16_t nodeIdx, int16_t px, int16_t py);
static inline CuttlefishCanvas16* ui_aa_begin(int16_t w, int16_t h, UI_COLOR_T bg);
static inline void ui_aa_end(CuttlefishCanvas16* c);
static inline void ui_aa_push(CuttlefishCanvas16* c, int16_t dx, int16_t dy);
static inline void ui_aa_line(CuttlefishCanvas16* c, float x0, float y0, float x1, float y1, UI_COLOR_T color);
static inline void ui_aa_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color);
static inline void ui_aa_fill_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color);
static inline uint8_t ui_repair_current_node_paint_with_parent(uint16_t nodeIdx, UIRect* r);
static inline void ui_clear_node_paint_rect(uint16_t nodeIdx, const UIRect* paintRect);
static inline uint8_t ui_try_repair_geometry_fill(uint16_t nodeIdx, const UIRect* oldRect);
static inline void ui_draw_node_border(uint16_t i, int16_t drawX, int16_t drawY, UI_COLOR_T color);
static inline void ui_draw_node_outline(uint16_t i, int16_t drawX, int16_t drawY);
static inline void ui_draw_gradient_fill(uint16_t i, int16_t drawY);
static inline uint8_t ui_rotation_quadrant(int16_t deg);
static inline int16_t ui_rotated_face_w(uint16_t nodeIdx, int16_t w, int16_t h);
static inline int16_t ui_rotated_face_h(uint16_t nodeIdx, int16_t w, int16_t h);
static inline void ui_draw_image_rotated(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg);
static inline void ui_draw_image_with_fit(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                          uint8_t fitMode, int16_t targetW, int16_t targetH);
static inline void ui_draw_scaled_image(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                         int16_t drawW, int16_t drawH);

static CuttlefishDisplayTarget* __ui_gfx = display_defaultTarget();
// Persistent canvas slots, all freed on screen change (ui_navigate) so each
// screen starts with a clean heap. Without this, the first screen's canvas
// buffer stays resident and fragments the heap, so a later screen's buffer
// can't get a contiguous block — manifesting as that element blanking until a
// hard reset. File-scoped (not function-static) so ui_release_canvas_state can
// reach them.
static CuttlefishCanvas16* __ui_container_canvas = nullptr;  // Mode B shift-and-repair
static CuttlefishCanvas16* __ui_list_canvas = nullptr;       // virtualized <list> viewport
static int16_t __ui_list_canvas_node = -1;                   // node currently represented by __ui_list_canvas
static CuttlefishCanvas16* __ui_node_canvas = nullptr;       // <canvas> element offscreen
static CuttlefishCanvas16* __ui_repair_canvas = nullptr;     // buffered-paint / exposed-strip
static int16_t __ui_canvas_fallback_w = 0;                   // dimensions for direct <canvas> fallback
static int16_t __ui_canvas_fallback_h = 0;
// Draw offset: normally zero. The <canvas> allocation fallback sets it so
// callback-local coordinates draw into the node's current display/canvas target.
static int16_t __ui_draw_off_x = 0;
static int16_t __ui_draw_off_y = 0;

// Release every persistent canvas so the next screen allocates into a clean
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

#if defined(ESP32)
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t maxAlloc = ESP.getMaxAllocHeap();
  Serial.printf(
    "[cuttlefish] WARNING: #%s (%dx%d) needs %lu bytes for accurate scroll — %s. "
    "heap free=%lu max_alloc=%lu budget=%d. "
    "Shrink the scroll viewport in CSS, trim fonts/images, or use PSRAM.\n",
    label, vw, vh, (unsigned long)need, reasonText,
    (unsigned long)freeHeap, (unsigned long)maxAlloc, UI_SCROLL_CANVAS_BUDGET_BYTES);
#elif defined(ESP8266)
  uint32_t freeHeap = ESP.getFreeHeap();
  Serial.printf(
    "[cuttlefish] WARNING: #%s (%dx%d) needs %lu bytes for accurate scroll — %s. "
    "heap free=%lu budget=%d. "
    "Shrink the scroll viewport in CSS, trim fonts/images, or reduce UI footprint.\n",
    label, vw, vh, (unsigned long)need, reasonText,
    (unsigned long)freeHeap, UI_SCROLL_CANVAS_BUDGET_BYTES);
#else
  // Non-Arduino target (e.g. SDL native): no Serial, so use standard-C printf.
  // The native framework forces <cstdio> so printf is available here.
  printf(
    "[cuttlefish] WARNING: #%s (%dx%d) needs %lu bytes for accurate scroll — %s. "
    "budget=%d. Shrink the scroll viewport in CSS or trim UI assets.\n",
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
}

static inline CuttlefishDisplayTarget* ui_display_get_target() { return __ui_gfx; }
static inline void ui_display_set_target(CuttlefishDisplayTarget* target) {
  __ui_gfx = target ? target : display_defaultTarget();
}
static inline void ui_display_use_default_target() {
  __ui_gfx = display_defaultTarget();
}
static inline uint8_t ui_display_is_default_target() {
  return __ui_gfx == display_defaultTarget();
}
static inline int16_t ui_display_target_width() {
  return display_targetWidth(__ui_gfx);
}
static inline int16_t ui_display_target_height() {
  return display_targetHeight(__ui_gfx);
}
static inline int16_t ui_clamp_i16(int16_t value, int16_t lo, int16_t hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}
static inline void ui_display_target_bounds(int16_t* left, int16_t* top, int16_t* right, int16_t* bottom) {
  if (left) *left = (int16_t)(-__ui_draw_off_x);
  if (top) *top = (int16_t)(-__ui_draw_off_y);
  if (right) *right = (int16_t)(ui_display_target_width() - __ui_draw_off_x);
  if (bottom) *bottom = (int16_t)(ui_display_target_height() - __ui_draw_off_y);
}
static inline uint8_t ui_clip_rect_to_display_target(int16_t* x, int16_t* y, int16_t* w, int16_t* h) {
  if (!x || !y || !w || !h || *w <= 0 || *h <= 0) return 0;
  int16_t left, top, right, bottom;
  ui_display_target_bounds(&left, &top, &right, &bottom);
  int16_t x0 = *x > left ? *x : left;
  int16_t y0 = *y > top ? *y : top;
  int16_t x1 = (int16_t)(*x + *w);
  int16_t y1 = (int16_t)(*y + *h);
  if (x1 > right) x1 = right;
  if (y1 > bottom) y1 = bottom;
  if (x0 >= x1 || y0 >= y1) return 0;
  *x = x0;
  *y = y0;
  *w = (int16_t)(x1 - x0);
  *h = (int16_t)(y1 - y0);
  return 1;
}
static inline void ui_display_draw_pixel(int16_t x, int16_t y, UI_COLOR_T color) {
  display_targetDrawPixel(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_rgb_bitmap(int16_t x, int16_t y, const UI_COLOR_T* bitmap, int16_t w, int16_t h) {
  display_targetDrawRGBBitmap(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, bitmap, w, h);
}
static inline void ui_display_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  display_targetFillRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_fast_hline(int16_t x, int16_t y, int16_t w, UI_COLOR_T color) {
  display_targetDrawFastHLine(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_fast_vline(int16_t x, int16_t y, int16_t h, UI_COLOR_T color) {
  display_targetDrawFastVLine(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, h, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_fill_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {
  display_targetFillRoundRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_rect(int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T color) {
  display_targetDrawRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, UI_COLOR_T color) {
  display_targetDrawRoundRect(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, w, h, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) {
  display_targetDrawLine(__ui_gfx, x0 + __ui_draw_off_x, y0 + __ui_draw_off_y,
    x1 + __ui_draw_off_x, y1 + __ui_draw_off_y, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_fill_circle(int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {
  display_targetFillCircle(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_draw_circle(int16_t x, int16_t y, int16_t r, UI_COLOR_T color) {
  display_targetDrawCircle(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y, r, UI_MAYBE_SNAP_MONO565(color));
}
static inline void ui_display_set_cursor(int16_t x, int16_t y) {
  display_targetSetCursor(__ui_gfx, x + __ui_draw_off_x, y + __ui_draw_off_y);
}
static inline void ui_display_set_text_color(UI_COLOR_T fg, UI_COLOR_T bg) {
  display_targetSetTextColorBg(__ui_gfx, fg, bg);
}
static inline void ui_display_set_text_color_solid(UI_COLOR_T fg) {
  display_targetSetTextColor(__ui_gfx, fg);
}
static inline void ui_display_set_text_size(uint8_t size) {
  display_targetSetTextSize(__ui_gfx, size);
}
static inline void ui_display_set_text_wrap(bool wrap) {
  display_targetSetTextWrap(__ui_gfx, wrap);
}
static inline void ui_display_print(const char* text) {
  display_targetPrint(__ui_gfx, text);
}

// ── Scroll engine: Input layer ───────────────────────────────────────────────
// raw touch sample → smoothed delta (dy). Capacitive: passthrough 1:1.
// Resistive: deadband suppresses sub-N-px jitter (steady drag still 1:1).
// 'none' tier compiles drag scroll out entirely.
static int16_t __ui_scroll_prev_dy = 0;  // last smoothed delta (low-pass state)

static inline int16_t ui_scroll_scale_dy(int16_t dy) {
  int32_t scaled = (int32_t)dy * (int32_t)UI_SCROLL_DRAG_SCALE_X10;
  return (int16_t)(scaled >= 0 ? (scaled + 5) / 10 : (scaled - 5) / 10);
}

static inline int16_t ui_scroll_smooth_dy(int16_t dy) {
#if UI_SCROLL_INPUT_TIER_CAPACITIVE
  __ui_scroll_prev_dy = dy;
  return ui_scroll_scale_dy(dy);
#elif UI_SCROLL_INPUT_TIER_RESISTIVE
  int16_t db = (int16_t)UI_SCROLL_DEADBAND_PX;
  if (dy >= -db && dy <= db) {
    // Deadband: kill per-sample jitter around zero. Steady drag (|dy|>db) below
    // passes through unchanged, so steady-state is 1:1 (spec Q1).
    __ui_scroll_prev_dy = 0;
    return 0;
  }
  __ui_scroll_prev_dy = dy;
  return ui_scroll_scale_dy(dy);
#else
  (void)dy;
  return 0;
#endif
}

// ── Scroll engine: Physics layer ─────────────────────────────────────────────
// 1:1 in bounds; rubber-band at edges; bounce-back/snap on release. No fling.
// On constrained render tiers (no elastic), overscroll is hard-clamped away.

static inline int16_t ui_scroll_max(int16_t node) {
  if (node < 0) return 0;
  int16_t m = __ui_nodes[node].contentHeight - __ui_nodes[node].box.h;
  return m < 0 ? 0 : m;
}

// Rubber-band excursion for d cumulative pixels dragged past a boundary.
// r = maxOverscroll * d / (d + stiffness). stiffness held as X10 fixed-point.
static inline int16_t ui_scroll_overscroll_for(int16_t d) {
  if (d <= 0) return 0;
  int16_t maxOv = (int16_t)UI_SCROLL_MAX_OVERSCROLL;
  int16_t stiffX10 = (int16_t)UI_SCROLL_STIFFNESS_X10;
  if (stiffX10 <= 0) stiffX10 = 1;
  int32_t r = ((int32_t)maxOv * (int32_t)d) / ((int32_t)d + (int32_t)stiffX10);
  return r > maxOv ? maxOv : (int16_t)r;
}

// Apply a smoothed drag delta to the owning scroll node. Returns 1 if the view
// changed (needs redraw). Sets overscrollPx for rubber-band excursions; scrollY
// itself never leaves [0, maxScroll] so the committed position stays valid.
static inline uint8_t ui_apply_scroll_delta(int16_t node, int16_t dy) {
  if (node < 0 || dy == 0) return 0;
  int16_t sy = __ui_nodes[node].scrollY;
  int16_t maxS = ui_scroll_max(node);
  int16_t nextY = sy - dy;
  int16_t prevOv = __ui_nodes[node].overscrollPx;
  int16_t nextOv = prevOv;
  if (nextY < 0) {
    __ui_nodes[node].scrollY = 0;
    // Cumulative drag past the top boundary since crossing it.
    int16_t draggedPast = dy - sy;            // how far past 0 this delta pushed
    int16_t cum = prevOv + draggedPast;
    if (cum < 0) cum = 0;
#if UI_SCROLL_ELASTIC
    nextOv = ui_scroll_overscroll_for(cum);
#else
    nextOv = 0;
#endif
  } else if (nextY > maxS) {
    __ui_nodes[node].scrollY = maxS;
    int16_t draggedPast = nextY - maxS;
    int16_t cum = (prevOv < 0 ? -prevOv : 0) + draggedPast;  // prevOv<0 = bottom
    if (cum < 0) cum = 0;
#if UI_SCROLL_ELASTIC
    nextOv = -ui_scroll_overscroll_for(cum);   // negative = bottom overshoot
#else
    nextOv = 0;
#endif
  } else {
    __ui_nodes[node].scrollY = nextY;
    nextOv = 0;                                 // returned in-bounds → reset
  }
  __ui_nodes[node].overscrollPx = nextOv;
  uint8_t changed = (__ui_nodes[node].scrollY != sy) || (nextOv != prevOv);
  if (changed) ui_mark_scroll_view_dirty((uint16_t)node);
  return changed;
}

// On release: arm a bounded settle animation — bounce overscroll back to 0, or
// edge-snap scrollY within edgeSnapPx. The animation runs in ui_tick.
static inline uint8_t ui_scroll_release(int16_t node) {
  if (node < 0) return 0;
  uint8_t changed = 0;
  if (__ui_nodes[node].overscrollPx != 0) {
    __ui_nodes[node].settling = 1;
    __ui_settle_from_overscroll = __ui_nodes[node].overscrollPx;
    __ui_settle_from_scrollY = 0;
    __ui_settle_start_ms = millis();
    changed = 1;
  } else {
    int16_t sy = __ui_nodes[node].scrollY;
    int16_t maxS = ui_scroll_max(node);
    int16_t snap = (int16_t)UI_SCROLL_EDGE_SNAP_PX;
    if (sy > 0 && sy <= snap) {
      __ui_nodes[node].settling = 1;
      __ui_settle_from_scrollY = sy;            // positive → snap toward 0
      __ui_settle_from_overscroll = 0;
      __ui_settle_start_ms = millis();
      changed = 1;
    } else if (maxS > 0 && sy < maxS && sy >= maxS - snap) {
      __ui_nodes[node].settling = 1;
      __ui_settle_from_scrollY = sy - maxS;     // negative → snap toward max
      __ui_settle_from_overscroll = 0;
      __ui_settle_start_ms = millis();
      changed = 1;
    }
  }
  return changed;
}

// Advance the settle animation for a node (called from ui_tick). Ease-out over
// UI_SCROLL_SETTLE_MS, terminating at the boundary. Bounded — always ends.
static inline void ui_scroll_advance_settle(uint8_t node, uint16_t deltaMs) {
  (void)deltaMs;
  if (node >= __ui_node_count || !__ui_nodes[node].settling) return;
  uint32_t elapsed = millis() - __ui_settle_start_ms;
  uint16_t dur = (uint16_t)UI_SCROLL_SETTLE_MS;
  // ease-out: k = 1 - (1 - t)^2, t in [0,1]
  uint32_t t = elapsed >= dur ? 100 : (elapsed * 100) / dur;
  uint32_t k = 100 - ((100 - t) * (100 - t)) / 100;
  if (__ui_nodes[node].overscrollPx != 0) {
    int16_t from = __ui_settle_from_overscroll;
    __ui_nodes[node].overscrollPx = (int16_t)(from - (int32_t)(from * k) / 100);
    if (t >= 100) __ui_nodes[node].overscrollPx = 0;
  } else if (__ui_settle_from_scrollY != 0) {
    int16_t from = __ui_settle_from_scrollY;   // +toward 0, -toward max
    int16_t maxS = ui_scroll_max(node);
    if (from > 0) {
      __ui_nodes[node].scrollY = (int16_t)(from - (int32_t)(from * k) / 100);
      if (t >= 100) __ui_nodes[node].scrollY = 0;
    } else {  // from < 0: snap toward maxS
      int16_t target = maxS;
      __ui_nodes[node].scrollY = target + (int16_t)((int32_t)from * (100 - k) / 100);
      if (t >= 100) __ui_nodes[node].scrollY = target;
    }
  }
  if (t >= 100) __ui_nodes[node].settling = 0;
  ui_mark_scroll_view_dirty(node);
}

// ── Full-screen framebuffer (opt-in PSRAM perf experiment) ───────────────────
// Disabled by default: pushing a full 320×240 frame for a tiny dirty button can
// look like a global brightness flash on SPI TFTs. Enable only when a target
// has enough PSRAM and a full-frame repaint is preferable to partial updates.
static CuttlefishCanvas16* __ui_fb = nullptr;
static uint8_t __ui_fb_tried = 0;  // 0 = not yet attempted, 1 = alloc attempted

// Get the framebuffer, allocating once (in PSRAM when available). Returns null
// when PSRAM is absent or the allocation failed — callers fall back to direct.
static inline CuttlefishCanvas16* ui_get_framebuffer() {
  if (__ui_fb_tried) return __ui_fb;  // one-time attempt; null means "none"
  __ui_fb_tried = 1;
#if UI_USE_FULL_FRAMEBUFFER && defined(ESP32) && defined(BOARD_HAS_PSRAM)
  if (psramFound()) {
    int16_t fw = display_width();
    int16_t fh = display_height();
    // GFXcanvas16 uses ps_malloc when ESP32 PSRAM malloc is hooked in via the
    // Arduino core; the allocation succeeds only if PSRAM is really present.
    __ui_fb = display_createCanvasPsram(fw, fh);
    if (!__ui_fb || !display_canvasBuffer(__ui_fb)) {
      // Allocation failed (PSRAM too small / not really mapped) — give up.
      __ui_fb = nullptr;
    }
  }
#endif
  return __ui_fb;
}

// Push the entire framebuffer to the display in one bulk SPI transaction.
static inline void ui_push_framebuffer() {
  if (!__ui_fb || !display_canvasBuffer(__ui_fb)) return;
  int16_t w = display_canvasWidth(__ui_fb);
  int16_t h = display_canvasHeight(__ui_fb);
  display_startWrite();
  display_setAddrWindow(0, 0, w, h);
  display_writePixels(display_canvasBuffer(__ui_fb), (uint32_t)w * h);
  display_endWrite();
}

static inline uint8_t ui_rotation_quadrant(int16_t deg) {
  int16_t normalized = deg % 360;
  if (normalized < 0) normalized += 360;
  if (normalized == 90) return 1;
  if (normalized == 180) return 2;
  if (normalized == 270) return 3;
  return 0;
}

static inline int16_t ui_rotated_face_w(uint16_t nodeIdx, int16_t w, int16_t h) {
  if (__ui_nodes[nodeIdx].kind != NODE_IMG &&
      !(__ui_nodes[nodeIdx].kind == NODE_FILL && __ui_nodes[nodeIdx].gradientEnabled == 0)) return w;
  uint8_t q = ui_rotation_quadrant(__ui_nodes[nodeIdx].rotateDeg);
  return (q == 1 || q == 3) ? h : w;
}

static inline int16_t ui_rotated_face_h(uint16_t nodeIdx, int16_t w, int16_t h) {
  if (__ui_nodes[nodeIdx].kind != NODE_IMG &&
      !(__ui_nodes[nodeIdx].kind == NODE_FILL && __ui_nodes[nodeIdx].gradientEnabled == 0)) return h;
  uint8_t q = ui_rotation_quadrant(__ui_nodes[nodeIdx].rotateDeg);
  return (q == 1 || q == 3) ? w : h;
}

// Draw image with object-fit: 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down.
// The sampler is bounded to the target box first, then quarter-turn rotated.
// This keeps cover cropped inside the element instead of overpainting siblings.
static inline void ui_draw_image_with_fit(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                          uint8_t fitMode, int16_t targetW, int16_t targetH) {
  if (!img || !img->data || img->w == 0 || img->h == 0 || targetW <= 0 || targetH <= 0) return;
  int16_t srcW = img->w, srcH = img->h;
  int16_t drawW = srcW, drawH = srcH;
  int16_t offX = (targetW - drawW) / 2;
  int16_t offY = (targetH - drawH) / 2;

  if (fitMode == 1) {
    drawW = targetW;
    drawH = targetH;
    offX = 0;
    offY = 0;
  } else if (fitMode == 2 || fitMode == 3 || fitMode == 4) {
    int32_t scaleX = ((int32_t)targetW * 1000) / srcW;
    int32_t scaleY = ((int32_t)targetH * 1000) / srcH;
    if (scaleX < 1) scaleX = 1;
    if (scaleY < 1) scaleY = 1;
    int32_t scale = scaleX;
    if (fitMode == 2) {
      if (scaleY < scaleX) scale = scaleY;
    } else if (fitMode == 3) {
      if (scaleY > scaleX) scale = scaleY;
    } else {
      if (scaleY < scaleX) scale = scaleY;
      if (scale > 1000) scale = 1000;
    }
    drawW = (int16_t)((int32_t)srcW * scale / 1000);
    drawH = (int16_t)((int32_t)srcH * scale / 1000);
    if (drawW < 1) drawW = 1;
    if (drawH < 1) drawH = 1;
    if (fitMode == 3) {
      if (drawW < targetW) drawW = targetW;
      if (drawH < targetH) drawH = targetH;
    }
    offX = (targetW - drawW) / 2;
    offY = (targetH - drawH) / 2;
  }

  uint8_t q = ui_rotation_quadrant(rotateDeg);
  int16_t clipX = x;
  int16_t clipY = y;
  int16_t clipW = (q == 1 || q == 3) ? targetH : targetW;
  int16_t clipH = (q == 1 || q == 3) ? targetW : targetH;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  int16_t txStart = 0, txEnd = targetW, tyStart = 0, tyEnd = targetH;
  if (q == 0) {
    txStart = ui_clamp_i16((int16_t)(clipX - x), 0, targetW);
    txEnd = ui_clamp_i16((int16_t)(clipX + clipW - x), 0, targetW);
    tyStart = ui_clamp_i16((int16_t)(clipY - y), 0, targetH);
    tyEnd = ui_clamp_i16((int16_t)(clipY + clipH - y), 0, targetH);
  } else if (q == 1) {
    txStart = ui_clamp_i16((int16_t)(clipY - y), 0, targetW);
    txEnd = ui_clamp_i16((int16_t)(clipY + clipH - y), 0, targetW);
    tyStart = ui_clamp_i16((int16_t)(x + targetH - (clipX + clipW)), 0, targetH);
    tyEnd = ui_clamp_i16((int16_t)(x + targetH - clipX), 0, targetH);
  } else if (q == 2) {
    txStart = ui_clamp_i16((int16_t)(x + targetW - (clipX + clipW)), 0, targetW);
    txEnd = ui_clamp_i16((int16_t)(x + targetW - clipX), 0, targetW);
    tyStart = ui_clamp_i16((int16_t)(y + targetH - (clipY + clipH)), 0, targetH);
    tyEnd = ui_clamp_i16((int16_t)(y + targetH - clipY), 0, targetH);
  } else {
    txStart = ui_clamp_i16((int16_t)(y + targetW - (clipY + clipH)), 0, targetW);
    txEnd = ui_clamp_i16((int16_t)(y + targetW - clipY), 0, targetW);
    tyStart = ui_clamp_i16((int16_t)(clipX - x), 0, targetH);
    tyEnd = ui_clamp_i16((int16_t)(clipX + clipW - x), 0, targetH);
  }
  if (txStart >= txEnd || tyStart >= tyEnd) return;
  for (int16_t ty = tyStart; ty < tyEnd; ty++) {
    int16_t localY = ty - offY;
    if (localY < 0 || localY >= drawH) continue;
    int16_t srcY = ((int32_t)localY * srcH) / drawH;
    if (srcY < 0) srcY = 0;
    if (srcY >= srcH) srcY = srcH - 1;
    for (int16_t tx = txStart; tx < txEnd; tx++) {
      int16_t localX = tx - offX;
      if (localX < 0 || localX >= drawW) continue;
      int16_t srcX = ((int32_t)localX * srcW) / drawW;
      if (srcX < 0) srcX = 0;
      if (srcX >= srcW) srcX = srcW - 1;
      UI_COLOR_T color = img->data[(int32_t)srcY * srcW + srcX];
      int16_t dx = tx;
      int16_t dy = ty;
      if (q == 1) {
        dx = targetH - 1 - ty;
        dy = tx;
      } else if (q == 2) {
        dx = targetW - 1 - tx;
        dy = targetH - 1 - ty;
      } else if (q == 3) {
        dx = ty;
        dy = targetW - 1 - tx;
      }
      ui_display_draw_pixel(x + dx, y + dy, color);
    }
  }
}

static inline void ui_draw_scaled_image(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                        int16_t drawW, int16_t drawH) {
  if (!img || !img->data || img->w == 0 || img->h == 0 || drawW <= 0 || drawH <= 0) return;
  uint8_t q = ui_rotation_quadrant(rotateDeg);
  int16_t clipX = x;
  int16_t clipY = y;
  int16_t clipW = (q == 1 || q == 3) ? drawH : drawW;
  int16_t clipH = (q == 1 || q == 3) ? drawW : drawH;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  int16_t dxStart = 0, dxEnd = drawW, dyStart = 0, dyEnd = drawH;
  if (q == 0) {
    dxStart = ui_clamp_i16((int16_t)(clipX - x), 0, drawW);
    dxEnd = ui_clamp_i16((int16_t)(clipX + clipW - x), 0, drawW);
    dyStart = ui_clamp_i16((int16_t)(clipY - y), 0, drawH);
    dyEnd = ui_clamp_i16((int16_t)(clipY + clipH - y), 0, drawH);
  } else if (q == 1) {
    dxStart = ui_clamp_i16((int16_t)(clipY - y), 0, drawW);
    dxEnd = ui_clamp_i16((int16_t)(clipY + clipH - y), 0, drawW);
    dyStart = ui_clamp_i16((int16_t)(x + drawH - (clipX + clipW)), 0, drawH);
    dyEnd = ui_clamp_i16((int16_t)(x + drawH - clipX), 0, drawH);
  } else if (q == 2) {
    dxStart = ui_clamp_i16((int16_t)(x + drawW - (clipX + clipW)), 0, drawW);
    dxEnd = ui_clamp_i16((int16_t)(x + drawW - clipX), 0, drawW);
    dyStart = ui_clamp_i16((int16_t)(y + drawH - (clipY + clipH)), 0, drawH);
    dyEnd = ui_clamp_i16((int16_t)(y + drawH - clipY), 0, drawH);
  } else {
    dxStart = ui_clamp_i16((int16_t)(y + drawW - (clipY + clipH)), 0, drawW);
    dxEnd = ui_clamp_i16((int16_t)(y + drawW - clipY), 0, drawW);
    dyStart = ui_clamp_i16((int16_t)(clipX - x), 0, drawH);
    dyEnd = ui_clamp_i16((int16_t)(clipX + clipW - x), 0, drawH);
  }
  if (dxStart >= dxEnd || dyStart >= dyEnd) return;
  if (q == 0) {
    // Simple case: no rotation, draw with scaling
    if (drawW == img->w && drawH == img->h) {
      int16_t rows = (int16_t)(dyEnd - dyStart);
      int16_t cols = (int16_t)(dxEnd - dxStart);
      for (int16_t row = 0; row < rows; row++) {
        ui_display_draw_rgb_bitmap((int16_t)(x + dxStart), (int16_t)(y + dyStart + row),
          img->data + (int32_t)(dyStart + row) * img->w + dxStart, cols, 1);
      }
    } else {
      // Scale using nearest-neighbor
      for (int16_t dy = dyStart; dy < dyEnd; dy++) {
        int16_t srcY = ((int32_t)dy * img->h) / drawH;
        for (int16_t dx = dxStart; dx < dxEnd; dx++) {
          int16_t srcX = ((int32_t)dx * img->w) / drawW;
          UI_COLOR_T color = img->data[(int32_t)srcY * img->w + srcX];
          ui_display_draw_pixel(x + dx, y + dy, color);
        }
      }
    }
    return;
  }
  for (int16_t dy = dyStart; dy < dyEnd; dy++) {
    int16_t srcY = ((int32_t)dy * img->h) / drawH;
    for (int16_t dx = dxStart; dx < dxEnd; dx++) {
      int16_t srcX = ((int32_t)dx * img->w) / drawW;
      UI_COLOR_T color = img->data[(int32_t)srcY * img->w + srcX];
      int16_t rdx = 0, rdy = 0;
      if (q == 1) {
        rdx = drawH - 1 - dy;
        rdy = dx;
      } else if (q == 2) {
        rdx = drawW - 1 - dx;
        rdy = drawH - 1 - dy;
      } else {
        rdx = dy;
        rdy = drawW - 1 - dx;
      }
      ui_display_draw_pixel(x + rdx, y + rdy, color);
    }
  }
}

static inline void ui_draw_image_rotated(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg) {
   uint8_t q = ui_rotation_quadrant(rotateDeg);
   int16_t clipX = x;
   int16_t clipY = y;
   int16_t clipW = (q == 1 || q == 3) ? img->h : img->w;
   int16_t clipH = (q == 1 || q == 3) ? img->w : img->h;
   if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
   if (q == 0) {
     int16_t sx0 = ui_clamp_i16((int16_t)(clipX - x), 0, (int16_t)img->w);
     int16_t sy0 = ui_clamp_i16((int16_t)(clipY - y), 0, (int16_t)img->h);
     int16_t sw = ui_clamp_i16(clipW, 0, (int16_t)(img->w - sx0));
     int16_t sh = ui_clamp_i16(clipH, 0, (int16_t)(img->h - sy0));
     for (int16_t row = 0; row < sh; row++) {
       ui_display_draw_rgb_bitmap((int16_t)(x + sx0), (int16_t)(y + sy0 + row),
         img->data + (int32_t)(sy0 + row) * img->w + sx0, sw, 1);
     }
     return;
   }
   uint16_t sxStart = 0, sxEnd = img->w, syStart = 0, syEnd = img->h;
   if (q == 1) {
     sxStart = (uint16_t)ui_clamp_i16((int16_t)(clipY - y), 0, (int16_t)img->w);
     sxEnd = (uint16_t)ui_clamp_i16((int16_t)(clipY + clipH - y), 0, (int16_t)img->w);
     syStart = (uint16_t)ui_clamp_i16((int16_t)(x + img->h - (clipX + clipW)), 0, (int16_t)img->h);
     syEnd = (uint16_t)ui_clamp_i16((int16_t)(x + img->h - clipX), 0, (int16_t)img->h);
   } else if (q == 2) {
     sxStart = (uint16_t)ui_clamp_i16((int16_t)(x + img->w - (clipX + clipW)), 0, (int16_t)img->w);
     sxEnd = (uint16_t)ui_clamp_i16((int16_t)(x + img->w - clipX), 0, (int16_t)img->w);
     syStart = (uint16_t)ui_clamp_i16((int16_t)(y + img->h - (clipY + clipH)), 0, (int16_t)img->h);
     syEnd = (uint16_t)ui_clamp_i16((int16_t)(y + img->h - clipY), 0, (int16_t)img->h);
   } else {
     sxStart = (uint16_t)ui_clamp_i16((int16_t)(y + img->w - (clipY + clipH)), 0, (int16_t)img->w);
     sxEnd = (uint16_t)ui_clamp_i16((int16_t)(y + img->w - clipY), 0, (int16_t)img->w);
     syStart = (uint16_t)ui_clamp_i16((int16_t)(clipX - x), 0, (int16_t)img->h);
     syEnd = (uint16_t)ui_clamp_i16((int16_t)(clipX + clipW - x), 0, (int16_t)img->h);
   }
   if (sxStart >= sxEnd || syStart >= syEnd) return;
   for (uint16_t sy = syStart; sy < syEnd; sy++) {
     for (uint16_t sx = sxStart; sx < sxEnd; sx++) {
       UI_COLOR_T color = img->data[(uint32_t)sy * img->w + sx];
       int16_t dx = 0;
       int16_t dy = 0;
       if (q == 1) {
         dx = (int16_t)(img->h - 1 - sy);
         dy = (int16_t)sx;
       } else if (q == 2) {
         dx = (int16_t)(img->w - 1 - sx);
         dy = (int16_t)(img->h - 1 - sy);
       } else {
         dx = (int16_t)sy;
         dy = (int16_t)(img->w - 1 - sx);
       }
       ui_display_draw_pixel(x + dx, y + dy, color);
     }
   }
 }

static inline void ui_push_canvas_rect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  UI_COLOR_T* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  // The canvas is viewport-sized: buffer row 0 = the first row of the viewport.
  // The display destination is (x, y) but the source buffer starts at (0, 0).
  // When a full-screen framebuffer is the active draw target, composite into it
  // via __ui_gfx (so the single bulk push at frame end captures everything).
  // Otherwise write straight to the display in one SPI transaction.
  if (__ui_fb) {
    if (w == stride) {
      ui_display_draw_rgb_bitmap(x, y, pixels, w, h);
      return;
    }
    for (int16_t row = 0; row < h; row++) {
      ui_display_draw_rgb_bitmap(x, y + row, pixels + (int32_t)row * stride, w, 1);
    }
    return;
  }
  display_startWrite();
  display_setAddrWindow(x, y, w, h);
  if (w == stride) {
    // Full-width: contiguous in buffer, single write.
    display_writePixels(pixels, (uint32_t)w * h);
    display_endWrite();
    return;
  }
  for (int16_t row = 0; row < h; row++) {
    display_writePixels(pixels + (int32_t)row * stride, w);
  }
  display_endWrite();
}

static inline void ui_draw_canvas_rect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  UI_COLOR_T* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  if (w == stride && h == display_canvasHeight(canvas)) {
    ui_display_draw_rgb_bitmap(x, y, pixels, w, h);
    return;
  }
  for (int16_t row = 0; row < h; row++) {
    ui_display_draw_rgb_bitmap(x, y + row, pixels + (int32_t)row * stride, w, 1);
  }
}

static inline void ui_push_buffered_scroll_canvas(CuttlefishCanvas16* bufferedScrollCanvas,
                                                  CuttlefishCanvas16* bufferedScrollRepaintCanvas,
                                                  int16_t bufferedScrollNode,
                                                  int16_t bufferedScrollVX,
                                                  int16_t bufferedScrollVY,
                                                  int16_t bufferedScrollRepaintY,
                                                  int16_t bufferedScrollRepaintH,
                                                  CuttlefishDisplayTarget* drawTarget) {
  if (bufferedScrollNode < 0 || !bufferedScrollCanvas || !display_canvasBuffer(bufferedScrollCanvas)) return;
  // Draw scrollbar into the canvas (canvas-local coords: 0,0 = viewport top-left).
  ui_display_set_target(bufferedScrollCanvas);
  int16_t si = bufferedScrollNode;
  int16_t vw = __ui_nodes[si].box.w;
  int16_t vh = __ui_nodes[si].box.h;
  if (bufferedScrollRepaintCanvas && bufferedScrollRepaintH > 0) {
    ui_draw_canvas_rect(bufferedScrollRepaintCanvas, 0, bufferedScrollRepaintY, vw, bufferedScrollRepaintH);
  }
  int16_t tx = vw - 4;
  uint16_t thumbH = (uint32_t)vh * vh / __ui_nodes[si].contentHeight;
  if (thumbH < 8) thumbH = 8;
  int16_t maxScroll = __ui_nodes[si].contentHeight - vh;
  uint16_t thumbY = (uint32_t)(vh - thumbH) * __ui_nodes[si].scrollY / (maxScroll > 0 ? maxScroll : 1);
  UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[si].fg >> 1) & UI_DIM_MASK);
  ui_display_fill_rect(tx, 0, 3, vh, dimFg);
  ui_display_fill_rect(tx, thumbY, 3, thumbH, __ui_nodes[si].fg);
  // Record the scrollY this canvas now reflects, so the next scroll frame can
  // compute its shift delta (Mode B) from scrollY - lastPaintedScrollY.
  __ui_nodes[si].lastPaintedScrollY = __ui_nodes[si].scrollY;
  // Push the canvas to the draw target at the viewport position (the
  // framebuffer when active, else the display directly).
  ui_display_set_target(drawTarget);
  ui_push_canvas_rect(bufferedScrollCanvas,
    bufferedScrollVX, bufferedScrollVY,
    vw, vh);
}

// Draw a scroll container's scrollbar directly on the display (Mode C).
static inline void ui_draw_scrollbar_direct(int16_t si, int16_t vox, int16_t voy) {
  if (si < 0 || si >= (int16_t)__ui_node_count) return;
  int16_t vw = __ui_nodes[si].box.w;
  int16_t vh = __ui_nodes[si].box.h;
  if (__ui_nodes[si].contentHeight <= vh) return;
  int16_t tx = vox + vw - 4;
  uint16_t thumbH = (uint32_t)vh * vh / __ui_nodes[si].contentHeight;
  if (thumbH < 8) thumbH = 8;
  int16_t maxScroll = __ui_nodes[si].contentHeight - vh;
  uint16_t thumbY = (uint32_t)(vh - thumbH) * __ui_nodes[si].scrollY / (maxScroll > 0 ? maxScroll : 1);
  UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[si].fg >> 1) & UI_DIM_MASK);
  ui_display_fill_rect(tx, voy, 3, vh, dimFg);
  ui_display_fill_rect(tx, (int16_t)(voy + thumbY), 3, thumbH, __ui_nodes[si].fg);
}

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  __ui_nodes[nodeIdx].dirty = 1;
  if (ui_is_effectively_visible(nodeIdx) &&
      __ui_nodes[nodeIdx].screenId == __ui_active_screen) {
    UIRect r;
    ui_node_current_paint_rect(nodeIdx, &r);
    if (r.w <= 0 || r.h <= 0) {
      ui_mark_overlapping_higher_layers_dirty(nodeIdx);
      return;
    }
    uint16_t p = __ui_nodes[nodeIdx].parent;
    while (p != UI_NO_PARENT && p < __ui_node_count) {
      if (__ui_nodes[p].scrollable &&
          !__ui_nodes[p].virtualized &&
          __ui_nodes[p].contentHeight > __ui_nodes[p].box.h) {
        UIRect clip = {
          __ui_nodes[p].box.x,
          __ui_nodes[p].box.y,
          __ui_nodes[p].box.w,
          __ui_nodes[p].box.h
        };
        if (!ui_rects_intersect(r.x, r.y, r.w, r.h, clip.x, clip.y, clip.w, clip.h)) {
          __ui_nodes[nodeIdx].dirty = 0;
          return;
        }
        if (r.x < clip.x ||
            r.x + r.w > clip.x + clip.w ||
            r.y < clip.y ||
            r.y + r.h > clip.y + clip.h) {
          ui_mark_scroll_view_dirty(p);
          return;
        }
        // Fully inside the viewport, but overflow scroll content is canvas-
        // composited. Promote to a scroll repaint — otherwise the defer path
        // drops the child's dirty flag without drawing (e.g. :pressed buttons).
        ui_mark_scroll_view_dirty(p);
        return;
      }
      p = __ui_nodes[p].parent;
    }
  }
  ui_mark_overlapping_higher_layers_dirty(nodeIdx);
}

// Set dirty=1 across a scroll subtree WITHOUT the per-child O(n) overlap repair.
// During scroll the subtree repaints into a freshly-cleared off-screen canvas, so
// intra-subtree overlap repair is pointless, and scroll children are draw-clipped
// to the container's viewport box — so all external higher-z neighbors of the
// viewport are covered by ONE overlap check at the container's paint rect (done by
// the caller). This drops scroll marking from O(K·n) to O(K + n).
static inline void ui_mark_subtree_dirty_local(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  for (uint16_t c = scrollNode + 1; c < __ui_nodes[scrollNode].subtreeEnd; c++) {
    __ui_nodes[c].dirty = 1;
  }
  __ui_nodes[scrollNode].dirty = 1;
}

// Mode C strip-only: direct-partial scroll when no viewport canvas fits and the
// scroll delta is small. Fills only the exposed strip on the display, then marks
// visible descendants dirty for direct draw — never clears the whole viewport.
static inline void ui_scroll_direct_prepare(uint16_t s, int16_t* outVX, int16_t* outVY) {
  int16_t vw = __ui_nodes[s].box.w;
  int16_t vh = __ui_nodes[s].box.h;
  int16_t vox = __ui_nodes[s].box.x;
  int16_t voy = __ui_nodes[s].box.y;
  UI_COLOR_T scrollBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
  int16_t deltaY = __ui_nodes[s].scrollY - __ui_nodes[s].lastPaintedScrollY;
  int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
  int16_t stripY = deltaY > 0 ? (int16_t)(vh - absDelta) : 0;
  ui_display_fill_rect(vox, (int16_t)(voy + stripY), vw, absDelta, scrollBg);
  for (uint16_t c = s + 1; c < __ui_nodes[s].subtreeEnd; c++) {
    if (!ui_is_effectively_visible(c) || __ui_nodes[c].screenId != __ui_active_screen) {
      __ui_nodes[c].dirty = 0;
      continue;
    }
    __ui_nodes[c].dirty = 1;
    if (__ui_nodes[c].kind == NODE_PROGRESS || __ui_nodes[c].kind == NODE_RANGE) {
      __ui_nodes[c].lastTextWidth = -1;
    }
    __ui_nodes[c].lastTextHeight = 0;
  }
  __ui_nodes[s].dirty = 0;
  if (outVX) *outVX = vox;
  if (outVY) *outVY = voy;
}

// Nearest overflow scroll container owning nodeIdx (or nodeIdx itself).
static inline int16_t ui_overflow_scroll_compositor(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return -1;
  if (__ui_nodes[nodeIdx].scrollable && !__ui_nodes[nodeIdx].virtualized &&
      __ui_nodes[nodeIdx].contentHeight > __ui_nodes[nodeIdx].box.h) {
    return (int16_t)nodeIdx;
  }
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable && !__ui_nodes[p].virtualized &&
        __ui_nodes[p].contentHeight > __ui_nodes[p].box.h) {
      return (int16_t)p;
    }
    p = __ui_nodes[p].parent;
  }
  return -1;
}

static inline void ui_mark_scroll_view_overlaps_dirty(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  if (!ui_is_effectively_visible(scrollNode)) return;
  if (__ui_nodes[scrollNode].screenId != __ui_active_screen) return;
  UIRect r;
  ui_node_current_paint_rect(scrollNode, &r);
  if (r.w <= 0 || r.h <= 0) return;
  for (uint16_t c = 0; c < __ui_node_count; c++) {
    if (c == scrollNode) continue;
    if (c > scrollNode && c < __ui_nodes[scrollNode].subtreeEnd) continue;
    if (__ui_nodes[c].dirty) continue;
    if (!ui_is_effectively_visible(c)) continue;
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_node_draws_before(scrollNode, c)) continue;
    UIRect cr;
    ui_node_current_paint_rect(c, &cr);
    if (cr.w <= 0 || cr.h <= 0) continue;
    if (ui_rects_intersect(r.x, r.y, r.w, r.h, cr.x, cr.y, cr.w, cr.h)) {
      __ui_nodes[c].dirty = 1;
    }
  }
}

static inline void ui_mark_scroll_subtree_dirty(uint16_t scrollNode) {
  ui_mark_subtree_dirty_local(scrollNode);
  // Single overlap check at the container's paint rect covers every external
  // higher-z neighbor of the viewport. The container index is the right one to
  // pass: scroll content lives within the container's stacking context, so
  // ui_node_draws_before(scrollNode, c) selects exactly the external layers that
  // should be repaired when the viewport is repainted.
  ui_mark_overlapping_higher_layers_dirty(scrollNode);
}

static inline void ui_mark_scroll_view_dirty(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  __ui_nodes[scrollNode].dirty = 1;
  ui_mark_scroll_view_overlaps_dirty(scrollNode);
}

static inline int16_t ui_scroll_ancestor_for_node(uint16_t nodeIdx) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) return (int16_t)p;
    p = __ui_nodes[p].parent;
  }
  return -1;
}

static inline void ui_invalidate_scroll_canvas_for_node(uint16_t nodeIdx) {
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent < 0) return;
  if (__ui_nodes[scrollParent].virtualized) return;
  if (__ui_nodes[scrollParent].contentHeight <= __ui_nodes[scrollParent].box.h) return;
  int16_t span = __ui_nodes[scrollParent].box.h > 0 ? __ui_nodes[scrollParent].box.h : 1;
  __ui_nodes[scrollParent].lastPaintedScrollY = __ui_nodes[scrollParent].scrollY - span;
}

static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah,
                                         int16_t bx, int16_t by, int16_t bw, int16_t bh) {
  return ax + aw > bx && ax < bx + bw && ay + ah > by && ay < by + bh;
}

static inline uint8_t ui_is_effectively_visible(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  if (!__ui_nodes[nodeIdx].visible) return 0;
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (!__ui_nodes[p].visible) return 0;
    p = __ui_nodes[p].parent;
  }
  return 1;
}

static inline uint8_t ui_node_draws_before(uint16_t a, uint16_t b) {
  if (__ui_nodes[a].zIndex != __ui_nodes[b].zIndex) {
    return __ui_nodes[a].zIndex < __ui_nodes[b].zIndex;
  }
  return a < b;
}

// Sort node indices once at startup so the dirty draw pass is O(N) instead of
// re-scanning all nodes for every dirty repaint (O(D·N)).
static inline void ui_build_draw_order() {
  if (__ui_draw_order || __ui_node_count == 0) return;
  __ui_draw_order = (uint16_t*)malloc((size_t)__ui_node_count * sizeof(uint16_t));
  if (!__ui_draw_order) return;
  for (uint16_t i = 0; i < __ui_node_count; i++) __ui_draw_order[i] = i;
  for (uint16_t a = 1; a < __ui_node_count; a++) {
    uint16_t key = __ui_draw_order[a];
    int16_t j = (int16_t)a - 1;
    while (j >= 0 && ui_node_draws_before(key, __ui_draw_order[j])) {
      __ui_draw_order[j + 1] = __ui_draw_order[j];
      j--;
    }
    __ui_draw_order[j + 1] = key;
  }
}

// Index generic (non-list) scroll containers once so scroll prep doesn't scan
// every node each frame.
static inline void ui_build_scroll_owner_table() {
  if (__ui_scroll_owners || __ui_node_count == 0) return;
  uint16_t count = 0;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].scrollable && !__ui_nodes[i].virtualized) count++;
  }
  __ui_scroll_owner_count = count;
  if (!count) return;
  __ui_scroll_owners = (uint16_t*)malloc((size_t)count * sizeof(uint16_t));
  if (!__ui_scroll_owners) {
    __ui_scroll_owner_count = 0;
    return;
  }
  uint16_t w = 0;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].scrollable && !__ui_nodes[i].virtualized) {
      __ui_scroll_owners[w++] = i;
    }
  }
}

static inline void ui_refresh_active_screen_bg_node() {
  __ui_active_screen_bg_node = 0xFFFF;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].screenId == __ui_active_screen && __ui_nodes[i].kind == NODE_FILL) {
      __ui_active_screen_bg_node = i;
      return;
    }
  }
}

static inline uint8_t ui_scroll_subtree_has_dirty(uint16_t scrollNode) {
  if (scrollNode >= __ui_node_count) return 0;
  uint16_t end = __ui_nodes[scrollNode].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t c = scrollNode + 1; c < end; c++) {
    if (__ui_nodes[c].dirty &&
        ui_is_effectively_visible(c) &&
        __ui_nodes[c].screenId == __ui_active_screen) {
      return 1;
    }
  }
  return 0;
}

static inline uint8_t ui_is_ancestor_of(uint16_t candidate, uint16_t nodeIdx) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (p == candidate) return 1;
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline int16_t ui_pressed_offset_x_for_node(uint16_t nodeIdx) {
  return __ui_nodes[nodeIdx].value > 0 ? __ui_nodes[nodeIdx].pressedOffsetX : 0;
}

static inline int16_t ui_pressed_offset_y_for_node(uint16_t nodeIdx) {
  return __ui_nodes[nodeIdx].value > 0 ? __ui_nodes[nodeIdx].pressedOffsetY : 0;
}

static inline int16_t ui_base_draw_x_for_node(uint16_t nodeIdx) {
  return __ui_nodes[nodeIdx].box.x + __ui_nodes[nodeIdx].transformOffsetX;
}

static inline int16_t ui_draw_x_for_node(uint16_t nodeIdx) {
  return ui_base_draw_x_for_node(nodeIdx) + ui_pressed_offset_x_for_node(nodeIdx);
}

static inline int16_t ui_base_draw_y_for_node(uint16_t nodeIdx) {
  int16_t y = __ui_nodes[nodeIdx].box.y + __ui_nodes[nodeIdx].transformOffsetY;
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) y -= __ui_nodes[p].scrollY;
    p = __ui_nodes[p].parent;
  }
  return y;
}

static inline int16_t ui_draw_y_for_node(uint16_t nodeIdx) {
  return ui_base_draw_y_for_node(nodeIdx) + ui_pressed_offset_y_for_node(nodeIdx);
}

// Find the scrollable container (list or generic scroll view) whose box contains
// a point, on the active screen, with content overflowing the viewport. Mirrors
// the touch path's scroll-scan (ui_touch_down) so the wheel handler finds the
// SAME owner a drag would — robust against the cursor resting on a non-child
// node (text, a sibling, padding) where the hit-test + ancestor-walk approach
// misses. Returns the topmost such node by draw order, or -1 if none.
static inline int16_t ui_scroll_node_at(int16_t tx, int16_t ty) {
  int16_t bestScroll = -1;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].scrollable || !ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    if (__ui_nodes[i].contentHeight <= __ui_nodes[i].box.h) continue;
    int16_t drawX = ui_draw_x_for_node((uint16_t)i);
    int16_t drawY = ui_draw_y_for_node((uint16_t)i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      if (bestScroll < 0 || ui_node_draws_before((uint16_t)bestScroll, i)) bestScroll = (int16_t)i;
    }
  }
  return bestScroll;
}

static inline UI_COLOR_T ui_parent_clear_color(uint16_t nodeIdx) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    return __ui_nodes[p].hasBg ? __ui_nodes[p].bg : __ui_nodes[p].clearColor;
  }
  return __ui_nodes[nodeIdx].clearColor;
}

static inline void ui_shadow_extents(uint16_t nodeIdx, int16_t* left, int16_t* top, int16_t* right, int16_t* bottom) {
  *left = 0; *top = 0; *right = 0; *bottom = 0;
  for (uint8_t s = 0; s < __ui_nodes[nodeIdx].shadowCount && s < 4; s++) {
    if (__ui_nodes[nodeIdx].shadowInset[s]) continue;
    int16_t blur = __ui_nodes[nodeIdx].shadowBlur[s];
    if (blur == 0) blur = 1;
    int16_t ox = __ui_nodes[nodeIdx].shadowOffsetX[s];
    int16_t oy = __ui_nodes[nodeIdx].shadowOffsetY[s];
    int16_t l = blur - ox;
    int16_t t = blur - oy;
    int16_t r = blur + ox;
    int16_t b = blur + oy;
    if (l > *left) *left = l;
    if (t > *top) *top = t;
    if (r > *right) *right = r;
    if (b > *bottom) *bottom = b;
  }
}

static inline void ui_expand_rect(int16_t* x0, int16_t* y0, int16_t* x1, int16_t* y1,
                                  int16_t rx0, int16_t ry0, int16_t rx1, int16_t ry1) {
  if (rx0 < *x0) *x0 = rx0;
  if (ry0 < *y0) *y0 = ry0;
  if (rx1 > *x1) *x1 = rx1;
  if (ry1 > *y1) *y1 = ry1;
}

static inline void ui_node_paint_rect(uint16_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH, UIRect* out) {
  int16_t shadowL, shadowT, shadowR, shadowB;
  ui_shadow_extents(nodeIdx, &shadowL, &shadowT, &shadowR, &shadowB);

  int16_t faceW = __ui_nodes[nodeIdx].box.w;
  int16_t faceH = __ui_nodes[nodeIdx].box.h;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT || __ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    if (__ui_nodes[nodeIdx].lastTextWidth > faceW) faceW = __ui_nodes[nodeIdx].lastTextWidth;
    if (__ui_nodes[nodeIdx].lastTextHeight > faceH) faceH = __ui_nodes[nodeIdx].lastTextHeight;
    if ((int16_t)textW > faceW) faceW = (int16_t)textW;
    if ((int16_t)textH > faceH) faceH = (int16_t)textH;
  }
  int16_t unrotatedFaceW = faceW;
  int16_t unrotatedFaceH = faceH;
  faceW = ui_rotated_face_w(nodeIdx, unrotatedFaceW, unrotatedFaceH);
  faceH = ui_rotated_face_h(nodeIdx, unrotatedFaceW, unrotatedFaceH);

  int16_t shadowX0 = baseX - shadowL;
  int16_t shadowY0 = baseY - shadowT;
  int16_t shadowX1 = baseX + faceW + shadowR;
  int16_t shadowY1 = baseY + faceH + shadowB;
  int16_t faceX0 = drawX;
  int16_t faceY0 = drawY;
  int16_t faceX1 = drawX + faceW;
  int16_t faceY1 = drawY + faceH;
  int16_t x0 = shadowX0 < faceX0 ? shadowX0 : faceX0;
  int16_t y0 = shadowY0 < faceY0 ? shadowY0 : faceY0;
  int16_t x1 = shadowX1 > faceX1 ? shadowX1 : faceX1;
  int16_t y1 = shadowY1 > faceY1 ? shadowY1 : faceY1;
  if (__ui_nodes[nodeIdx].outlineStyle != 0 && __ui_nodes[nodeIdx].outlineWidth > 0) {
    int16_t o = __ui_nodes[nodeIdx].outlineWidth;
    ui_expand_rect(&x0, &y0, &x1, &y1, drawX - o, drawY - o, drawX + faceW + o, drawY + faceH + o);
  }
  out->x = x0;
  out->y = y0;
  out->w = x1 - x0;
  out->h = y1 - y0;
}

static inline void ui_node_current_paint_rect(uint16_t nodeIdx, UIRect* out) {
  uint16_t tw = 0;
  uint16_t th = 0;
  uint16_t textMaxW = ui_node_text_max_width(nodeIdx);
  ui_node_text_layout_metrics(nodeIdx, textMaxW, &tw, &th);
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    tw += 22;
    if (th < 16) th = 16;
  }
  ui_node_paint_rect(nodeIdx,
    ui_base_draw_x_for_node(nodeIdx),
    ui_base_draw_y_for_node(nodeIdx),
    ui_draw_x_for_node(nodeIdx),
    ui_draw_y_for_node(nodeIdx),
    tw,
    th,
    out);
}

static inline uint8_t ui_subtree_current_paint_rect(uint16_t nodeIdx, UIRect* out) {
  if (nodeIdx >= __ui_node_count) return 0;
  int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  uint8_t hasRect = 0;
  int16_t x0 = 0;
  int16_t y0 = 0;
  int16_t x1 = 0;
  int16_t y1 = 0;
  for (uint16_t c = nodeIdx; c < end; c++) {
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_is_effectively_visible(c)) continue;
    UIRect r;
    ui_node_current_paint_rect(c, &r);
    if (r.w <= 0 || r.h <= 0) continue;
    if (!hasRect) {
      x0 = r.x;
      y0 = r.y;
      x1 = r.x + r.w;
      y1 = r.y + r.h;
      hasRect = 1;
    } else {
      ui_expand_rect(&x0, &y0, &x1, &y1, r.x, r.y, r.x + r.w, r.y + r.h);
    }
  }
  if (!hasRect) return 0;
  out->x = x0;
  out->y = y0;
  out->w = x1 - x0;
  out->h = y1 - y0;
  return 1;
}

static inline void ui_mark_overlapping_higher_layers_dirty(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  if (!ui_is_effectively_visible(nodeIdx)) return;
  if (__ui_nodes[nodeIdx].screenId != __ui_active_screen) return;
  UIRect r;
  ui_node_current_paint_rect(nodeIdx, &r);
  ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &r);
}

static inline void ui_mark_overlapping_higher_layers_dirty_for_rect(uint16_t nodeIdx, const UIRect* r) {
  if (nodeIdx >= __ui_node_count || !r) return;
  if (!ui_is_effectively_visible(nodeIdx)) return;
  if (__ui_nodes[nodeIdx].screenId != __ui_active_screen) return;
  if (r->w <= 0 || r->h <= 0) return;
  for (uint16_t c = 0; c < __ui_node_count; c++) {
    if (c == nodeIdx) continue;
    if (__ui_nodes[c].dirty) continue;
    if (!ui_is_effectively_visible(c)) continue;
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_node_draws_before(nodeIdx, c)) continue;
    UIRect cr;
    ui_node_current_paint_rect(c, &cr);
    if (cr.w <= 0 || cr.h <= 0) continue;
    if (ui_rects_intersect(r->x, r->y, r->w, r->h, cr.x, cr.y, cr.w, cr.h)) {
      __ui_nodes[c].dirty = 1;
    }
  }
}

static inline void ui_clear_press_offset_area(uint16_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH) {
  if (__ui_nodes[nodeIdx].pressedOffsetX == 0 && __ui_nodes[nodeIdx].pressedOffsetY == 0) return;
  UIRect r;
  ui_node_paint_rect(nodeIdx, baseX, baseY, drawX, drawY, textW, textH, &r);
  int16_t x0 = r.x;
  int16_t y0 = r.y;
  int16_t x1 = r.x + r.w;
  int16_t y1 = r.y + r.h;
  if (ui_display_is_default_target() && ui_repair_current_node_paint_with_parent(nodeIdx, &r)) return;
  ui_display_fill_rect(x0, y0, x1 - x0, y1 - y0, ui_parent_clear_color(nodeIdx));
}

// Generated-font / AA text and images draw per-pixel when sent straight to SPI.
// Prefer the RAM paint canvas for these kinds (within the pixel budget).
static inline uint8_t ui_pixel_heavy_node(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_IMG) return 1;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT &&
      (__ui_nodes[nodeIdx].fontFace || __ui_nodes[nodeIdx].fontAntialias)) return 1;
  return 0;
}

static inline uint8_t ui_should_buffer_paint(uint16_t nodeIdx, int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_LIST) return 0;
  // <canvas> elements batch via __ui_node_canvas when drawing to the display.
  if (__ui_nodes[nodeIdx].kind == NODE_CANVAS) return 0;
  if ((uint32_t)w * (uint32_t)h > UI_MAX_BUFFERED_PAINT_PIXELS) return 0;
  if (ui_pixel_heavy_node(nodeIdx)) return 1;
  if (__ui_nodes[nodeIdx].kind == NODE_FILL &&
      __ui_nodes[nodeIdx].hasBg &&
      __ui_nodes[nodeIdx].gradientEnabled == 0 &&
      __ui_nodes[nodeIdx].borderRadius == 0 &&
      __ui_nodes[nodeIdx].borderStyle == 0 &&
      __ui_nodes[nodeIdx].outlineStyle == 0 &&
      __ui_nodes[nodeIdx].shadowCount == 0) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_FILL &&
      !__ui_nodes[nodeIdx].hasBg &&
      __ui_nodes[nodeIdx].borderStyle == 0 &&
      __ui_nodes[nodeIdx].outlineStyle == 0 &&
      __ui_nodes[nodeIdx].shadowCount == 0) return 0;
  return 1;
}

static inline void ui_seed_paint_canvas_for_node(uint16_t nodeIdx, CuttlefishCanvas16* canvas, int16_t canvasX, int16_t canvasY) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p == UI_NO_PARENT || p >= __ui_node_count) {
    display_canvasFillScreen(canvas, __ui_nodes[nodeIdx].clearColor);
    return;
  }

  uint16_t parentDecorated =
    (__ui_nodes[p].hasBg && (__ui_nodes[p].borderRadius > 0 || __ui_nodes[p].gradientEnabled > 0)) ||
    __ui_nodes[p].borderStyle != 0 ||
    __ui_nodes[p].outlineStyle != 0;
  if (!parentDecorated) {
    display_canvasFillScreen(canvas, ui_parent_clear_color(nodeIdx));
    return;
  }

  display_canvasFillScreen(canvas, ui_parent_clear_color(p));
  int16_t parentDrawX = ui_draw_x_for_node(p);
  int16_t parentDrawY = ui_draw_y_for_node(p);
  int16_t origParentX = __ui_nodes[p].box.x;
  CuttlefishDisplayTarget* previousGfx = ui_display_get_target();
  ui_display_set_target(canvas);
  __ui_nodes[p].box.x = parentDrawX - canvasX;
  int16_t localY = parentDrawY - canvasY;

  // Parent fill color: blended toward the parent's backdrop when the parent is
  // translucent (matching the main NODE_FILL draw, which uses fillBg). Without
  // this, scroll repair seeds the canvas with the parent's RAW bg while the
  // main draw used the blended color → shearing on translucent nodes during scroll.
  UI_COLOR_T parentFillBg = __ui_nodes[p].bg;
  if (__ui_nodes[p].opacity < 100) {
    parentFillBg = ui_blend(__ui_nodes[p].bg, ui_parent_clear_color(p), __ui_nodes[p].opacity);
  }

  if (__ui_nodes[p].gradientEnabled > 0) {
    ui_draw_gradient_fill(p, localY);
  } else if (__ui_nodes[p].borderRadius > 0 && __ui_nodes[p].hasBg) {
    ui_display_fill_round_rect(__ui_nodes[p].box.x, localY, __ui_nodes[p].box.w, __ui_nodes[p].box.h,
      __ui_nodes[p].borderRadius, parentFillBg);
  } else if (__ui_nodes[p].hasBg) {
    ui_display_fill_rect(__ui_nodes[p].box.x, localY, __ui_nodes[p].box.w, __ui_nodes[p].box.h, parentFillBg);
  }
  if (__ui_nodes[p].borderStyle != 0) {
    UI_COLOR_T bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
    ui_draw_node_border(p, __ui_nodes[p].box.x, localY, bColor);
  }
  ui_draw_node_outline(p, __ui_nodes[p].box.x, localY);

  __ui_nodes[p].box.x = origParentX;
  ui_display_set_target(previousGfx);
}

static inline uint8_t ui_repair_current_node_paint_with_parent(uint16_t nodeIdx, UIRect* r) {
  if (!r || r->w <= 0 || r->h <= 0) return 0;
  if ((uint32_t)r->w * (uint32_t)r->h > UI_MAX_BUFFERED_PAINT_PIXELS) return 0;
  CuttlefishCanvas16* repairCanvas = ui_get_repair_canvas(r->w, r->h);
  if (!repairCanvas) return 0;
  ui_seed_paint_canvas_for_node(nodeIdx, repairCanvas, r->x, r->y);
  ui_display_use_default_target();
  ui_push_canvas_rect(repairCanvas, r->x, r->y, r->w, r->h);
  return 1;
}

static inline uint8_t ui_is_rect_clipped_by_scroll(uint16_t nodeIdx, int16_t drawX, int16_t drawY, int16_t drawW, int16_t drawH) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) {
      if (drawX < __ui_nodes[p].box.x ||
          drawX + drawW > __ui_nodes[p].box.x + __ui_nodes[p].box.w ||
          drawY < __ui_nodes[p].box.y ||
          drawY + drawH > __ui_nodes[p].box.y + __ui_nodes[p].box.h) {
        return 1;
      }
    }
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline uint8_t ui_is_clipped_by_scroll(uint16_t nodeIdx, int16_t drawX, int16_t drawY) {
  return ui_is_rect_clipped_by_scroll(nodeIdx, drawX, drawY, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
}

// Point-in-viewport test for hit-testing. A tap point is tappable if it lies
// within EVERY scrollable ancestor's viewport (logical AND, matching the
// preview's intersected scroll clip). This differs from ui_is_clipped_by_scroll,
// which tests the node's whole bounding box — a tall node (e.g. a wrapped
// rich-text paragraph) can overflow below the fold yet have a tappable link in
// its visible portion. Use this in the hit-test path; keep the whole-box check
// for draw culling, where a partially-visible node still needs repainting.
static inline uint8_t ui_is_point_clipped_by_scroll(uint16_t nodeIdx, int16_t px, int16_t py) {
  uint16_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) {
      if (px < __ui_nodes[p].box.x ||
          px >= __ui_nodes[p].box.x + __ui_nodes[p].box.w ||
          py < __ui_nodes[p].box.y ||
          py >= __ui_nodes[p].box.y + __ui_nodes[p].box.h) {
        return 1;
      }
    }
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline uint8_t ui_clip_rect_to_rect(UIRect* r, const UIRect* clip) {
  int16_t x0 = r->x > clip->x ? r->x : clip->x;
  int16_t y0 = r->y > clip->y ? r->y : clip->y;
  int16_t x1 = r->x + r->w < clip->x + clip->w ? r->x + r->w : clip->x + clip->w;
  int16_t y1 = r->y + r->h < clip->y + clip->h ? r->y + r->h : clip->y + clip->h;
  if (x1 <= x0 || y1 <= y0) return 0;
  r->x = x0;
  r->y = y0;
  r->w = x1 - x0;
  r->h = y1 - y0;
  return 1;
}

static inline void ui_fill_rect_clipped(int16_t x, int16_t y, int16_t w, int16_t h, const UIRect* clip, UI_COLOR_T color) {
  UIRect r = { x, y, w, h };
  if (!ui_clip_rect_to_rect(&r, clip)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, color);
}

static inline void ui_hline_clipped(int16_t x, int16_t y, int16_t w, const UIRect* clip, UI_COLOR_T color) {
  if (w <= 0 || y < clip->y || y >= clip->y + clip->h) return;
  int16_t x0 = x > clip->x ? x : clip->x;
  int16_t x1 = x + w < clip->x + clip->w ? x + w : clip->x + clip->w;
  if (x1 <= x0) return;
  ui_display_draw_fast_hline(x0, y, x1 - x0, color);
}

static inline void ui_vline_clipped(int16_t x, int16_t y, int16_t h, const UIRect* clip, UI_COLOR_T color) {
  if (h <= 0 || x < clip->x || x >= clip->x + clip->w) return;
  int16_t y0 = y > clip->y ? y : clip->y;
  int16_t y1 = y + h < clip->y + clip->h ? y + h : clip->y + clip->h;
  if (y1 <= y0) return;
  ui_display_draw_fast_vline(x, y0, y1 - y0, color);
}

static inline void ui_draw_rect_outline_clipped(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t style, uint8_t width, const UIRect* clip, UI_COLOR_T color) {
  if (style == 0 || width == 0 || w <= 0 || h <= 0) return;
  for (uint8_t b = 0; b < width; b++) {
    int16_t rx = x + b;
    int16_t ry = y + b;
    int16_t rw = w - 2 * b;
    int16_t rh = h - 2 * b;
    if (rw <= 0 || rh <= 0) return;
    if (style == 1) {
      ui_hline_clipped(rx, ry, rw, clip, color);
      ui_hline_clipped(rx, ry + rh - 1, rw, clip, color);
      ui_vline_clipped(rx, ry, rh, clip, color);
      ui_vline_clipped(rx + rw - 1, ry, rh, clip, color);
    } else {
      for (int16_t dx = 0; dx < rw; dx += 8) {
        int16_t seg = (dx + 4 <= rw) ? 4 : (rw - dx);
        ui_hline_clipped(rx + dx, ry, seg, clip, color);
        ui_hline_clipped(rx + dx, ry + rh - 1, seg, clip, color);
      }
      for (int16_t dy = 0; dy < rh; dy += 8) {
        int16_t seg = (dy + 4 <= rh) ? 4 : (rh - dy);
        ui_vline_clipped(rx, ry + dy, seg, clip, color);
        ui_vline_clipped(rx + rw - 1, ry + dy, seg, clip, color);
      }
    }
  }
}

static inline void ui_draw_node_decoration_clipped(uint16_t nodeIdx, int16_t drawY, const UIRect* clip) {
  if (nodeIdx >= __ui_node_count) return;
  if (__ui_nodes[nodeIdx].borderStyle != 0) {
    UI_COLOR_T bColor = __ui_nodes[nodeIdx].borderColor ? __ui_nodes[nodeIdx].borderColor : __ui_nodes[nodeIdx].fg;
    int16_t x = __ui_nodes[nodeIdx].box.x;
    int16_t y = drawY;
    int16_t w = __ui_nodes[nodeIdx].box.w;
    int16_t h = __ui_nodes[nodeIdx].box.h;
    if (__ui_nodes[nodeIdx].borderRadius > 0) {
      if (x >= clip->x && y >= clip->y && x + w <= clip->x + clip->w && y + h <= clip->y + clip->h) {
        ui_draw_node_border(nodeIdx, x, drawY, bColor);
      }
    } else {
      ui_draw_rect_outline_clipped(x, y, w, h,
        __ui_nodes[nodeIdx].borderStyle, __ui_nodes[nodeIdx].borderWidth, clip, bColor);
    }
  }
  if (__ui_nodes[nodeIdx].outlineStyle != 0 && __ui_nodes[nodeIdx].outlineWidth > 0) {
    uint8_t w = __ui_nodes[nodeIdx].outlineWidth;
    int16_t x = __ui_nodes[nodeIdx].box.x - w;
    int16_t y = drawY - w;
    int16_t ow = __ui_nodes[nodeIdx].box.w + 2 * w;
    int16_t oh = __ui_nodes[nodeIdx].box.h + 2 * w;
    if (__ui_nodes[nodeIdx].borderRadius > 0) {
      if (x >= clip->x && y >= clip->y && x + ow <= clip->x + clip->w && y + oh <= clip->y + clip->h) {
        ui_draw_node_outline(nodeIdx, __ui_nodes[nodeIdx].box.x, drawY);
      }
    } else {
      ui_draw_rect_outline_clipped(x, y, ow, oh,
        __ui_nodes[nodeIdx].outlineStyle, w, clip, __ui_nodes[nodeIdx].outlineColor);
    }
  }
}

static inline void ui_clear_node_paint_rect(uint16_t nodeIdx, const UIRect* paintRect) {
  if (nodeIdx >= __ui_node_count || !paintRect || paintRect->w <= 0 || paintRect->h <= 0) return;
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  UIRect r = *paintRect;
  ui_display_use_default_target();
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[scrollParent].box.x,
      __ui_nodes[scrollParent].box.y,
      __ui_nodes[scrollParent].box.w,
      __ui_nodes[scrollParent].box.h
    };
    UIRect clipped = r;
    if (!ui_clip_rect_to_rect(&clipped, &clip)) return;
    if (ui_repair_current_node_paint_with_parent(nodeIdx, &clipped)) return;
    ui_fill_rect_clipped(clipped.x, clipped.y, clipped.w, clipped.h, &clip, ui_parent_clear_color(nodeIdx));
    uint16_t p = __ui_nodes[nodeIdx].parent;
    if (p != UI_NO_PARENT && p < __ui_node_count) {
      ui_draw_node_decoration_clipped(p, ui_draw_y_for_node(p), &clip);
    }
    return;
  }
  if (ui_is_rect_clipped_by_scroll(nodeIdx, r.x, r.y, r.w, r.h)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, ui_parent_clear_color(nodeIdx));
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    int16_t parentDrawY = ui_draw_y_for_node(p);
    if (__ui_nodes[p].borderStyle != 0) {
      UI_COLOR_T bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
      ui_draw_node_border(p, ui_draw_x_for_node(p), parentDrawY, bColor);
    }
    ui_draw_node_outline(p, ui_draw_x_for_node(p), parentDrawY);
  }
}

static inline void ui_clear_current_node_paint(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  uint16_t tw = 0;
  uint16_t th = 0;
  uint16_t textMaxW = ui_node_text_max_width(nodeIdx);
  ui_node_text_layout_metrics(nodeIdx, textMaxW, &tw, &th);
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) tw += 22;
  int16_t baseDrawX = ui_base_draw_x_for_node(nodeIdx);
  int16_t baseDrawY = ui_base_draw_y_for_node(nodeIdx);
  int16_t drawX = ui_draw_x_for_node(nodeIdx);
  int16_t drawY = ui_draw_y_for_node(nodeIdx);
  UIRect r;
  ui_node_paint_rect(nodeIdx, baseDrawX, baseDrawY, drawX, drawY, tw, th, &r);
  ui_clear_node_paint_rect(nodeIdx, &r);
}

static inline uint8_t ui_try_repair_geometry_fill(uint16_t nodeIdx, const UIRect* oldRect) {
  if (nodeIdx >= __ui_node_count || !oldRect || oldRect->w <= 0 || oldRect->h <= 0) return 0;
  if (__ui_nodes[nodeIdx].kind != NODE_FILL) return 0;
  if (!__ui_nodes[nodeIdx].hasBg) return 0;
  if (__ui_nodes[nodeIdx].gradientEnabled != 0) return 0;
  if (__ui_nodes[nodeIdx].borderRadius != 0 ||
      __ui_nodes[nodeIdx].borderStyle != 0 ||
      __ui_nodes[nodeIdx].outlineStyle != 0 ||
      __ui_nodes[nodeIdx].shadowCount != 0) return 0;

  UIRect newRect;
  ui_node_current_paint_rect(nodeIdx, &newRect);
  if (newRect.w <= 0 || newRect.h <= 0) return 0;
  int16_t x0 = oldRect->x < newRect.x ? oldRect->x : newRect.x;
  int16_t y0 = oldRect->y < newRect.y ? oldRect->y : newRect.y;
  int16_t x1 = oldRect->x + oldRect->w > newRect.x + newRect.w ? oldRect->x + oldRect->w : newRect.x + newRect.w;
  int16_t y1 = oldRect->y + oldRect->h > newRect.y + newRect.h ? oldRect->y + oldRect->h : newRect.y + newRect.h;
  UIRect repair = { x0, y0, (int16_t)(x1 - x0), (int16_t)(y1 - y0) };
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[scrollParent].box.x,
      __ui_nodes[scrollParent].box.y,
      __ui_nodes[scrollParent].box.w,
      __ui_nodes[scrollParent].box.h
    };
    if (!ui_clip_rect_to_rect(&repair, &clip)) {
      ui_invalidate_scroll_canvas_for_node(nodeIdx);
      return 1;
    }
  } else if (ui_is_rect_clipped_by_scroll(nodeIdx, repair.x, repair.y, repair.w, repair.h)) {
    return 0;
  }
  if (repair.w <= 0 || repair.h <= 0) return 0;
  if ((uint32_t)repair.w * (uint32_t)repair.h > UI_MAX_BUFFERED_PAINT_PIXELS) return 0;
  CuttlefishCanvas16* repairCanvas = ui_get_repair_canvas(repair.w, repair.h);
  if (!repairCanvas) return 0;

  ui_seed_paint_canvas_for_node(nodeIdx, repairCanvas, repair.x, repair.y);
  CuttlefishDisplayTarget* previousGfx = ui_display_get_target();
  ui_display_set_target(repairCanvas);
  UI_COLOR_T fillBg = __ui_nodes[nodeIdx].bg;
  if (__ui_nodes[nodeIdx].opacity < 100) {
    fillBg = ui_blend(__ui_nodes[nodeIdx].bg, ui_parent_clear_color(nodeIdx), __ui_nodes[nodeIdx].opacity);
  }
  int16_t drawX = ui_draw_x_for_node(nodeIdx) - repair.x;
  int16_t drawY = ui_draw_y_for_node(nodeIdx) - repair.y;
  int16_t fillW = ui_rotated_face_w(nodeIdx, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
  int16_t fillH = ui_rotated_face_h(nodeIdx, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
  ui_display_fill_rect(drawX, drawY, fillW, fillH, fillBg);
  ui_display_set_target(previousGfx);
  ui_display_use_default_target();
  ui_push_canvas_rect(repairCanvas, repair.x, repair.y, repair.w, repair.h);
  if (scrollParent >= 0) ui_invalidate_scroll_canvas_for_node(nodeIdx);
  ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &repair);
  return 1;
}

static inline void ui_clear_subtree_current_paint(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  UIRect r;
  if (!ui_subtree_current_paint_rect(nodeIdx, &r)) return;
  ui_display_use_default_target();
  int16_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[scrollParent].box.x,
      __ui_nodes[scrollParent].box.y,
      __ui_nodes[scrollParent].box.w,
      __ui_nodes[scrollParent].box.h
    };
    UIRect clipped = r;
    if (!ui_clip_rect_to_rect(&clipped, &clip)) return;
    if (ui_repair_current_node_paint_with_parent(nodeIdx, &clipped)) return;
    ui_fill_rect_clipped(clipped.x, clipped.y, clipped.w, clipped.h, &clip, ui_parent_clear_color(nodeIdx));
    uint16_t p = __ui_nodes[nodeIdx].parent;
    if (p != UI_NO_PARENT && p < __ui_node_count) {
      ui_draw_node_decoration_clipped(p, ui_draw_y_for_node(p), &clip);
    }
    return;
  }
  if (ui_repair_current_node_paint_with_parent(nodeIdx, &r)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, ui_parent_clear_color(nodeIdx));
  uint16_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    int16_t parentDrawY = ui_draw_y_for_node(p);
    if (__ui_nodes[p].borderStyle != 0) {
      UI_COLOR_T bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
      ui_draw_node_border(p, ui_draw_x_for_node(p), parentDrawY, bColor);
    }
    ui_draw_node_outline(p, ui_draw_x_for_node(p), parentDrawY);
  }
}

static inline void ui_set_visible(uint16_t nodeIdx, uint8_t visible) {
  if (nodeIdx >= __ui_node_count) return;
  visible = visible ? 1 : 0;
  if (__ui_nodes[nodeIdx].visible == visible) return;

  if (!visible) {
    // Clear the whole subtree in one clipped repair. This removes child pixels
    // even when the container itself is transparent, without separate display
    // writes for each descendant.
    UIRect subtreeRect;
    uint8_t hasSubtreeRect = ui_subtree_current_paint_rect(nodeIdx, &subtreeRect);
    ui_clear_subtree_current_paint(nodeIdx);
    int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
    if (end > __ui_node_count) end = __ui_node_count;
    for (int16_t c = end - 1; c >= (int16_t)nodeIdx; c--) {
      if (__ui_nodes[c].screenId != __ui_active_screen) continue;
      __ui_nodes[c].dirty = 0;
    }
    if (hasSubtreeRect) ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &subtreeRect);
    __ui_nodes[nodeIdx].visible = 0;
    return;
  }

  __ui_nodes[nodeIdx].visible = 1;
  int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  for (uint16_t c = nodeIdx; c < end; c++) {
    if (__ui_nodes[c].screenId == __ui_active_screen && ui_is_effectively_visible(c)) {
      __ui_nodes[c].dirty = 1;
      ui_mark_overlapping_higher_layers_dirty(c);
    }
  }
}

// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Called once in setup() before the loop begins.
// Also seed each text-bound node's buffer from its flash literal so the first
// strcmp in ui_tick has a valid baseline (no spurious redraw on frame 1).
static inline void ui_init(void) {
  // Allocate the per-node scroll-canvas-OK flag array (once; __ui_node_count
  // is a compile-time constant known by this point). calloc zeroes it — all
  // containers start locked until the scroll-container loop proves their
  // canvas fits.
  if (!__ui_scroll_canvas_ok && __ui_node_count > 0) {
    __ui_scroll_canvas_ok = (uint8_t*)calloc(__ui_node_count, sizeof(uint8_t));
  }
  if (!__ui_scroll_mem_warned && __ui_node_count > 0) {
    __ui_scroll_mem_warned = (uint8_t*)calloc(__ui_node_count, sizeof(uint8_t));
  }
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
    __ui_nodes[i].layoutCacheKey = 0;
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) {
      __ui_nodes[i].lastTextWidth = -1;
    }
  }
  for (uint16_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      uint16_t n = __ui_bindings[i].node;
      __ui_nodes[n].hasTextBinding = 1;
      strncpy(__ui_nodes[n].textBuffer, __ui_nodes[n].text ? __ui_nodes[n].text : "", UI_TEXT_BUF);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF] = '\0';
    }
  }
  // Seed virtualized-list runtime state. The fn pointers can't be baked into
  // the static node initializer: ui.bindList is resolved AFTER ui.mount lowers
  // the HTML, so the lowering can't see the binding yet. Instead the lowering
  // emits the UIListBinding table (the binding's fn bodies) and ui_init copies
  // the pointers onto each <list> node here, then computes the initial count
  // and contentHeight so the first paint and the scroll clamp bound are correct.
  for (uint16_t b = 0; b < __ui_list_binding_count; b++) {
    uint16_t n = __ui_list_bindings[b].node;
    if (n >= __ui_node_count || !__ui_nodes[n].virtualized) continue;
    __ui_nodes[n].listCountFn = __ui_list_bindings[b].countFn;
    __ui_nodes[n].listItemFn = __ui_list_bindings[b].itemFn;
    __ui_nodes[n].listTapFn = __ui_list_bindings[b].tapFn;
  }
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].virtualized || !__ui_nodes[i].listCountFn) continue;
    uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
    uint16_t cnt = __ui_nodes[i].listCountFn();
    __ui_nodes[i].listCount = cnt;
    __ui_nodes[i].contentHeight = (int16_t)((uint32_t)cnt * ih);
    __ui_nodes[i].scrollY = 0;
    __ui_nodes[i].overscrollPx = 0;
    __ui_nodes[i].settling = 0;
    __ui_nodes[i].lastPaintedScrollY = -(__ui_nodes[i].box.h > 0 ? __ui_nodes[i].box.h : 1);
  }
  ui_build_draw_order();
  ui_build_scroll_owner_table();
  ui_refresh_active_screen_bg_node();
}

// Debounce: ignore press/release events within 50ms of the last edge.
// Mechanical switches bounce (multiple edges in ~5-20ms); without this, the
// transition gets armed/interrupted dozens of times per physical press.
static volatile uint32_t __ui_last_edge_time = 0;
#define UI_DEBOUNCE_MS 50

static inline void ui_set_pressed(uint16_t nodeIdx, uint8_t pressed) {
  __ui_nodes[nodeIdx].value = pressed ? 1 : 0;
  ui_mark_dirty(nodeIdx);
  for (uint16_t i = 0; i < __ui_trans_count; i++) {
    if (__ui_trans[i].node == nodeIdx) {
      __ui_trans[i].prevValue = __ui_trans[i].prop == PROP_FG ? __ui_nodes[nodeIdx].fg : __ui_nodes[nodeIdx].bg;
      __ui_trans[i].targetValue = pressed ? __ui_trans[i].pressedTarget : __ui_trans[i].baseTarget;
      __ui_trans[i].elapsed = 0;
      __ui_trans[i].active = 1;
    }
  }
}

// Press / release entry points that node.onPress(pin) lowers to.
// On press, arm transitions toward the :pressed target color; on release,
// arm them back toward the base color (interrupt-and-re-lerp from current).
static inline void ui_on_press(uint16_t nodeIdx) {
  uint32_t now = millis();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  ui_set_pressed(nodeIdx, 1);
}
static inline void ui_on_release(uint16_t nodeIdx) {
  uint32_t now = millis();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  ui_set_pressed(nodeIdx, 0);
}

// Pin-watch callback type: void fn(void)
typedef void (*PinWatchCallback)(void);

struct UIPinWatch {
  uint8_t pin;
  uint8_t lastState;   // for edge detection
  PinWatchCallback cb; // fires on falling edge
};

// Populated by the emit layer from ui.watchPin() calls.
extern UIPinWatch __ui_pin_watches[];
extern const uint16_t __ui_pin_watch_count;

// Poll all configured pin-watchers. Called at the start of ui_tick each frame.
// Detects falling edges with natural debounce from the ~16ms frame rate.
static inline void ui_poll_inputs() {
  for (uint16_t i = 0; i < __ui_pin_watch_count; i++) {
    uint8_t val = digitalRead(__ui_pin_watches[i].pin);
    if (val == LOW && __ui_pin_watches[i].lastState == HIGH) {
      if (__ui_pin_watches[i].cb) __ui_pin_watches[i].cb();
    }
    __ui_pin_watches[i].lastState = val;
  }
}

// ── Touch hit-testing + click dispatch ─────────────────────────────────────
// Radio groups for mutual exclusion
struct UIRadioGroup {
  uint16_t nodeIndices[8];
  uint8_t count;
};
extern UIRadioGroup __ui_radio_groups[];
extern const uint16_t __ui_radio_group_count;

// Forward-declare the click handler type + tables (defined by the emit layer).
extern void (*__ui_click_handlers[])();
extern void (*__ui_hold_handlers[])();
extern void (*__ui_release_handlers[])();
extern void (*__ui_rangechange_handlers[])();
extern const uint16_t __ui_click_handler_count;
extern const uint16_t __ui_rangechange_handler_count;

// Touch state machine: tracks down → hold → up → click lifecycle
// Touch node/scroll node state is defined near navigation because ui_navigate resets it.
static uint32_t __ui_touch_down_time = 0;  // millis() when touch started
static int16_t __ui_touch_down_y_pos = 0; // Y position when touch started (for tap vs drag detection)
static uint32_t __ui_last_touch_time = 0;  // for debounce (updated on touch down only)
static uint32_t __ui_last_release_time = 0;  // for release debounce
static int16_t __ui_drag_start_x = 0;
static int16_t __ui_drag_start_y = 0;
static uint8_t __ui_is_dragging = 0;     // 1 once movement exceeds threshold
static int16_t __ui_range_node = -1;     // range slider being dragged (int16: node index can exceed 127)

// ── Awaitable tap source (for `await ui.onTap()`) ─────────────────────────
// __ui_tap_seq increments on every completed tap (after click/release dispatch);
// async awaiters poll it for change. __ui_tap_node records the node hit by the
// last tap (-1 = empty space / non-interactive area) for per-element awaiters.
// volatile: written in the touch path, read from task .step() polls.
static volatile uint32_t __ui_tap_seq = 0;
static volatile int16_t  __ui_tap_node = -1;   // int16: node index can exceed 127
// Keyboard overlay state.
#define UI_KB_MAX 48   // max key cells (4 rows × 11 padded cols + margin)
#define UI_KB_HOLD_MS 600
#define UI_KB_REPEAT_MS 100
#define UI_KB_TEXT_H 24  // height reserved for the preview text row at the top
struct UIKey { char ch; uint8_t special; };  // special: 0=char,1=shift,2=bs,3=ok,4=page
struct UIKeyStyle { uint32_t bg, fg, borderColor; };
static UIRect  __ui_kb_box;
static UIKey   __ui_kb_keys[UI_KB_MAX];
static UIKeyStyle __ui_kb_styles[UI_KB_MAX];
static UI_COLOR_T __ui_kb_bg = 0x0000;  // keyboard background (resolved from CSS)
static uint8_t __ui_kb_bs_held = 0;
static uint8_t __ui_kb_dirty = 0;     // 0=clean, 1=full redraw, 2=text row + single key
// Forward-declared here (defined in the keyboard subsystem block below) so the
// UI_HIDE_OSK caret/blink paths in ui_tick and the input draw can reference it.
static int16_t  __ui_kb_target;
#if defined(UI_HIDE_OSK)
// Caret blink phase for the desktop target (no OSK grid → no focus indicator).
// Incremented each tick; the input draw path blinks a caret on the active edit
// target every ~530ms (32 ticks ≈ 512ms at 60fps, even-power-of-2 mask).
static uint16_t __ui_kb_blink = 0;
#endif
static int8_t __ui_kb_pressed_key = -1; // key index under the current touch (-1=none)
static int8_t __ui_kb_repaint_key = -1; // key to repaint on a targeted (mode 2) redraw
static int16_t __ui_last_touch_x = 0;
static int16_t __ui_last_touch_y = 0;
// Keyboard function forward declarations (defined in the subsystem block below;
// needed because ui_touch_down/up/handle_touch reference them, AND to suppress
// Arduino's auto-prototyper which would inject prototypes before UIRect is defined).
static inline void ui_kb_insert(char c);
static inline void ui_kb_delete();
static inline void ui_kb_open(uint16_t nodeIdx, uint8_t inputPosition);
static inline void ui_kb_close();
static inline void ui_kb_tick(uint32_t now);
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty);
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty);
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out);
static inline void ui_kb_draw();
static inline void ui_kb_draw_key(uint8_t i);
static inline void ui_kb_draw_text_row();
static inline void ui_kb_compute_box();
#define UI_TOUCH_DEBOUNCE_MS 50
#define UI_TOUCH_HOLD_MS 600
#define UI_DRAG_THRESHOLD 10

// Hit-test a touch point against all visible nodes (topmost first).
// Returns the node index of the topmost node that BOTH contains the point
// AND has a click handler registered. Returns -1 if none.
static int16_t ui_hit_test(int16_t tx, int16_t ty) {
  int16_t best = -1;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (!ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    int16_t drawX = ui_draw_x_for_node((uint16_t)i);
    int16_t drawY = ui_draw_y_for_node((uint16_t)i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      // The node's box contains the tap. For nodes inside a scroll container,
      // the tap point (not the whole box) must lie within the visible viewport:
      // a tall wrapped paragraph can overflow below the fold yet still have a
      // tappable link segment in its visible portion.
      if (ui_is_point_clipped_by_scroll((uint16_t)i, tx, ty)) continue;
      // Skip nodes without any click handler — they're containers, not targets.
      // Exceptions: NODE_RANGE (horizontal drag), NODE_INPUT (opens keyboard),
      // NODE_LIST (virtualized item tap), and NODE_BUTTON — the last so a button
      // gets :pressed/transition visual feedback even with no JS onClick wired
      // (a pure-CSS button like a demo "tap to transition" control).
      if (__ui_nodes[i].kind == NODE_RANGE || __ui_nodes[i].kind == NODE_INPUT || __ui_nodes[i].kind == NODE_LIST || __ui_nodes[i].kind == NODE_BUTTON || __ui_nodes[i].kind == NODE_CHECK || __ui_nodes[i].kind == NODE_RADIO) {
        if (best < 0 || ui_node_draws_before(best, i)) best = i;
        continue;
      }
      if (i < __ui_click_handler_count &&
          (__ui_click_handlers[i] || __ui_hold_handlers[i] || __ui_release_handlers[i])) {
        if (best < 0 || ui_node_draws_before(best, i)) best = i;
      }
    }
  }
  return best;
}

// Dispatch a handler from the given table if registered for the node.
static void ui_dispatch(void (**table)(), uint16_t count, int16_t node) {
  if (node >= 0 && (uint16_t)node < count && table[node]) {
    table[node]();
  }
}

static inline void ui_open_keyboard_for_input(uint16_t nodeIdx) {
  if (__ui_nodes[nodeIdx].kind != NODE_INPUT) return;
#if defined(UI_HIDE_OSK)
  // Desktop target: the OSK grid isn't shown, so inputs remain visible and
  // tappable while another is being edited. Commit any open session before
  // opening for the new target, so focus follows the tap instead of being
  // locked to the first input. (ui_kb_open is a no-op if already closed.)
  if (__ui_kb_visible) ui_kb_close();
#endif
  if (__ui_kb_visible) return;
  // Resolve the input's position in the loader dispatch table by scanning
  // for the Nth NODE_INPUT. (The loader table is indexed by input order.)
  // Counter is uint16_t: nodeIdx is uint16_t and inputs can live past node
  // 255 (demo-ui's are at 263/265/309). A uint8_t counter wraps 255→0 and
  // never reaches nodeIdx, deadlocking the device on input tap.
  uint8_t inputPos = 0;
  for (uint16_t j = 0; j < nodeIdx; j++) {
    if (__ui_nodes[j].kind == NODE_INPUT) inputPos++;
  }
  ui_kb_open(nodeIdx, inputPos);
}

// Touch down: called when screen is first touched.
static void ui_touch_down(int16_t tx, int16_t ty) {
  int16_t node = ui_hit_test(tx, ty);
  __ui_touch_node = node;
  __ui_touch_state = 1;
  __ui_touch_down_time = millis();
  __ui_touch_down_y_pos = ty;
  __ui_drag_start_x = tx;
  __ui_drag_start_y = ty;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  __ui_range_node = -1;
  // Unified scroll-scan: one pass over scrollable nodes (containers AND lists —
  // lists are scrollable via the UA stylesheet) finds the owning container.
  // One owner per gesture; the double-delta bug class (node in both a container
  // and a list) is gone because there's no second mechanism.
#if UI_SCROLL_HAS_TOUCH
  int16_t bestScroll = -1;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].scrollable || !ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    // Only scrollable if content overflows the viewport.
    if (__ui_nodes[i].contentHeight <= __ui_nodes[i].box.h) continue;
    int16_t drawX = ui_draw_x_for_node((uint16_t)i);
    int16_t drawY = ui_draw_y_for_node((uint16_t)i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      if (bestScroll < 0 || ui_node_draws_before(bestScroll, i)) bestScroll = i;
    }
  }
  __ui_scroll_node = bestScroll;
#else
  (void)tx; (void)ty;
#endif
  if (node >= 0) {
    uint8_t handledTouchTarget = 0;
    if (__ui_nodes[node].kind == NODE_BUTTON) {
      ui_set_pressed((uint16_t)node, 1);
      handledTouchTarget = 1;
    }
    // Track range nodes for horizontal drag
    if (__ui_nodes[node].kind == NODE_RANGE) {
      __ui_range_node = node;
      // Range owns this gesture. Do not let vertical touch jitter also scroll
      // the containing view, which would dirty and repaint the whole viewport.
      __ui_scroll_node = -1;
      // Immediately set value from touch position
      int16_t rMin = __ui_nodes[node].rangeMin;
      int16_t rMax = __ui_nodes[node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - ui_draw_x_for_node((uint16_t)node) - 4;
      int16_t usable = __ui_nodes[node].box.w - 8;
      if (usable <= 0) usable = 1;
      int16_t nextVal = rMin + ((int32_t)relX * range) / usable;
      nextVal = constrain(nextVal, rMin, rMax);
      if (nextVal != __ui_nodes[node].value) {
        __ui_nodes[node].value = nextVal;
        ui_mark_dirty(node);
      }
      handledTouchTarget = 1;
    }
    uint8_t touchStartsScrollableView =
      (__ui_scroll_node >= 0 && node == __ui_scroll_node);
    if (!handledTouchTarget && !touchStartsScrollableView) ui_mark_dirty(node);
  }
}

// Touch up: called when touch is released. Determines click vs hold.
static void ui_touch_up() {
  // Modal keyboard: route tap-up to the keyboard; swallow normal click logic.
  // (Skipped on UI_HIDE_OSK desktop targets — touches pass through to the app,
  // since the editing session is driven by the real keyboard, not the grid.)
#if !defined(UI_HIDE_OSK)
  if (__ui_kb_visible) {
    ui_kb_handle_tap(__ui_last_touch_x, __ui_last_touch_y);
    __ui_kb_bs_held = 0;
    __ui_touch_state = 0;
    __ui_last_touch_time = millis();
    return;
  }
#endif
  uint32_t elapsed = millis() - __ui_touch_down_time;
  // Release the scroll owner: arm a bounded settle (bounce-back / edge-snap).
  // No fling — motion ends with the finger (the settle animation is the only
  // post-lift motion, terminating within UI_SCROLL_SETTLE_MS).
  if (__ui_scroll_node >= 0) {
    ui_scroll_release(__ui_scroll_node);
  }
  if (__ui_touch_node >= 0 && !__ui_is_dragging) {
    int16_t clickedNode = __ui_touch_node;
    if (elapsed < UI_TOUCH_HOLD_MS) {
      if (__ui_nodes[clickedNode].kind == NODE_INPUT) {
        ui_open_keyboard_for_input((uint16_t)clickedNode);
      }
      ui_dispatch(__ui_click_handlers, __ui_click_handler_count, __ui_touch_node);
      // Rich-text inline link: if the tapped node has link runs, find which link
      // segment the tap falls within and navigate to its target screen. Copies
      // the list-item subdivision precedent with measured run rects.
      if (__ui_nodes[clickedNode].runCount > 0) {
        int16_t ndx = __ui_last_touch_x - ui_draw_x_for_node((uint16_t)clickedNode);
        int16_t ndy = __ui_last_touch_y - ui_draw_y_for_node((uint16_t)clickedNode);
        int8_t target = ui_rich_link_hit((uint16_t)clickedNode, ndx, ndy);
        if (target >= 0) ui_navigate((uint8_t)target);
      }
    }
    ui_dispatch(__ui_release_handlers, __ui_click_handler_count, __ui_touch_node);
    ui_mark_dirty(clickedNode);
  }
  // Release the pressed button's :pressed state unconditionally — even when a
  // drag/scroll hijacked the gesture (the click above is correctly gated on
  // !__ui_is_dragging, but the visual press state should always reset on lift,
  // otherwise a touch-down on a button followed by a scroll leaves it stuck).
  if (__ui_touch_node >= 0 && __ui_touch_node < __ui_node_count &&
      __ui_nodes[__ui_touch_node].kind == NODE_BUTTON && __ui_nodes[__ui_touch_node].value != 0) {
    ui_set_pressed((uint16_t)__ui_touch_node, 0);
  }
  // Resume any `await ui.onTap()` awaiter. Runs for EVERY completed tap —
  // including holds (released above) and taps on empty space (__ui_touch_node
  // == -1), which is what makes "wake on any touch" work for display-sleep.
  // Placed AFTER the click/release dispatch so onClick always fires first.
  __ui_tap_seq++;
  __ui_tap_node = __ui_touch_node;
  // Virtualized list item tap: if the touch was inside a list, compute the item
  // index from the touch Y. Use total movement (not drag flag) to distinguish
  // tap from scroll: a tap moves < itemHeight/2 total; a scroll moves more.
  if (__ui_scroll_node >= 0 && __ui_nodes[__ui_scroll_node].virtualized) {
    int16_t n = __ui_scroll_node;
    if (__ui_nodes[n].listTapFn) {
      int16_t drawY = ui_draw_y_for_node(n);
      int16_t relY = __ui_last_touch_y - drawY;
      int16_t totalMove = abs(__ui_last_touch_y - __ui_touch_down_y_pos);
      uint16_t ih = __ui_nodes[n].listItemHeight > 0 ? __ui_nodes[n].listItemHeight : 24;
      if (totalMove < (int16_t)(ih / 2) &&
          relY >= 0 && relY < __ui_nodes[n].box.h) {
        uint16_t itemIdx = (uint16_t)((relY + __ui_nodes[n].scrollY) / ih);
        if (itemIdx < __ui_nodes[n].listCount) {
          __ui_nodes[n].listTapFn(itemIdx);
        }
      }
    }
  }
  __ui_touch_state = 0;
  __ui_touch_node = -1;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  __ui_range_node = -1;
}

// Called each frame from ui_poll_touch when touch is detected.
// Implements debounce + the down/hold/up/click state machine.
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  uint32_t now = millis();
  // Track last touch coords for tap-up routing.
  __ui_last_touch_x = tx;
  __ui_last_touch_y = ty;

  // Modal keyboard: if visible, route touch to the keyboard only.
  // (Skipped on UI_HIDE_OSK desktop targets — touches pass through to the app,
  // since the editing session is driven by the real keyboard, not the grid.)
#if !defined(UI_HIDE_OSK)
  if (__ui_kb_visible) {
    // Only process the down-edge for key actions (insert/delete-on-down).
    // Repeat is handled by ui_kb_tick; release by ui_touch_up → ui_kb_handle_tap.
    if (__ui_touch_state == 0) {
      __ui_touch_state = 1;
      __ui_touch_down_time = now;
      if (tx >= __ui_kb_box.x && tx < __ui_kb_box.x + __ui_kb_box.w &&
          ty >= __ui_kb_box.y && ty < __ui_kb_box.y + __ui_kb_box.h) {
        ui_kb_handle_touch(tx, ty);
      }
    } else {
      // Held: run auto-repeat (backspace).
      ui_kb_tick(now);
    }
    __ui_last_touch_time = now;
    return;  // swallow all other touches while modal
  }
#endif

  if (__ui_touch_state == 0) {
    // Idle: check debounce, then start touch
    if (now - __ui_last_touch_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_down(tx, ty);
  } else {
    // Already touching: check for drag or hold
    if (__ui_range_node < 0 && !__ui_is_dragging && __ui_scroll_node >= 0) {
      // Check if movement exceeds drag threshold
      int16_t dy = ty - __ui_drag_start_y;
      if (abs(dy) >= UI_DRAG_THRESHOLD) {
        __ui_is_dragging = 1;
      }
    }
    // Range slider: update value from horizontal touch position
    if (__ui_range_node >= 0) {
      int16_t rMin = __ui_nodes[__ui_range_node].rangeMin;
      int16_t rMax = __ui_nodes[__ui_range_node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - ui_draw_x_for_node((uint16_t)__ui_range_node) - 4;
      int16_t usable = __ui_nodes[__ui_range_node].box.w - 8;
      if (usable <= 0) usable = 1;
      int16_t newVal = rMin + ((int32_t)relX * range) / usable;
      newVal = constrain(newVal, rMin, rMax);
      if (newVal != __ui_nodes[__ui_range_node].value) {
        __ui_nodes[__ui_range_node].value = newVal;
        ui_mark_dirty(__ui_range_node);
        // Fire the onChange callback (if any) — every value change during drag.
        if (__ui_range_node < (int16_t)__ui_rangechange_handler_count &&
            __ui_rangechange_handlers[__ui_range_node]) {
          __ui_rangechange_handlers[__ui_range_node]();
        }
      }
    }
    // Unified scroll drag: one owning node, immediate-apply each frame (the
    // list's proven model, now used for all scroll containers). No accumulator,
    // no cadence gate, no pending buffer — the smoothed delta is applied via the
    // physics layer (1:1 in-bounds, rubber-band at edges). Telemetry optional.
    if (__ui_range_node < 0 && __ui_is_dragging && __ui_scroll_node >= 0) {
      int16_t rawDy = ty - __ui_drag_start_y;
      if (rawDy != 0) {
        int16_t dy = ui_scroll_smooth_dy(rawDy);
        if (dy != 0) {
          ui_apply_scroll_delta(__ui_scroll_node, dy);
          __ui_drag_start_y = ty;
#if UI_SCROLL_DEBUG
          Serial.printf("scroll dy=%d sy=%d ov=%d virt=%d\n",
            dy, __ui_nodes[__ui_scroll_node].scrollY,
            __ui_nodes[__ui_scroll_node].overscrollPx,
            (int)__ui_nodes[__ui_scroll_node].virtualized);
#endif
        }
      }
    }
    if (__ui_touch_state == 1 && __ui_touch_node >= 0 && !__ui_is_dragging) {
      if (now - __ui_touch_down_time >= UI_TOUCH_HOLD_MS) {
        __ui_touch_state = 2;
        ui_dispatch(__ui_hold_handlers, __ui_click_handler_count, __ui_touch_node);
      }
    }
  }
  __ui_last_touch_time = now;
}

// Called each frame when no touch is detected.
static inline void ui_handle_no_touch() {
  if (__ui_touch_state != 0) {
    // Debounce: require a gap since the last release before processing another.
    // This prevents crash from rapid touch/no-touch flicker on resistive screens.
    if (millis() - __ui_last_release_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_up();
    __ui_last_release_time = millis();
  }
}

// Blend two RGB565 colors by opacity (0-100). Returns fg faded toward bg.
static inline uint16_t ui_blend565(uint16_t fg, uint16_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  // Blend in 888 internally for higher precision: unpack 565→888 (replicating
  // high bits), blend at 8-bit, then re-quantize to 565. This produces smoother
  // intermediate values for AA text edges, opacity, shadows, and gradients —
  // the 565-channel blend (32 red levels) was too coarse and showed banding.
  uint8_t fr = (fg >> 11) & 0x1F, fg5 = (fg >> 5) & 0x3F, fb = fg & 0x1F;
  uint8_t br = (bg >> 11) & 0x1F, bg5 = (bg >> 5) & 0x3F, bb = bg & 0x1F;
  // Unpack to 8-bit (5-bit → 8-bit: (v << 3) | (v >> 2)).
  uint16_t fr8 = (fr << 3) | (fr >> 2), fg8 = (fg5 << 2) | (fg5 >> 4), fb8 = (fb << 3) | (fb >> 2);
  uint16_t br8 = (br << 3) | (br >> 2), bg8 = (bg5 << 2) | (bg5 >> 4), bb8 = (bb << 3) | (bb >> 2);
  uint16_t r = (uint16_t)((fr8 * opacity + br8 * (100 - opacity)) / 100);
  uint16_t g = (uint16_t)((fg8 * opacity + bg8 * (100 - opacity)) / 100);
  uint16_t b = (uint16_t)((fb8 * opacity + bb8 * (100 - opacity)) / 100);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

// Blend two RGB888 colors by opacity (0-100). Added for Phase 2 (RGB888/RGB666
// targets); unused in Phase 1, whose TFT path keeps 565 node values and blends
// via ui_blend565 above. Kept alongside so the 888 path is ready when the
// descriptor routes emit through resolveColor888.
static inline uint32_t ui_blend888(uint32_t fg, uint32_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  uint8_t fr = (fg >> 16) & 0xff, fg8 = (fg >> 8) & 0xff, fb = fg & 0xff;
  uint8_t br = (bg >> 16) & 0xff, bg8 = (bg >> 8) & 0xff, bb = bg & 0xff;
  uint8_t r = (fr * opacity + br * (100 - opacity)) / 100;
  uint8_t g = (fg8 * opacity + bg8 * (100 - opacity)) / 100;
  uint8_t b = (fb * opacity + bb * (100 - opacity)) / 100;
  return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

static inline const UIFontFace* ui_font_face(uint8_t id) {
   if (id == 0) return nullptr;
   for (uint16_t i = 0; i < __ui_font_face_count; i++) {
     if (__ui_font_faces[i].id == id) return &__ui_font_faces[i];
   }
   return nullptr;
 }

 static inline const UIFontGlyph* ui_font_glyph(const UIFontFace* face, uint16_t codepoint) {
   if (!face) return nullptr;
  for (uint8_t i = 0; i < face->glyphCount; i++) {
    if (face->glyphs[i].codepoint == codepoint) return &face->glyphs[i];
  }
  return nullptr;
}

static inline uint8_t ui_font_alpha_at(const UIFontFace* face, const UIFontGlyph* glyph, uint16_t pixelIndex) {
   if (!face || !glyph || !face->alpha) return 0;
   uint16_t nibble = glyph->dataOffset + pixelIndex;
   // Bounds check to prevent reading past the alpha array
   if (nibble >> 1 >= 65535) return 0;
#if defined(__AVR__)
   uint8_t byte = pgm_read_byte(&face->alpha[nibble >> 1]);
#else
   uint8_t byte = face->alpha[nibble >> 1];
#endif
   return (nibble & 1) ? (byte & 0x0F) : (byte >> 4);
 }

static inline uint16_t ui_next_utf8_codepoint(const unsigned char** p) {
  const unsigned char* s = *p;
  uint8_t b0 = *s++;
  if (b0 < 0x80) {
    *p = s;
    return b0;
  }
  if ((b0 & 0xE0) == 0xC0 && (s[0] & 0xC0) == 0x80) {
    uint16_t cp = ((uint16_t)(b0 & 0x1F) << 6) | (uint16_t)(s[0] & 0x3F);
    *p = s + 1;
    return cp;
  }
  if ((b0 & 0xF0) == 0xE0 && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80) {
    uint16_t cp = ((uint16_t)(b0 & 0x0F) << 12) | ((uint16_t)(s[0] & 0x3F) << 6) | (uint16_t)(s[1] & 0x3F);
    *p = s + 2;
    return cp;
  }
  if ((b0 & 0xF8) == 0xF0 && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
    *p = s + 3;
    return '?';
  }
  *p = s;
  return '?';
}

static inline uint16_t ui_asset_text_width(const char* text, const UIFontFace* face) {
  if (!text || !face) return 0;
  uint16_t w = 0;
  const unsigned char* p = (const unsigned char*)text;
  while (*p) {
    uint16_t codepoint = ui_next_utf8_codepoint(&p);
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    w += glyph ? glyph->advance : (face->lineHeight / 2);
  }
  return w;
}

static inline uint8_t ui_asset_text_height(const UIFontFace* face) {
  return face ? face->lineHeight : 0;
}

static inline uint16_t ui_text_width(const char* text, uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (face) return ui_asset_text_width(text, face);
  if (!text) return 0;
  if (ts == 0) ts = 2;
  uint16_t w = 0;
  for (const char* p = text; *p; p++) w += ts * 6 + letterSpacing;
  return w;
}

static inline uint8_t ui_text_height(uint8_t ts, uint8_t fontFace) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (face) return ui_asset_text_height(face);
  return (ts ? ts : 2) * 8;
}

static inline uint8_t ui_text_line_height(uint8_t ts, uint8_t fontFace, uint8_t lineHeight) {
  return lineHeight ? lineHeight : ui_text_height(ts, fontFace);
}

static inline uint8_t ui_is_text_space(char c) {
  return c == ' ' || c == '\t' || c == '\f' || c == '\v';
}

static inline uint8_t ui_is_text_newline(char c) {
  return c == '\n' || c == '\r';
}

static inline const char* ui_after_text_newline(const char* p) {
  if (!p || !*p) return p;
  if (*p == '\r' && p[1] == '\n') return p + 2;
  return p + 1;
}

static inline const char* ui_skip_wrap_spaces(const char* p) {
  while (p && ui_is_text_space(*p)) p++;
  return p;
}

static inline uint16_t ui_next_utf8_codepoint_bounded(const unsigned char** p, const unsigned char* end) {
  const unsigned char* s = *p;
  if (!s || s >= end) return 0;
  uint8_t b0 = *s++;
  if (b0 < 0x80) {
    *p = s;
    return b0;
  }
  if ((b0 & 0xE0) == 0xC0 && s < end && (s[0] & 0xC0) == 0x80) {
    uint16_t cp = ((uint16_t)(b0 & 0x1F) << 6) | (uint16_t)(s[0] & 0x3F);
    *p = s + 1;
    return cp;
  }
  if ((b0 & 0xF0) == 0xE0 && s + 1 < end && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80) {
    uint16_t cp = ((uint16_t)(b0 & 0x0F) << 12) | ((uint16_t)(s[0] & 0x3F) << 6) | (uint16_t)(s[1] & 0x3F);
    *p = s + 2;
    return cp;
  }
  if ((b0 & 0xF8) == 0xF0 && s + 2 < end && (s[0] & 0xC0) == 0x80 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
    *p = s + 3;
    return '?';
  }
  *p = s;
  return '?';
}

static inline uint16_t ui_text_codepoint_advance(uint16_t codepoint, uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (face) {
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    return glyph ? glyph->advance : (face->lineHeight / 2);
  }
  int16_t adv = (int16_t)(ts ? ts : 2) * 6 + letterSpacing;
  return adv > 0 ? (uint16_t)adv : 1;
}

static inline uint16_t ui_text_span_width(const char* start, const char* end, uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  if (!start || !end || end <= start) return 0;
  uint16_t w = 0;
  const unsigned char* p = (const unsigned char*)start;
  const unsigned char* limit = (const unsigned char*)end;
  while (p < limit && *p) {
    uint16_t codepoint = ui_next_utf8_codepoint_bounded(&p, limit);
    if (codepoint == 0) break;
    w += ui_text_codepoint_advance(codepoint, ts, fontFace, letterSpacing);
  }
  return w;
}

struct UITextLine {
  const char* start;
  const char* end;
  uint16_t width;
};

static inline uint8_t ui_text_next_line(const char** cursor, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, UITextLine* out) {
   if (!cursor || !*cursor || !out) return 0;
   const char* p = *cursor;
   if (!*p) return 0;
   uint8_t hardNewlines = whiteSpaceMode == UI_WS_PRE || whiteSpaceMode == UI_WS_PRE_LINE;
   uint8_t canWrap = (whiteSpaceMode == UI_WS_NORMAL || whiteSpaceMode == UI_WS_PRE_LINE) && maxWidth > 0;

   if (whiteSpaceMode == UI_WS_NORMAL || whiteSpaceMode == UI_WS_PRE_LINE) {
     p = ui_skip_wrap_spaces(p);
   }
   if (!*p) {
     *cursor = p;
     return 0;
   }
   if (hardNewlines && ui_is_text_newline(*p)) {
     out->start = p;
     out->end = p;
     out->width = 0;
     *cursor = ui_after_text_newline(p);
     return 1;
   }

   const char* lineStart = p;
   if (!canWrap) {
     while (*p && !(hardNewlines && ui_is_text_newline(*p))) p++;
     out->start = lineStart;
     out->end = p;
     out->width = ui_text_span_width(lineStart, p, ts, fontFace, letterSpacing);
     *cursor = (hardNewlines && ui_is_text_newline(*p)) ? ui_after_text_newline(p) : p;
     return 1;
   }

   uint16_t width = 0;
   const char* lastBreakAfter = nullptr;
   const char* lastBreakEnd = lineStart;
   uint16_t lastBreakWidth = 0;
   const char* lastNonSpaceEnd = lineStart;
   uint16_t lastNonSpaceWidth = 0;

   // Pre-compute string end bounds to avoid repeated scans in the loop
   const unsigned char* textEnd = (const unsigned char*)p;
   while (*textEnd) textEnd++;

   while (*p && p < (const char*)textEnd) {
     if (hardNewlines && ui_is_text_newline(*p)) break;
     const char* charStart = p;
     const unsigned char* next = (const unsigned char*)p;
     uint16_t codepoint = ui_next_utf8_codepoint_bounded(&next, textEnd);
     if (codepoint == 0) break;
     const char* charEnd = (const char*)next;
     uint8_t isBreakSpace = ui_is_text_space(*charStart) || (!hardNewlines && ui_is_text_newline(*charStart));
     uint16_t adv = ui_text_codepoint_advance(codepoint, ts, fontFace, letterSpacing);

     if (width > 0 && width + adv > maxWidth) {
       if (lastBreakAfter && lastBreakAfter > lineStart) {
         out->start = lineStart;
         out->end = lastBreakEnd;
         out->width = lastBreakWidth;
         *cursor = lastBreakAfter;
         return 1;
       }
       out->start = lineStart;
       out->end = charStart;
       out->width = width;
       *cursor = charStart;
       return 1;
     }

     width += adv;
     p = charEnd;
     if (isBreakSpace) {
       lastBreakAfter = p;
       lastBreakEnd = lastNonSpaceEnd;
       lastBreakWidth = lastNonSpaceWidth;
     } else {
       lastNonSpaceEnd = p;
       lastNonSpaceWidth = width;
     }
   }

   out->start = lineStart;
   if (whiteSpaceMode == UI_WS_NORMAL || whiteSpaceMode == UI_WS_PRE_LINE) {
     out->end = lastNonSpaceEnd;
     out->width = lastNonSpaceWidth;
   } else {
     out->end = p;
     out->width = width;
   }
   *cursor = (hardNewlines && ui_is_text_newline(*p)) ? ui_after_text_newline(p) : p;
   return 1;
 }

 static inline void ui_text_layout_metrics(const char* text, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, uint8_t lineHeight, uint16_t* outW, uint16_t* outH) {
  if (!text) text = "";
  uint16_t maxLineW = 0;
  uint16_t h = 0;
  uint8_t lh = ui_text_line_height(ts, fontFace, lineHeight);
  const char* cursor = text;
  UITextLine line;
  while (ui_text_next_line(&cursor, maxWidth, whiteSpaceMode, ts, fontFace, letterSpacing, &line)) {
    if (line.width > maxLineW) maxLineW = line.width;
    h += lh;
  }
  if (h == 0) h = lh;
  if (outW) *outW = maxLineW;
  if (outH) *outH = h;
}

static inline void ui_invalidate_text_layout_cache(uint16_t nodeIdx) {
  if (nodeIdx < __ui_node_count) __ui_nodes[nodeIdx].layoutCacheKey = 0;
}

static inline uint32_t ui_text_layout_cache_key(uint16_t nodeIdx, uint16_t textMaxW) {
  uint32_t key = textMaxW;
  key = key * 31u + __ui_nodes[nodeIdx].whiteSpaceMode;
  uint8_t ts = __ui_nodes[nodeIdx].textSize ? __ui_nodes[nodeIdx].textSize : 2;
  key = key * 31u + ts;
  key = key * 31u + __ui_nodes[nodeIdx].fontFace;
  key = key * 31u + (uint8_t)(__ui_nodes[nodeIdx].letterSpacing + 128);
  key = key * 31u + __ui_nodes[nodeIdx].lineHeight;
  if (__ui_nodes[nodeIdx].hasTextBinding) {
    const char* t = __ui_nodes[nodeIdx].textBuffer;
    while (t && *t) {
      key = key * 31u + (uint8_t)*t;
      t++;
    }
  }
  return key | 1u;
}

static inline uint16_t ui_node_text_max_width(uint16_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  uint16_t textMaxW = __ui_nodes[nodeIdx].box.w;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT || __ui_nodes[nodeIdx].kind == NODE_BUTTON) {
    uint16_t hInset = (uint16_t)__ui_nodes[nodeIdx].paddingLeft + (uint16_t)__ui_nodes[nodeIdx].paddingRight +
      (uint16_t)__ui_nodes[nodeIdx].borderWidth * 2;
    textMaxW = __ui_nodes[nodeIdx].box.w > hInset ? (uint16_t)(__ui_nodes[nodeIdx].box.w - hInset) : 0;
  } else if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    textMaxW = __ui_nodes[nodeIdx].box.w > 22 ? (uint16_t)(__ui_nodes[nodeIdx].box.w - 22) : 0;
  }
  return textMaxW;
}

static inline void ui_node_text_layout_metrics(uint16_t nodeIdx, uint16_t textMaxW, uint16_t* outW, uint16_t* outH) {
  if (nodeIdx >= __ui_node_count) {
    if (outW) *outW = 0;
    if (outH) *outH = 0;
    return;
  }
  uint32_t key = ui_text_layout_cache_key(nodeIdx, textMaxW);
  if (__ui_nodes[nodeIdx].layoutCacheKey == key) {
    if (outW) *outW = __ui_nodes[nodeIdx].layoutMetricsW;
    if (outH) *outH = __ui_nodes[nodeIdx].layoutMetricsH;
    return;
  }
  const char* displayText = __ui_nodes[nodeIdx].hasTextBinding
    ? __ui_nodes[nodeIdx].textBuffer
    : __ui_nodes[nodeIdx].text;
  uint8_t ts = __ui_nodes[nodeIdx].textSize ? __ui_nodes[nodeIdx].textSize : 2;
  uint16_t tw = 0;
  uint16_t th = 0;
  ui_text_layout_metrics(displayText, textMaxW, __ui_nodes[nodeIdx].whiteSpaceMode, ts,
    __ui_nodes[nodeIdx].fontFace, __ui_nodes[nodeIdx].letterSpacing, __ui_nodes[nodeIdx].lineHeight, &tw, &th);
  __ui_nodes[nodeIdx].layoutCacheKey = key;
  __ui_nodes[nodeIdx].layoutMetricsW = tw;
  __ui_nodes[nodeIdx].layoutMetricsH = th;
  if (outW) *outW = tw;
  if (outH) *outH = th;
}

static inline void ui_copy_text_span(const char* start, const char* end, char* out, uint8_t outSize) {
  if (!out || outSize == 0) return;
  uint8_t len = 0;
  while (start && end && start < end && *start && len + 1 < outSize) {
    out[len++] = *start++;
  }
  out[len] = 0;
}

static inline uint8_t ui_draw_asset_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t antialias, uint8_t fontFace) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (!text || !face) return 0;
  int16_t cursor = x;
  int16_t baseline = y + face->baseline;
  int16_t targetLeft, targetTop, targetRight, targetBottom;
  ui_display_target_bounds(&targetLeft, &targetTop, &targetRight, &targetBottom);
  const unsigned char* p = (const unsigned char*)text;
  while (*p) {
    uint16_t codepoint = ui_next_utf8_codepoint(&p);
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    if (!glyph) {
      cursor += face->lineHeight / 2;
      continue;
    }
    int16_t glyphX = cursor + glyph->xOffset;
    int16_t glyphY = baseline + glyph->yOffset;
    if (glyphX + (int16_t)glyph->width <= targetLeft || glyphX >= targetRight ||
        glyphY + (int16_t)glyph->height <= targetTop || glyphY >= targetBottom) {
      cursor += glyph->advance;
      continue;
    }
    int16_t gxStart = glyphX < targetLeft ? (int16_t)(targetLeft - glyphX) : 0;
    int16_t gyStart = glyphY < targetTop ? (int16_t)(targetTop - glyphY) : 0;
    int16_t gxEnd = glyphX + (int16_t)glyph->width > targetRight ? (int16_t)(targetRight - glyphX) : glyph->width;
    int16_t gyEnd = glyphY + (int16_t)glyph->height > targetBottom ? (int16_t)(targetBottom - glyphY) : glyph->height;
    for (int16_t gy = gyStart; gy < gyEnd; gy++) {
      for (int16_t gx = gxStart; gx < gxEnd; gx++) {
        uint16_t pixelIndex = (uint16_t)gy * glyph->width + (uint16_t)gx;
        uint8_t alpha = ui_font_alpha_at(face, glyph, pixelIndex);
        if (alpha == 0) continue;
        int16_t dx = glyphX + gx;
        int16_t dy = glyphY + gy;
        if (antialias) {
          if (fg == bg) {
            // Transparent mode: can't blend (fg==bg → all alphas become fg).
            // Use a threshold so only high-coverage pixels draw, avoiding
            // the bumpy look from flattening sub-pixel coverage to solid.
            if (alpha >= 8) ui_display_draw_pixel(dx, dy, fg);
          } else {
            ui_display_draw_pixel(dx, dy, alpha >= 15 ? fg : ui_blend(fg, bg, (uint8_t)((uint16_t)alpha * 100 / 15)));
          }
        } else if (alpha >= 8) {
          ui_display_draw_pixel(dx, dy, fg);
        }
      }
    }
    cursor += glyph->advance;
  }
  return 1;
}

static inline void ui_draw_bitmap_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts, int8_t letterSpacing) {
  if (!text) text = "";
  if (ts == 0) ts = 2;
  ui_display_set_text_color(fg, bg);
  ui_display_set_text_size(ts);
  ui_display_set_text_wrap(false);
  // Draw char-by-char to apply letterSpacing between glyphs.
  if (letterSpacing == 0) {
    ui_display_set_cursor(x, y);
    ui_display_print(text);
  } else {
    int16_t cx = x;
    char buf[2] = {0, 0};
    for (const char* p = text; *p; p++) {
      ui_display_set_cursor(cx, y);
      buf[0] = *p;
      ui_display_print(buf);
      cx += ts * 6 + letterSpacing;
    }
}
 }

 #ifdef UI_AA
 static CuttlefishCanvas16* __ui_aa_canvas = nullptr;
 static CuttlefishCanvas16* __ui_text_src_canvas = nullptr;
 static CuttlefishCanvas16* __ui_text_dst_canvas = nullptr;

 static inline CuttlefishCanvas16* ui_text_canvas(CuttlefishCanvas16** slot, int16_t w, int16_t h) {
   if (w <= 0) w = 1;
   if (h <= 0) h = 1;
   if (!*slot || display_canvasWidth(*slot) < w || display_canvasHeight(*slot) < h) {
     display_deleteCanvas(*slot);
     *slot = display_createCanvas(w, h);
   }
   return *slot;
 }

 static inline uint8_t ui_text_fg_neighbors(CuttlefishCanvas16* src, int16_t x, int16_t y, int16_t w, int16_t h, UI_COLOR_T fg, uint8_t radius = 1) {
  uint8_t count = 0;
  for (int8_t dy = -(int8_t)radius; dy <= (int8_t)radius; dy++) {
    int16_t yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (int8_t dx = -(int8_t)radius; dx <= (int8_t)radius; dx++) {
      int16_t xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      if (display_canvasGetPixel(src, xx, yy) == fg) count++;
    }
  }
  return count;
}

static inline uint8_t ui_text_aa_coverage(uint8_t neighbors, uint8_t outerNeighbors, uint8_t isFg, uint8_t ts) {
  if (isFg) {
    if (ts <= 1) return neighbors >= 4 ? 100 : 96;
    if (ts == 2) return neighbors >= 8 ? 100 : neighbors >= 5 ? 96 : 92;
    return neighbors >= 8 ? 100 : neighbors >= 6 ? 96 : neighbors >= 4 ? 90 : 84;
  }
  if (neighbors == 0) {
    if (ts >= 3 && outerNeighbors > 0) {
      uint8_t outer = outerNeighbors * 2;
      return outer > 14 ? 14 : outer;
    }
    return 0;
  }
  uint8_t step = ts <= 1 ? 4 : ts == 2 ? 6 : 8;
  uint8_t cap = ts <= 1 ? 18 : ts == 2 ? 28 : 38;
  uint8_t coverage = neighbors * step;
  return coverage > cap ? cap : coverage;
}

static inline void ui_draw_aa_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts) {
  if (!text || !*text) return;
  if (ts == 0) ts = 2;
  uint16_t w = ui_text_width(text, ts, 0, 0);
  // Add 1px bottom padding so the AA edge-detection sampling doesn't clip the
  // glyph bottoms (the neighbor-count at the last row rounds partial coverage
  // to 0 without this clearance).
  uint8_t h = ui_text_height(ts, 0) + 1;
  if (w == 0 || h == 0 || fg == bg) {
    ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
    return;
  }
  int16_t clipX = x;
  int16_t clipY = y;
  int16_t clipW = (int16_t)w;
  int16_t clipH = (int16_t)h;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  int16_t localX = (int16_t)(clipX - x);
  int16_t localY = (int16_t)(clipY - y);

// Use pre-allocated static canvases (no dynamic allocation)
   CuttlefishCanvas16* src = ui_text_canvas(&__ui_text_src_canvas, (int16_t)w, (int16_t)h);
   CuttlefishCanvas16* dst = ui_text_canvas(&__ui_text_dst_canvas, (int16_t)w, (int16_t)h);
   if (!src || !dst || !display_canvasBuffer(src) || !display_canvasBuffer(dst)) {
     ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
     return;
   }

   display_canvasFillRect(src, 0, 0, w, h, bg);
   display_canvasFillRect(dst, localX, localY, clipW, clipH, bg);
   display_targetSetCursor((CuttlefishDisplayTarget*)src, 0, 0);
   display_targetSetTextColorBg((CuttlefishDisplayTarget*)src, fg, bg);
   display_targetSetTextSize((CuttlefishDisplayTarget*)src, ts);
   display_targetSetTextWrap((CuttlefishDisplayTarget*)src, false);
   display_targetPrint((CuttlefishDisplayTarget*)src, text);

   for (int16_t yy = localY; yy < localY + clipH; yy++) {
     for (int16_t xx = localX; xx < localX + clipW; xx++) {
       UI_COLOR_T px = display_canvasGetPixel(src, xx, yy);
       uint8_t neighbors = ui_text_fg_neighbors(src, xx, yy, (int16_t)w, h, fg);
       uint8_t outerNeighbors = 0;
       if (ts >= 3 && px != fg && neighbors == 0) {
         outerNeighbors = ui_text_fg_neighbors(src, xx, yy, (int16_t)w, h, fg, 2);
       }
       uint8_t coverage = ui_text_aa_coverage(neighbors, outerNeighbors, px == fg ? 1 : 0, ts);
       display_targetDrawPixel((CuttlefishDisplayTarget*)dst, xx, yy, coverage == 0 ? bg : ui_blend(fg, bg, coverage));
     }
   }

   int16_t stride = display_canvasWidth(dst);
   UI_COLOR_T* pixels = display_canvasBuffer(dst);
   for (int16_t row = 0; row < clipH; row++) {
     ui_display_draw_rgb_bitmap(clipX, (int16_t)(clipY + row),
       pixels + (int32_t)(localY + row) * stride + localX, clipW, 1);
   }
 }

static inline void ui_draw_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing) {
  if (fontFace && ui_draw_asset_text(text, x, y, fg, bg, antialias, fontFace)) {
    return;
  }
  // Only use AA when fg != bg (opaque background). When fg == bg (transparent
  // mode), the AA source canvas fills entirely with fg — no edges to detect,
  // producing a solid rectangle instead of text.
  if (antialias && fg != bg && letterSpacing == 0) {
    ui_draw_aa_text(text, x, y, fg, bg, ts);
    return;
  }
  ui_draw_bitmap_text(text, x, y, fg, bg, ts, letterSpacing);
}
#else
static inline void ui_draw_text(const char* text, int16_t x, int16_t y, UI_COLOR_T fg, UI_COLOR_T bg, uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing) {
  (void)antialias;
  if (fontFace && ui_draw_asset_text(text, x, y, fg, bg, antialias, fontFace)) {
    return;
  }
  ui_draw_bitmap_text(text, x, y, fg, bg, ts, letterSpacing);
}
#endif

/** Truncate a NUL-terminated buffer in place to fit within maxWidth (px) and
 *  append "...". Used by text-overflow: ellipsis. Adafruit_GFX has no ellipsis
 *  glyph, so three ASCII dots approximate it. */
static inline void ui_truncate_ellipsis(char* buf, uint8_t bufSize, uint16_t maxWidth,
                                        uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  if (!buf || bufSize == 0) return;
  uint8_t len = (uint8_t)strlen(buf);
  // Reserve space for the three trailing dots.
  uint16_t dotsW = (uint16_t)3 * ui_text_codepoint_advance((uint16_t)'.', ts, fontFace, letterSpacing);
  int16_t budget = (int16_t)maxWidth - (int16_t)dotsW;
  if (budget <= 0) { if (bufSize > 3) { buf[0]='.'; buf[1]='.'; buf[2]='.'; buf[3]=0; } return; }
  // Trim trailing chars until the prefix fits the budget.
  uint8_t prefix = len;
  while (prefix > 0) {
    uint16_t w = ui_text_span_width(buf, buf + prefix, ts, fontFace, letterSpacing);
    if ((int16_t)w <= budget) break;
    prefix--;
  }
  if (prefix + 3 < bufSize) {
    buf[prefix] = '.'; buf[prefix+1] = '.'; buf[prefix+2] = '.'; buf[prefix+3] = 0;
  } else if (bufSize > 3) {
    buf[0]='.'; buf[1]='.'; buf[2]='.'; buf[3]=0;
  }
}

// text-overflow: clip — trim trailing chars until the prefix fits maxWidth,
// then NUL-terminate. No trailing dots (contrast with ui_truncate_ellipsis).
static inline void ui_truncate_clip(char* buf, uint8_t bufSize, uint16_t maxWidth,
                                     uint8_t ts, uint8_t fontFace, int8_t letterSpacing) {
  if (!buf || bufSize == 0) return;
  uint8_t len = (uint8_t)strlen(buf);
  uint8_t prefix = len;
  while (prefix > 0) {
    uint16_t w = ui_text_span_width(buf, buf + prefix, ts, fontFace, letterSpacing);
    if ((int16_t)w <= (int16_t)maxWidth) break;
    prefix--;
  }
  if (prefix < bufSize) buf[prefix] = 0;
}

static inline void ui_draw_wrapped_text(const char* text, int16_t x, int16_t y, uint16_t maxWidth, UI_COLOR_T fg, UI_COLOR_T bg,
                                        uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing,
                                        uint8_t lineHeight, uint8_t whiteSpaceMode, uint8_t textAlign, uint8_t underline, uint8_t textOverflow) {
  if (!text) text = "";
  uint8_t lh = ui_text_line_height(ts, fontFace, lineHeight);
  const char* cursor = text;
  int16_t lineY = y;
  UITextLine line;
  char lineBuf[UI_TEXT_LINE_BUF];
  int16_t targetLeft, targetTop, targetRight, targetBottom;
  ui_display_target_bounds(&targetLeft, &targetTop, &targetRight, &targetBottom);
  while (ui_text_next_line(&cursor, maxWidth, whiteSpaceMode, ts, fontFace, letterSpacing, &line)) {
    int16_t lineBottom = (int16_t)(lineY + lh);
    if (lineBottom <= targetTop || lineY >= targetBottom) {
      lineY += lh;
      continue;
    }
    int16_t lineX = x;
    if (textAlign == 1) lineX = x + ((int16_t)maxWidth - (int16_t)line.width) / 2;
    else if (textAlign == 2) lineX = x + (int16_t)maxWidth - (int16_t)line.width;
    if (lineX + (int16_t)line.width <= targetLeft || lineX >= targetRight) {
      lineY += lh;
      continue;
    }
    ui_copy_text_span(line.start, line.end, lineBuf, UI_TEXT_LINE_BUF);
    // text-overflow — only applies when the line is wider than maxWidth.
    //   textOverflow==1 (ellipsis): trim the span and append "...".
    //   textOverflow==0 (clip):     trim the span to the edge, no dots.
    if ((int16_t)line.width > (int16_t)maxWidth) {
      if (textOverflow) ui_truncate_ellipsis(lineBuf, UI_TEXT_LINE_BUF, maxWidth, ts, fontFace, letterSpacing);
      else              ui_truncate_clip(lineBuf, UI_TEXT_LINE_BUF, maxWidth, ts, fontFace, letterSpacing);
    }
    ui_draw_text(lineBuf, lineX, lineY, fg, bg, ts, antialias, fontFace, letterSpacing);
    // text-decoration (underline=bit0, strikethrough=bit1)
    if (underline & 1) ui_display_draw_fast_hline(lineX, lineY + ui_text_height(ts, fontFace) - 1, line.width, fg);
    if (underline & 2) ui_display_draw_fast_hline(lineX, lineY + ui_text_height(ts, fontFace) / 2, line.width, fg);
    lineY += lh;
  }
}

// Draw a rich-text node from its precomputed run/segment/line geometry. Does
// NOT re-wrap — the geometry was baked at transpile time (runs are static-only,
// so the text never changes at runtime). Iterate segments once, skip lines and
// segments outside the active draw target, and compute each segment's line
// origin from textAlign + line width. Mixed font sizes align on the line's
// baseline (each segment's top = baseline − its own ascent).
static inline void ui_draw_rich_text(uint16_t nodeIdx, int16_t x, int16_t y, UI_COLOR_T bg, uint8_t antialias,
                                     uint8_t useFgOverride = 0, UI_COLOR_T fgOverride = 0, uint16_t maxWidth = 0) {
  UINode* n = &__ui_nodes[nodeIdx];
  uint16_t alignWidth = maxWidth ? maxWidth : n->box.w;
  int16_t targetLeft = (int16_t)(-__ui_draw_off_x);
  int16_t targetTop = (int16_t)(-__ui_draw_off_y);
  int16_t targetRight = (int16_t)(ui_display_target_width() - __ui_draw_off_x);
  int16_t targetBottom = (int16_t)(ui_display_target_height() - __ui_draw_off_y);
  uint16_t richSegEnd = (uint16_t)(n->richSegStart + n->richSegCount);
  for (uint16_t si = n->richSegStart; si < richSegEnd; si++) {
    UIRichSeg* seg = &__ui_rich_segs[si];
    if (seg->line >= n->richLineCount) continue;
    UIRichLine* line = &__ui_rich_lines[n->richLineStart + seg->line];
    int16_t lineTop = y + line->y;
    int16_t lineBottom = (int16_t)(lineTop + (int16_t)line->h);
    if (lineBottom <= targetTop || lineTop >= targetBottom) continue;
    int16_t lineX = x;
    if (n->textAlign == 1) lineX = x + ((int16_t)alignWidth - (int16_t)line->w) / 2;
    else if (n->textAlign == 2) lineX = x + (int16_t)alignWidth - (int16_t)line->w;
    int16_t segX = (int16_t)(lineX + seg->x);
    int16_t segRight = (int16_t)(segX + (int16_t)seg->w);
    if (segRight <= targetLeft || segX >= targetRight) continue;
    UIRichRun* run = &__ui_runs[n->runStart + seg->runIndex];
    // Baseline alignment: for asset fonts, the ascent is the font face's
    // baseline (baked per px size); for the bitmap font (fontFace=0), it's the
    // 5x8 glyph ascent (7px × textSize). Using the wrong ascent misaligns runs
    // vertically and makes mixed rich-text lines look garbled.
    int16_t ascent;
    if (run->fontFace) {
      const UIFontFace* face = ui_font_face(run->fontFace);
      ascent = face ? (int16_t)face->baseline : (7 * (int16_t)run->textSize);
    } else {
      ascent = 7 * (int16_t)run->textSize;
    }
    int16_t segY = y + line->baseline - ascent;
    UI_COLOR_T fg = useFgOverride ? fgOverride : run->fg;
    ui_draw_text(seg->text, segX, segY, fg, bg, run->textSize, antialias, run->fontFace, run->letterSpacing);
    if (run->underline & 1) ui_display_draw_fast_hline(segX, segY + 8 * run->textSize - 1, seg->w, fg);
    if (run->underline & 2) ui_display_draw_fast_hline(segX, segY + 4 * run->textSize, seg->w, fg);
  }
}

// Hit-test a tap point (in node-local coordinates) against a rich-text node's
// link runs. Returns the link run's resolved screen index, or -1 if the point
// doesn't land on a link segment. Mirrors the list-item subdivision precedent
// but uses measured segment rects instead of fixed row heights.
static inline int8_t ui_rich_link_hit(uint16_t nodeIdx, int16_t px, int16_t py) {
  UINode* n = &__ui_nodes[nodeIdx];
  int16_t insetL = (int16_t)n->borderWidth + (int16_t)n->paddingLeft;
  int16_t insetR = (int16_t)n->borderWidth + (int16_t)n->paddingRight;
  int16_t insetT = (int16_t)n->borderWidth + (int16_t)n->paddingTop;
  int16_t localX = px - insetL;
  int16_t localY = py - insetT;
  uint16_t alignWidth = n->box.w > (uint16_t)(insetL + insetR)
    ? (uint16_t)((int16_t)n->box.w - insetL - insetR)
    : 0;
  for (uint16_t si = n->richSegStart; si < n->richSegStart + n->richSegCount; si++) {
    UIRichSeg* seg = &__ui_rich_segs[si];
    UIRichRun* run = &__ui_runs[n->runStart + seg->runIndex];
    if (run->linkTarget < 0) continue;
    UIRichLine* line = &__ui_rich_lines[n->richLineStart + seg->line];
    // Segment x is relative to its line's left edge (pre-alignment). For the
    // hit-test, account for center/right alignment the same way draw does.
    int16_t originX = 0;
    if (n->textAlign == 1) originX = ((int16_t)alignWidth - (int16_t)line->w) / 2;
    else if (n->textAlign == 2) originX = (int16_t)alignWidth - (int16_t)line->w;
    int16_t sx = originX + seg->x;
    int16_t sy = line->y;
    if (localX >= sx && localX < sx + (int16_t)seg->w && localY >= sy && localY < sy + (int16_t)line->h) {
      return run->linkTarget;
    }
  }
  return -1;
}

// Draw shadows for an element. Loops over up to 4 shadow specs. Outset shadows
// are drawn behind the element; inset shadows are drawn over the element fill.
// Draw a gradient fill for an element. Replaces solid fillRect/fillRoundRect.
static inline void ui_draw_gradient_fill(uint16_t i, int16_t drawY) {
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = drawY;
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  int16_t clipX = bx;
  int16_t clipY = by;
  int16_t clipW = bw;
  int16_t clipH = bh;
  if (!ui_clip_rect_to_display_target(&clipX, &clipY, &clipW, &clipH)) return;
  UI_COLOR_T c1 = __ui_nodes[i].gradientColor1;
  UI_COLOR_T c2 = __ui_nodes[i].gradientColor2;
  uint8_t dir = __ui_nodes[i].gradientEnabled;  // 1=vertical, 2=horizontal
  if (dir == 1) {
    // Vertical: top=c1, bottom=c2. Draw row by row.
    int16_t yStart = (int16_t)(clipY - by);
    int16_t yEnd = (int16_t)(clipY + clipH - by);
    for (int16_t y = yStart; y < yEnd; y++) {
      uint8_t op = (uint8_t)((uint16_t)y * 100 / (bh > 1 ? bh - 1 : 1));
      uint32_t col = ui_blend(c1, c2, op);
      ui_display_draw_fast_hline(clipX, by + y, clipW, col);
    }
  } else {
    // Horizontal: left=c1, right=c2. Draw column by column.
    int16_t xStart = (int16_t)(clipX - bx);
    int16_t xEnd = (int16_t)(clipX + clipW - bx);
    for (int16_t x = xStart; x < xEnd; x++) {
      uint8_t op = (uint8_t)((uint16_t)x * 100 / (bw > 1 ? bw - 1 : 1));
      uint32_t col = ui_blend(c1, c2, op);
      ui_display_draw_fast_vline(bx + x, clipY, clipH, col);
    }
  }
}

static inline void ui_draw_shadow(uint16_t i, int16_t drawY, uint8_t insetOnly) {
  if (__ui_nodes[i].shadowCount == 0) return;
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = drawY;
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  UI_COLOR_T clearCol = __ui_nodes[i].clearColor;
  uint8_t radius = __ui_nodes[i].borderRadius;

  for (uint8_t s = 0; s < __ui_nodes[i].shadowCount && s < 4; s++) {
    if (s >= __ui_nodes[i].shadowCount) continue;  // use count, not color check (0 is valid black)
    UI_COLOR_T shadowCol = __ui_nodes[i].shadowColor[s];
    int8_t ox = __ui_nodes[i].shadowOffsetX[s];
    int8_t oy = __ui_nodes[i].shadowOffsetY[s];
    uint8_t rawBlur = __ui_nodes[i].shadowBlur[s];
    uint8_t blur = rawBlur;
    if (blur == 0) blur = 1;  // at least 1 pass for a hard shadow
    uint8_t baseAlpha = __ui_nodes[i].shadowAlpha[s];
    uint8_t inset = __ui_nodes[i].shadowInset[s];
    if (insetOnly && !inset) continue;
    if (!insetOnly && inset) continue;

    if (inset && rawBlur == 0) {
      UI_COLOR_T insetBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
      uint32_t col = ui_blend(shadowCol, insetBg, baseAlpha);
      if (oy > 0) {
        ui_display_fill_rect(bx, by, bw, oy, col);
      } else if (oy < 0) {
        ui_display_fill_rect(bx, by + bh + oy, bw, -oy, col);
      }
      if (ox > 0) {
        ui_display_fill_rect(bx, by, ox, bh, col);
      } else if (ox < 0) {
        ui_display_fill_rect(bx + bw + ox, by, -ox, bh, col);
      }
      if (ox == 0 && oy == 0) {
        ui_display_draw_rect(bx, by, bw, bh, col);
      }
      continue;
    }

    for (int8_t pass = blur; pass >= 1; pass--) {
      uint8_t opacity = (uint8_t)((uint16_t)baseAlpha / (pass + 1));
      uint32_t col = ui_blend(shadowCol, inset ? (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : clearCol) : clearCol, opacity);
      if (inset) {
        // Inset: draw inside the element, shrinking inward by pass.
        int16_t ix = bx + pass;
        int16_t iy = by + pass;
        int16_t iw = bw - 2 * pass;
        int16_t ih = bh - 2 * pass;
        if (iw <= 0 || ih <= 0) continue;
        // Offset the inset by the shadow's x/y (e.g. top highlight).
        iy += oy;
        ix += ox;
        // Draw only the edge ring (4 thin rects), not a full fill — the
        // element's own background will cover the center anyway.
        ui_display_fill_rect(ix, iy, iw, 1, col);         // top edge
        ui_display_fill_rect(ix, iy + ih - 1, iw, 1, col); // bottom edge
        ui_display_fill_rect(ix, iy, 1, ih, col);          // left edge
        ui_display_fill_rect(ix + iw - 1, iy, 1, ih, col); // right edge
      } else {
        // Outset: expand outward from box + offset.
        int16_t sx = bx + ox - pass;
        int16_t sy = by + oy - pass;
        int16_t sw = bw + 2 * pass;
        int16_t sh_ = bh + 2 * pass;
        if (radius > 0) {
          uint8_t r = radius + (uint8_t)pass;
          if (r > sw / 2) r = sw / 2;
          if (r > sh_ / 2) r = sh_ / 2;
          ui_display_fill_round_rect(sx, sy, sw, sh_, r, col);
        } else {
          ui_display_fill_rect(sx, sy, sw, sh_, col);
        }
      }
    }
  }
}

static inline void ui_draw_closed_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t radius, UI_COLOR_T color) {
  if (w <= 0 || h <= 0) return;
  uint8_t r = radius;
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  if (r == 0) {
    ui_display_draw_rect(x, y, w, h, color);
    return;
  }
  ui_display_draw_round_rect(x, y, w, h, r, color);
  // Adafruit_GFX's circle helper omits the cardinal tangent pixels. Fill them
  // so straight edges and corner arcs meet without visible pinholes.
  ui_display_draw_pixel(x + r, y, color);
  ui_display_draw_pixel(x + w - r - 1, y, color);
  ui_display_draw_pixel(x + r, y + h - 1, color);
  ui_display_draw_pixel(x + w - r - 1, y + h - 1, color);
  ui_display_draw_pixel(x, y + r, color);
  ui_display_draw_pixel(x + w - 1, y + r, color);
  ui_display_draw_pixel(x, y + h - r - 1, color);
  ui_display_draw_pixel(x + w - 1, y + h - r - 1, color);
}

static inline void ui_draw_rect_outline(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t radius, uint8_t style, uint8_t width, UI_COLOR_T color) {
  if (style == 0 || width == 0 || w <= 0 || h <= 0) return;
  for (uint8_t b = 0; b < width; b++) {
    int16_t rx = x + b;
    int16_t ry = y + b;
    int16_t rw = w - 2 * b;
    int16_t rh = h - 2 * b;
    if (rw <= 0 || rh <= 0) return;
    uint8_t r = radius > b ? radius - b : 0;
    if (style == 1) {
      if (r > 0) ui_draw_closed_round_rect(rx, ry, rw, rh, r, color);
      else ui_display_draw_rect(rx, ry, rw, rh, color);
    } else {
      for (int16_t dx = 0; dx < rw; dx += 8) {
        int16_t seg = (dx + 4 <= rw) ? 4 : (rw - dx);
        if (seg > 0) {
          ui_display_draw_fast_hline(rx + dx, ry, seg, color);
          ui_display_draw_fast_hline(rx + dx, ry + rh - 1, seg, color);
        }
      }
      for (int16_t dy = 0; dy < rh; dy += 8) {
        int16_t seg = (dy + 4 <= rh) ? 4 : (rh - dy);
        if (seg > 0) {
          ui_display_draw_fast_vline(rx, ry + dy, seg, color);
          ui_display_draw_fast_vline(rx + rw - 1, ry + dy, seg, color);
        }
      }
    }
  }
}

static inline void ui_draw_node_border(uint16_t i, int16_t drawX, int16_t drawY, UI_COLOR_T color) {
  // Per-side borders: when any side's width differs from the uniform width,
  // draw each side as an independent filled rect. The uniform path (one
  // ui_draw_rect_outline call) is the common case and stays unchanged.
  if (__ui_nodes[i].hasPerSideBorder) {
    int16_t w = __ui_nodes[i].box.w;
    int16_t h = __ui_nodes[i].box.h;
    uint8_t st = __ui_nodes[i].borderStyle;
    // Top edge
    if (__ui_nodes[i].borderTopWidth > 0) {
      ui_display_fill_rect(drawX, drawY, w, __ui_nodes[i].borderTopWidth, color);
    }
    // Bottom edge
    if (__ui_nodes[i].borderBottomWidth > 0) {
      ui_display_fill_rect(drawX, drawY + h - __ui_nodes[i].borderBottomWidth, w, __ui_nodes[i].borderBottomWidth, color);
    }
    // Left edge (between top and bottom borders)
    if (__ui_nodes[i].borderLeftWidth > 0) {
      ui_display_fill_rect(drawX, drawY + __ui_nodes[i].borderTopWidth, __ui_nodes[i].borderLeftWidth,
        h - __ui_nodes[i].borderTopWidth - __ui_nodes[i].borderBottomWidth, color);
    }
    // Right edge
    if (__ui_nodes[i].borderRightWidth > 0) {
      ui_display_fill_rect(drawX + w - __ui_nodes[i].borderRightWidth, drawY + __ui_nodes[i].borderTopWidth,
        __ui_nodes[i].borderRightWidth, h - __ui_nodes[i].borderTopWidth - __ui_nodes[i].borderBottomWidth, color);
    }
    return;
  }
  ui_draw_rect_outline(drawX, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h,
    __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, color);
}

static inline void ui_draw_node_outline(uint16_t i, int16_t drawX, int16_t drawY) {
  if (__ui_nodes[i].outlineStyle == 0 || __ui_nodes[i].outlineWidth == 0) return;
  uint8_t w = __ui_nodes[i].outlineWidth;
  ui_draw_rect_outline(drawX - w, drawY - w,
    __ui_nodes[i].box.w + 2 * w, __ui_nodes[i].box.h + 2 * w,
    __ui_nodes[i].borderRadius + w, __ui_nodes[i].outlineStyle, w, __ui_nodes[i].outlineColor);
}

static inline uint8_t ui_scroll_motion_active(uint8_t settlingOnActiveScreen) {
  if (__ui_scroll_node >= 0 && __ui_is_dragging) return 1;
  return settlingOnActiveScreen;
}

static inline uint8_t ui_keyframe_set_has_scroll_sensitive_geometry(uint8_t setIdx) {
  if (setIdx >= __ui_keyframe_set_count) return 0;
  const UIKeyframeSet* ks = &__ui_keyframe_sets[setIdx];
  for (uint8_t s = 0; s < ks->stopCount; s++) {
    if (ks->stops[s].props & (UI_KF_TRANSFORM | UI_KF_SIZE)) return 1;
  }
  return 0;
}

// Per-frame driver. The host async/loop pump calls this each tick (~16ms).
// Phase -2: poll touch (if configured). Phase -1: poll input pins.
// Phase 0: evaluate bindings. Phase 1: transitions. Phase 2: draw.
// Forward decl: the keyboard overlay is defined below but drawn at the end.
// (ui_kb_draw and ui_kb_handle_tap forward declarations are near the touch
// state machine, above.)
static inline void ui_tick(uint16_t deltaMs) {
  // Touch poll — runs if touch is configured (defined by the emit layer)
  ui_poll_touch();
  // ⓪' Poll GPIO inputs
  ui_poll_inputs();
#if defined(UI_HIDE_OSK)
  // Advance the caret blink phase for the active input (desktop target).
  __ui_kb_blink++;
  // Re-mark the edited input dirty every ~16 ticks so the blink repainting
  // keeps cycling even when no other state changes (otherwise the caret
  // freezes once the typed-text dirty clears).
  if (__ui_kb_visible && __ui_kb_target >= 0 && (__ui_kb_blink & 0x10)) {
    ui_mark_dirty((uint16_t)__ui_kb_target);
  }
#endif
  // ⓪ Evaluate bindings: call each binding's fn, compare to the node's
  // current property value, mark dirty if changed.
  for (uint16_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text binding: fill the node's buffer, compare content, mark dirty if changed.
      uint16_t n = __ui_bindings[i].node;
      char oldBuf[UI_TEXT_BUF + 1];
      strncpy(oldBuf, __ui_nodes[n].textBuffer, UI_TEXT_BUF);
      oldBuf[UI_TEXT_BUF] = '\0';
      __ui_bindings[i].textFn(__ui_nodes[n].textBuffer, UI_TEXT_BUF + 1);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF] = '\0';
      if (strcmp(oldBuf, __ui_nodes[n].textBuffer) != 0) {
        ui_invalidate_text_layout_cache(n);
        ui_mark_dirty(n);
      }
    } else if (__ui_bindings[i].fn) {
      // Color/numeric binding
      uint32_t newVal = __ui_bindings[i].fn();
      if (__ui_bindings[i].prop == PROP_VISIBLE) {
        uint8_t nextVisible = newVal ? 1 : 0;
        if (nextVisible != __ui_nodes[__ui_bindings[i].node].visible) {
          ui_set_visible(__ui_bindings[i].node, nextVisible);
        }
        continue;
      }
      if (__ui_bindings[i].prop == PROP_VALUE) {
        // Numeric value binding: drive a progress/range node's value live.
        uint16_t n = __ui_bindings[i].node;
        int16_t v = (int16_t)__ui_bindings[i].fn();
        if (v != __ui_nodes[n].value) {
          __ui_nodes[n].value = v;
          ui_mark_dirty(n);
        }
        continue;
      }
      uint32_t* target = (__ui_bindings[i].prop == PROP_BG) ? &__ui_nodes[__ui_bindings[i].node].bg
                    : (__ui_bindings[i].prop == PROP_FG) ? &__ui_nodes[__ui_bindings[i].node].fg
                    : (__ui_bindings[i].prop == PROP_BORDER_COLOR) ? &__ui_nodes[__ui_bindings[i].node].borderColor
                    : &__ui_nodes[__ui_bindings[i].node].bg;
      if (newVal != *target) {
        *target = newVal;
        // When a background binding writes a new color, ensure hasBg is set
        // so the draw dispatch actually fills (the node may have started
        // transparent but now has a runtime-assigned background).
        if (__ui_bindings[i].prop == PROP_BG) __ui_nodes[__ui_bindings[i].node].hasBg = 1;
        ui_mark_dirty(__ui_bindings[i].node);
      }
    }
  }
  // ⓪b Evaluate list bindings (on-node): refresh item count, recompute content
  // height, and advance any in-flight settle animation (bounce-back / edge-snap).
  // Also note whether any active-screen node is settling (feeds scroll-motion
  // gating below without a second full-node scan).
  uint8_t settlingOnActiveScreen = 0;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].virtualized && __ui_nodes[i].listCountFn) {
      uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
      uint16_t newCount = __ui_nodes[i].listCountFn();
      if (newCount != __ui_nodes[i].listCount) {
        __ui_nodes[i].listCount = newCount;
        __ui_nodes[i].contentHeight = (int16_t)((uint32_t)newCount * ih);
        __ui_nodes[i].lastPaintedScrollY = __ui_nodes[i].scrollY - (__ui_nodes[i].box.h > 0 ? __ui_nodes[i].box.h : 1);
        ui_mark_dirty(i);
      }
    }
    if (__ui_nodes[i].settling) {
      if (__ui_nodes[i].screenId == __ui_active_screen) settlingOnActiveScreen = 1;
      ui_scroll_advance_settle(i, deltaMs);
    }
  }
  // ⓪c Evaluate input bindings (two-way): if a bound <input>'s textBuffer
  // changed since last tick (e.g. the user typed via the on-screen keyboard),
  // fire the author's callback with the new text.
  for (uint16_t i = 0; i < __ui_input_binding_count; i++) {
    if (!__ui_input_bindings[i].cb) continue;
    uint16_t n = __ui_input_bindings[i].node;
    const char* cur = __ui_nodes[n].textBuffer;
    if (strcmp(cur, __ui_input_bindings[i].lastSeen) != 0) {
      strncpy(__ui_input_bindings[i].lastSeen, cur, UI_TEXT_BUF);
      __ui_input_bindings[i].lastSeen[UI_TEXT_BUF] = '\0';
      __ui_input_bindings[i].cb(cur);
    }
  }
  // ① Advance transitions.
  for (uint16_t i = 0; i < __ui_trans_count; i++) {
    if (!__ui_trans[i].active) continue;
    __ui_trans[i].elapsed += deltaMs;
    uint16_t k = __ui_trans[i].durationMs == 0
      ? 100
      : (uint16_t)((uint32_t)__ui_trans[i].elapsed * 100 / __ui_trans[i].durationMs);
    if (__ui_trans[i].durationMs > 0 && __ui_trans[i].durationMs <= UI_TRANSITION_SNAP_MS) k = 100;
    uint32_t v = UI_LERP_COLOR(__ui_trans[i].prevValue, __ui_trans[i].targetValue, (uint8_t)k);
    if (__ui_trans[i].prop == PROP_FG) {
      __ui_nodes[__ui_trans[i].node].fg = v;
    } else {
      __ui_nodes[__ui_trans[i].node].bg = v;
    }
    ui_mark_dirty(__ui_trans[i].node);
    if (k >= 100) __ui_trans[i].active = 0;
  }

  // ①b Advance @keyframes animations.
  uint8_t scrollMotionActive = ui_scroll_motion_active(settlingOnActiveScreen);
  for (uint16_t i = 0; i < __ui_anim_count; i++) {
    if (!__ui_anims[i].active) continue;
    // Skip animations on non-visible screens OR hidden subtrees — their nodes
    // are not drawn, so advancing them would paint stray fragments ("blotches")
    // on the active screen. The screenId check handles multi-screen nav; the
    // effective-visibility check handles master-detail panes (all on screen 0,
    // but only one pane is visible at a time — the rest have visible=0 set by
    // a ui.bind(..., 'visible', ...) binding). Without this, infinite animations
    // on a hidden pane (e.g. the transforms dots) keep ticking, marking their
    // nodes dirty, and repainting on top of the visible pane's content.
    {
      uint16_t animNode = __ui_anims[i].node;
      if (animNode >= __ui_node_count) continue;
      if (__ui_nodes[animNode].screenId != __ui_active_screen) continue;
      if (!ui_is_effectively_visible(animNode)) continue;
    }
    if (scrollMotionActive &&
        ui_keyframe_set_has_scroll_sensitive_geometry(__ui_anims[i].keyframeSet)) {
      continue;
    }
    __ui_anims[i].elapsed += (uint32_t)deltaMs;
    uint32_t elapsedNoDelay = __ui_anims[i].elapsed;
    if (elapsedNoDelay < __ui_anims[i].delayMs) continue;
    elapsedNoDelay -= __ui_anims[i].delayMs;
    // Check iteration limit (finite).
    uint8_t completing = 0;
    if (__ui_anims[i].iterations > 0) {
      uint32_t totalDuration = (uint32_t)__ui_anims[i].iterations * (uint32_t)__ui_anims[i].durationMs;
      if (elapsedNoDelay >= totalDuration) {
        elapsedNoDelay = totalDuration;
        completing = 1;
      }
    }
    // Compute cycle position: 0.0 - 1.0 within one loop.
    uint8_t pct = 100;
    if (!completing && __ui_anims[i].durationMs > 0) {
      uint32_t cycleMs = elapsedNoDelay % __ui_anims[i].durationMs;
      pct = (uint8_t)((uint32_t)cycleMs * 100 / __ui_anims[i].durationMs);
    }
    // Find surrounding keyframe stops.
    if (__ui_anims[i].keyframeSet >= __ui_keyframe_set_count) continue;
    const UIKeyframeSet* ks = &__ui_keyframe_sets[__ui_anims[i].keyframeSet];
    if (ks->stopCount == 0) continue;
    // Find the two stops that bracket pct.
    uint8_t lo = 0, hi = ks->stopCount - 1;
    for (uint8_t s = 0; s < ks->stopCount; s++) {
      if (ks->stops[s].percent <= pct) lo = s;
      if (ks->stops[s].percent >= pct) { hi = s; break; }
    }
    const UIKeyframeStop* sLo = &ks->stops[lo];
    const UIKeyframeStop* sHi = &ks->stops[hi];
    // Lerp factor between lo and hi.
    uint8_t range = sHi->percent - sLo->percent;
    uint8_t lerpK = range > 0 ? (uint8_t)((uint16_t)(pct - sLo->percent) * 100 / range) : 0;
    // Shape the lerp by the animation's timing function (ease-in-out, etc.).
    // CSS attaches it to the animation and applies it between stops.
    lerpK = ui_ease_lerp_k(__ui_anims[i].timingFunction, lerpK);
    // Apply to node — only mark dirty if a value actually changed.
    uint16_t n = __ui_anims[i].node;
    if (n >= __ui_node_count) continue;
    uint8_t changed = 0;
    if ((sLo->props & UI_KF_BG) && (sHi->props & UI_KF_BG)) {
      uint32_t newBg = range > 0 ? UI_LERP_COLOR(sLo->bg, sHi->bg, lerpK) : sLo->bg;
      if (newBg != __ui_nodes[n].bg) { __ui_nodes[n].bg = newBg; __ui_nodes[n].hasBg = 1; changed = 1; }
    }
    if ((sLo->props & UI_KF_FG) && (sHi->props & UI_KF_FG)) {
      uint32_t newFg = range > 0 ? UI_LERP_COLOR(sLo->fg, sHi->fg, lerpK) : sLo->fg;
      if (newFg != __ui_nodes[n].fg) { __ui_nodes[n].fg = newFg; changed = 1; }
    }
    if ((sLo->props & UI_KF_OPACITY) && (sHi->props & UI_KF_OPACITY)) {
      uint8_t newOp = range > 0
        ? (uint8_t)((int16_t)sLo->opacity + ((int16_t)sHi->opacity - (int16_t)sLo->opacity) * lerpK / 100)
        : sLo->opacity;
      if (newOp != __ui_nodes[n].opacity) { __ui_nodes[n].opacity = newOp; changed = 1; }
    }
    int16_t nextTransformX = __ui_nodes[n].transformOffsetX;
    int16_t nextTransformY = __ui_nodes[n].transformOffsetY;
    int16_t nextRotateDeg = __ui_nodes[n].rotateDeg;
    int16_t nextWidth = __ui_nodes[n].box.w;
    int16_t nextHeight = __ui_nodes[n].box.h;
    uint8_t geometryChanged = 0;
    uint8_t hasSizeFrame = (sLo->props & UI_KF_SIZE) && (sHi->props & UI_KF_SIZE);
    if (hasSizeFrame) {
      nextWidth = range > 0
        ? (int16_t)((int32_t)sLo->width + ((int32_t)sHi->width - (int32_t)sLo->width) * lerpK / 100)
        : sLo->width;
      nextHeight = range > 0
        ? (int16_t)((int32_t)sLo->height + ((int32_t)sHi->height - (int32_t)sLo->height) * lerpK / 100)
        : sLo->height;
      if (nextWidth < 0) nextWidth = 0;
      if (nextHeight < 0) nextHeight = 0;
      if (nextWidth != __ui_nodes[n].box.w || nextHeight != __ui_nodes[n].box.h) {
        changed = 1;
        geometryChanged = 1;
      }
    }
    if ((sLo->props & UI_KF_TRANSFORM) && (sHi->props & UI_KF_TRANSFORM)) {
      int16_t pxX = range > 0
        ? (int16_t)((int32_t)sLo->transformOffsetX + ((int32_t)sHi->transformOffsetX - (int32_t)sLo->transformOffsetX) * lerpK / 100)
        : sLo->transformOffsetX;
      int16_t pxY = range > 0
        ? (int16_t)((int32_t)sLo->transformOffsetY + ((int32_t)sHi->transformOffsetY - (int32_t)sLo->transformOffsetY) * lerpK / 100)
        : sLo->transformOffsetY;
      int16_t pctX = range > 0
        ? (int16_t)((int32_t)sLo->translatePctX + ((int32_t)sHi->translatePctX - (int32_t)sLo->translatePctX) * lerpK / 100)
        : sLo->translatePctX;
      int16_t pctY = range > 0
        ? (int16_t)((int32_t)sLo->translatePctY + ((int32_t)sHi->translatePctY - (int32_t)sLo->translatePctY) * lerpK / 100)
        : sLo->translatePctY;
      int16_t scaleX = range > 0
        ? (int16_t)((int32_t)sLo->scaleX + ((int32_t)sHi->scaleX - (int32_t)sLo->scaleX) * lerpK / 100)
        : sLo->scaleX;
      int16_t scaleY = range > 0
        ? (int16_t)((int32_t)sLo->scaleY + ((int32_t)sHi->scaleY - (int32_t)sLo->scaleY) * lerpK / 100)
        : sLo->scaleY;
      nextRotateDeg = range > 0
        ? (int16_t)((int32_t)sLo->rotateDeg + ((int32_t)sHi->rotateDeg - (int32_t)sLo->rotateDeg) * lerpK / 100)
        : sLo->rotateDeg;
      if (scaleX < 0) scaleX = 0;
      if (scaleY < 0) scaleY = 0;
      int16_t refW = hasSizeFrame ? nextWidth : __ui_anims[i].baseWidth;
      int16_t refH = hasSizeFrame ? nextHeight : __ui_anims[i].baseHeight;
      if (refW <= 0) refW = __ui_nodes[n].box.w;
      if (refH <= 0) refH = __ui_nodes[n].box.h;
      int16_t originPxX = (int16_t)((int32_t)refW * __ui_anims[i].originX / 100);
      int16_t originPxY = (int16_t)((int32_t)refH * __ui_anims[i].originY / 100);
      int16_t scaledW = (int16_t)((int32_t)refW * scaleX / 100);
      int16_t scaledH = (int16_t)((int32_t)refH * scaleY / 100);
      int16_t scaleOffsetX = originPxX - (int16_t)((int32_t)originPxX * scaleX / 100);
      int16_t scaleOffsetY = originPxY - (int16_t)((int32_t)originPxY * scaleY / 100);
      nextTransformX = pxX + (int16_t)((int32_t)refW * pctX / 100) + scaleOffsetX;
      nextTransformY = pxY + (int16_t)((int32_t)refH * pctY / 100) + scaleOffsetY;
      nextWidth = scaledW < 0 ? 0 : scaledW;
      nextHeight = scaledH < 0 ? 0 : scaledH;
      if (nextTransformX != __ui_nodes[n].transformOffsetX ||
          nextTransformY != __ui_nodes[n].transformOffsetY ||
          nextRotateDeg != __ui_nodes[n].rotateDeg ||
          nextWidth != __ui_nodes[n].box.w ||
          nextHeight != __ui_nodes[n].box.h) {
        changed = 1;
        geometryChanged = 1;
      }
    }
    if (changed) {
      // Throttle color/opacity-only redraws to ~10fps to avoid ILI9341 tearing
      // from rapid SPI writes (ada49b4). Spatial transforms (translate/scale/
      // rotate/size) are exempt: at 10fps a small dot moving a few px reads as
      // a jump, and the redraw is only the node's own tiny footprint, so the
      // tearing risk that motivated the gate doesn't apply. Geometry redraws
      // every frame a value actually changes (the 'changed' guard above still
      // suppresses no-op repaints).
      uint8_t throttleRedraw = !geometryChanged &&
        !(completing || __ui_anims[i].elapsed - __ui_anims[i].lastUpdateMs >= 100);
      if (!throttleRedraw) {
        UIRect oldGeometryRect = {0, 0, 0, 0};
        uint8_t hasOldGeometryRect = 0;
        if (geometryChanged) {
          ui_node_current_paint_rect(n, &oldGeometryRect);
          hasOldGeometryRect = oldGeometryRect.w > 0 && oldGeometryRect.h > 0;
          __ui_nodes[n].transformOffsetX = nextTransformX;
          __ui_nodes[n].transformOffsetY = nextTransformY;
          __ui_nodes[n].rotateDeg = nextRotateDeg;
          __ui_nodes[n].box.w = nextWidth;
          __ui_nodes[n].box.h = nextHeight;
          ui_invalidate_text_layout_cache(n);
        }
        uint8_t repairedGeometry = 0;
        if (geometryChanged && hasOldGeometryRect) {
          // Small moving solid fills can be repaired as one old+new union
          // bitmap. This avoids the visible erase-then-redraw blink that shows
          // up when transform animations run at full frame rate on SPI TFTs.
          repairedGeometry = ui_try_repair_geometry_fill(n, &oldGeometryRect);
        }
        if (geometryChanged && !repairedGeometry) {
          // Fallback: preserve the old behavior, but clear the captured OLD
          // footprint after the node fields have been updated.
          if (hasOldGeometryRect) ui_clear_node_paint_rect(n, &oldGeometryRect);
          else ui_clear_current_node_paint(n);
          ui_invalidate_scroll_canvas_for_node(n);
        }
        if (!repairedGeometry) ui_mark_dirty(n);
        __ui_anims[i].lastUpdateMs = __ui_anims[i].elapsed;
      }
    }
    if (completing) __ui_anims[i].active = 0;
  }

  // ② Draw dirty nodes directly to the display object.
  // Begin a deferred-refresh frame: resets the dirty-rect accumulator. On TFT
  // (no backing store) this compiles to a no-op.
  ui_refresh_begin_frame();
  // Skip the node draw pass while the keyboard overlay is visible — its opaque
  // background covers everything underneath, so redrawing app nodes wastes SPI
  // bandwidth and causes flashing. Nodes redraw once when the keyboard closes
  // (ui_kb_close marks the edited input dirty; ui_kb_open had marked all dirty
  // on open so they're stale-but-covered while the keyboard is up).
  //
  // UI_HIDE_OSK (desktop SDL): the editing session still runs (buffer, target,
  // commit-on-close) so real-keyboard typing works, but the 6×4 grid isn't drawn
  // and the node pass ISN'T skipped — the app keeps rendering normally with the
  // edited input's textBuffer showing the typed text. The grid is redundant when
  // the host has a real keyboard.
#if !defined(UI_HIDE_OSK)
  if (__ui_kb_visible) {
    // Redraw only what changed:
    //   1 = full redraw (open, shift toggle, page swap)
    //   2 = text row + single key (char insert, delete, highlight change)
    if (__ui_kb_dirty == 1) {
      ui_kb_draw();
    } else if (__ui_kb_dirty == 2) {
      ui_kb_draw_text_row();
      if (__ui_kb_repaint_key >= 0 && __ui_kb_keys[__ui_kb_repaint_key].special != 255) {
        ui_kb_draw_key((uint8_t)__ui_kb_repaint_key);
      }
    }
    __ui_kb_dirty = 0;
    __ui_kb_repaint_key = -1;
    return;
  }
#endif
  // Process each dirty scroll container (Mode B shift-and-repair). A scroll
  // delta shifts existing canvas pixels by the delta and repaints only the
  // newly-exposed strip; a full invalidation (or no canvas) redraws the subtree.
  // One container per frame — the active scroll owner repaints via its canvas.
  int16_t bufferedScrollNode = -1;  // int16: node index can exceed 127
  int16_t bufferedScrollVX = 0;  // viewport origin X for coord translation
  int16_t bufferedScrollVY = 0;  // viewport origin Y
  CuttlefishCanvas16* bufferedScrollCanvas = nullptr;
  CuttlefishCanvas16* bufferedScrollRepaintCanvas = nullptr;
  int16_t bufferedScrollRepaintY = 0;
  int16_t bufferedScrollRepaintH = 0;
  uint8_t bufferedScrollDirectStrip = 0;
  for (uint16_t oi = 0; ; oi++) {
    uint16_t s;
    if (__ui_scroll_owners) {
      if (oi >= __ui_scroll_owner_count) break;
      s = __ui_scroll_owners[oi];
    } else {
      if (oi >= __ui_node_count) break;
      s = oi;
      if (!__ui_nodes[s].scrollable || __ui_nodes[s].virtualized) continue;
    }
    if (!ui_is_effectively_visible(s)) continue;
    if (__ui_nodes[s].screenId != __ui_active_screen) continue;
    if (__ui_nodes[s].contentHeight <= __ui_nodes[s].box.h) continue;
    if (!__ui_nodes[s].dirty) continue;

    int16_t vw = __ui_nodes[s].box.w;
    int16_t vh = __ui_nodes[s].box.h;
    int16_t vox = __ui_nodes[s].box.x;
    int16_t voy = __ui_nodes[s].box.y;
    UI_COLOR_T scrollBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
    bufferedScrollCanvas = ui_get_container_canvas(vw, vh);
    // Track canvas-allocation success so ui_apply_scroll_delta can lock scrolling
    // for containers whose canvas won't fit (frozen-but-not-torn contract).
    if (__ui_scroll_canvas_ok) {
      __ui_scroll_canvas_ok[s] = bufferedScrollCanvas ? 1 : 0;
    }
    if (bufferedScrollCanvas) {
      bufferedScrollNode = (int16_t)s;
      bufferedScrollVX = vox;
      bufferedScrollVY = voy;

      // Mode B: shift delta = how far scrollY moved since this canvas was last
      // painted. Small non-zero delta within one viewport → shift + repair strip.
      int16_t deltaY = __ui_nodes[s].scrollY - __ui_nodes[s].lastPaintedScrollY;
      int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
      uint8_t canShift = (deltaY != 0 && absDelta < vh);

      if (canShift) {
        int16_t exposedY = 0;
        int16_t exposedH = 0;
        ui_shift_container_canvas(bufferedScrollCanvas, deltaY, scrollBg, &exposedY, &exposedH);
        bufferedScrollRepaintCanvas = ui_get_repair_canvas(vw, exposedH);
        if (bufferedScrollRepaintCanvas) {
          bufferedScrollRepaintY = exposedY;
          bufferedScrollRepaintH = exposedH;
          display_canvasFillScreen(bufferedScrollRepaintCanvas, scrollBg);
          UIRect exposed = { vox, (int16_t)(voy + exposedY), vw, exposedH };
          for (uint16_t c = s + 1; c < __ui_nodes[s].subtreeEnd; c++) {
            if (!ui_is_effectively_visible(c) || __ui_nodes[c].screenId != __ui_active_screen) {
              __ui_nodes[c].dirty = 0;
              continue;
            }
            if (!__ui_nodes[c].dirty && exposedH > 0) {
              UIRect cr;
              ui_node_current_paint_rect(c, &cr);
              if (cr.w > 0 && cr.h > 0 &&
                  ui_rects_intersect(cr.x, cr.y, cr.w, cr.h, exposed.x, exposed.y, exposed.w, exposed.h)) {
                __ui_nodes[c].dirty = 1;
              }
            }
            if (__ui_nodes[c].dirty) {
              if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
              else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
              __ui_nodes[c].lastTextHeight = 0;
            }
          }
        } else {
          canShift = 0;
        }
      }
      if (!canShift) {
        for (uint16_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
          __ui_nodes[c].dirty = 1;
          if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
          else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
          __ui_nodes[c].lastTextHeight = 0;
        }
        display_canvasFillScreen(bufferedScrollCanvas, scrollBg);
      }
      // The scroll owner is represented by bufferedScrollCanvas this frame.
      // Drawing it directly first clears the live display and makes scrolling
      // visibly flash before the canvas is pushed.
      __ui_nodes[s].dirty = 0;
    } else {
      // Canvas won't fit. Mode C strip-only for small in-viewport deltas; otherwise
      // graceful skip (keep last frame, retry next tick). Never direct-draw a full
      // scroll subtree to the display — that clears the live viewport and flashes.
      int16_t deltaY = __ui_nodes[s].scrollY - __ui_nodes[s].lastPaintedScrollY;
      int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
      uint32_t scrollNeed = (uint32_t)(vw > 0 ? vw : 0) * (uint32_t)(vh > 0 ? vh : 0) * 2u;
      if (absDelta > 0 && absDelta < vh) {
        bufferedScrollNode = (int16_t)s;
        bufferedScrollDirectStrip = 1;
        ui_warn_scroll_memory((uint16_t)s, 2);
        ui_scroll_direct_prepare(s, &bufferedScrollVX, &bufferedScrollVY);
        break;
      }
      ui_warn_scroll_memory((uint16_t)s, scrollNeed > (uint32_t)UI_SCROLL_CANVAS_BUDGET_BYTES ? 1 : 0);
      if (__ui_scroll_canvas_ok) __ui_scroll_canvas_ok[s] = 0;
      continue;
    }
    // Only one scroll container per frame (the canvas is reused for subsequent
    // ones in the next dirty frame). This matches the original design.
    break;
  }
  // ── Framebuffer target selection ──────────────────────────────────────────
  // When a full-screen framebuffer is available (ESP32 + PSRAM), redirect the
  // entire dirty-node draw pass into it and push once at the end. Otherwise
  // __ui_draw_target == display_defaultTarget() and draws go straight to the display
  // (byte-identical to the pre-framebuffer path).
  CuttlefishCanvas16* __ui_fb = ui_get_framebuffer();
  CuttlefishDisplayTarget* __ui_draw_target = __ui_fb ? (CuttlefishDisplayTarget*)__ui_fb : display_defaultTarget();
  if (__ui_fb) {
    // Seed the framebuffer with the active screen's background so cleared/
    // transparent regions resolve correctly, then draw dirty nodes on top.
    uint16_t fbBg = 0x0000;
    if (__ui_active_screen_bg_node < __ui_node_count) {
      fbBg = __ui_nodes[__ui_active_screen_bg_node].hasBg
        ? __ui_nodes[__ui_active_screen_bg_node].bg
        : __ui_nodes[__ui_active_screen_bg_node].clearColor;
    }
    display_canvasFillScreen(__ui_fb, fbBg);
  }

  // Draw dirty nodes in stacking order: lower z-index first, then source order.
  // __ui_draw_order is built once in ui_init so each frame is O(N).
  for (uint16_t __ui_draw_pass = 0; __ui_draw_pass < __ui_node_count; ) {
    int16_t i;
    if (__ui_draw_order) {
      i = (int16_t)__ui_draw_order[__ui_draw_pass++];
      if (!__ui_nodes[i].dirty) continue;
      if (!ui_is_effectively_visible(i)) { __ui_nodes[i].dirty = 0; continue; }
      if (__ui_nodes[i].screenId != __ui_active_screen) { __ui_nodes[i].dirty = 0; continue; }
    } else {
      // malloc failed at startup: preserve correct z-order via selection sort.
      i = -1;
      for (uint16_t candidate = 0; candidate < __ui_node_count; candidate++) {
        if (!__ui_nodes[candidate].dirty) continue;
        if (!ui_is_effectively_visible(candidate)) { __ui_nodes[candidate].dirty = 0; continue; }
        if (__ui_nodes[candidate].screenId != __ui_active_screen) { __ui_nodes[candidate].dirty = 0; continue; }
        if (i < 0 || ui_node_draws_before(candidate, (uint16_t)i)) i = (int16_t)candidate;
      }
      if (i < 0) break;
      __ui_draw_pass++;
    }

    // Defer direct display draws for overflow scroll subtrees not composited this
    // frame (Mode B canvas or Mode C strip). Drawing them directly clears the live
    // viewport and produces sequential flashes (AGENTS.md).
    {
      int16_t scrollComp = ui_overflow_scroll_compositor((uint16_t)i);
      if (scrollComp >= 0) {
        uint8_t compositing = scrollComp == bufferedScrollNode &&
          (bufferedScrollCanvas || bufferedScrollDirectStrip);
        if (!compositing) {
          if ((uint16_t)i == (uint16_t)scrollComp) break;
          __ui_nodes[i].dirty = 0;
          continue;
        }
      }
    }

    // Mode C strip: scroll owner is not drawn directly (would fill the viewport).
    if (bufferedScrollDirectStrip && bufferedScrollNode >= 0 &&
        (uint16_t)i == (uint16_t)bufferedScrollNode) {
      __ui_nodes[i].dirty = 0;
      continue;
    }

    if (bufferedScrollNode >= 0 && bufferedScrollCanvas &&
        !(i > bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd) &&
        ui_node_draws_before((uint16_t)bufferedScrollNode, (uint16_t)i) &&
        !ui_scroll_subtree_has_dirty((uint16_t)bufferedScrollNode)) {
      ui_push_buffered_scroll_canvas(bufferedScrollCanvas, bufferedScrollRepaintCanvas,
        bufferedScrollNode, bufferedScrollVX, bufferedScrollVY,
        bufferedScrollRepaintY, bufferedScrollRepaintH, __ui_draw_target);
      bufferedScrollNode = -1;
      bufferedScrollCanvas = nullptr;
      bufferedScrollRepaintCanvas = nullptr;
    }

    // Redirect to the scroll canvas if this node is inside the buffered container.
    uint8_t drawingBufferedScroll = bufferedScrollNode >= 0 && i > bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd;
    int16_t origBoxX = __ui_nodes[i].box.x;
    int16_t origBoxY = __ui_nodes[i].box.y;
    if (drawingBufferedScroll) {
      CuttlefishCanvas16* scrollDrawCanvas = bufferedScrollRepaintCanvas ? bufferedScrollRepaintCanvas : bufferedScrollCanvas;
      ui_display_set_target(scrollDrawCanvas);
      // Translate display coords → canvas-local coords (subtract viewport origin).
      __ui_nodes[i].box.x = origBoxX - bufferedScrollVX;
      __ui_nodes[i].box.y = origBoxY - bufferedScrollVY - (bufferedScrollRepaintCanvas ? bufferedScrollRepaintY : 0);
    } else {
      ui_display_set_target(__ui_draw_target);
    }
    int16_t baseDrawX = ui_base_draw_x_for_node(i);
    int16_t baseDrawY = ui_base_draw_y_for_node(i);
    int16_t drawX = ui_draw_x_for_node(i);
    int16_t drawY = ui_draw_y_for_node(i);
    // Source selection: text-bound nodes show their dynamic buffer; others show
    // the immutable flash literal.
    const char* displayText = __ui_nodes[i].hasTextBinding
      ? __ui_nodes[i].textBuffer
      : __ui_nodes[i].text;
    uint8_t ts = __ui_nodes[i].textSize ? __ui_nodes[i].textSize : 2;
    uint16_t textMaxW = ui_node_text_max_width(i);
    uint16_t tw = 0;
    uint16_t th = 0;
    ui_node_text_layout_metrics(i, textMaxW, &tw, &th);
    uint16_t paintTextW = tw;
    uint16_t paintTextH = th;
    if (__ui_nodes[i].kind == NODE_TEXT) {
      uint16_t hInset = (uint16_t)__ui_nodes[i].paddingLeft + (uint16_t)__ui_nodes[i].paddingRight + (uint16_t)__ui_nodes[i].borderWidth * 2;
      uint16_t vInset = (uint16_t)__ui_nodes[i].paddingTop + (uint16_t)__ui_nodes[i].paddingBottom + (uint16_t)__ui_nodes[i].borderWidth * 2;
      paintTextW = (uint16_t)(tw + hInset);
      paintTextH = (uint16_t)(th + vInset);
    }
    if (__ui_nodes[i].kind == NODE_CHECK || __ui_nodes[i].kind == NODE_RADIO) {
      paintTextW = tw + 22;
      if (paintTextH < 16) paintTextH = 16;
    }

    UIRect paintRect;
    ui_node_paint_rect(i, baseDrawX, baseDrawY, drawX, drawY, paintTextW, paintTextH, &paintRect);
    int16_t cullX = paintRect.x;
    int16_t cullY = paintRect.y;
    int16_t cullW = paintRect.w;
    int16_t cullH = paintRect.h;
    if (drawingBufferedScroll) {
      // Canvas-local clip: skip nodes fully outside the viewport (0..vw, 0..vh).
      // Use the node's face rect (box.w/h), NOT the paint rect — the paint rect
      // includes shadow/border extents, which legitimately overflow a scroll
      // viewport. Clipping on the paint rect falsely rejects nodes whose shadow
      // pokes past the container edge while the face is fully inside (showed up
      // as the home-nav buttons never painting on ST7796S, where the nav
      // container is exactly button-width).
      int16_t faceX = drawX;
      int16_t faceY = drawY;
      int16_t faceW = __ui_nodes[i].box.w;
      int16_t faceH = __ui_nodes[i].box.h;
      CuttlefishCanvas16* scrollDrawCanvas = bufferedScrollRepaintCanvas ? bufferedScrollRepaintCanvas : bufferedScrollCanvas;
      int16_t scrollDrawW = display_canvasWidth(scrollDrawCanvas);
      int16_t scrollDrawH = display_canvasHeight(scrollDrawCanvas);
      if (bufferedScrollRepaintCanvas) {
        scrollDrawW = __ui_nodes[bufferedScrollNode].box.w;
        scrollDrawH = bufferedScrollRepaintH;
      }
      if (faceY + faceH <= 0 || faceY >= scrollDrawH ||
          faceX + faceW <= 0 || faceX >= scrollDrawW) {
        __ui_nodes[i].box.x = origBoxX;
        __ui_nodes[i].box.y = origBoxY;
        __ui_nodes[i].dirty = 0;
        continue;
      }
    } else if (ui_is_rect_clipped_by_scroll(i, drawX, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h)) {
      __ui_nodes[i].box.x = origBoxX;
      __ui_nodes[i].box.y = origBoxY;
      __ui_nodes[i].dirty = 0;
      continue;
    }

    uint8_t drawingPaintCanvas = 0;
    CuttlefishCanvas16* paintCanvas = nullptr;
    int16_t paintCanvasX = paintRect.x;
    int16_t paintCanvasY = paintRect.y;
    int16_t paintCanvasW = paintRect.w;
    int16_t paintCanvasH = paintRect.h;
    // RAM-composite pixel-heavy nodes before SPI push. Skip when already drawing
    // into a scroll canvas or a full-screen framebuffer (both are RAM targets).
    if (!drawingBufferedScroll && !__ui_fb && ui_should_buffer_paint(i, paintCanvasW, paintCanvasH)) {
      paintCanvas = ui_get_repair_canvas(paintCanvasW, paintCanvasH);
      if (paintCanvas) {
        drawingPaintCanvas = 1;
        ui_display_set_target(paintCanvas);
        ui_seed_paint_canvas_for_node(i, paintCanvas, paintCanvasX, paintCanvasY);
        baseDrawX -= paintCanvasX;
        baseDrawY -= paintCanvasY;
        drawX -= paintCanvasX;
        drawY -= paintCanvasY;
        if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) {
          __ui_nodes[i].lastTextWidth = -1;
        }
      }
    }
    if (!drawingPaintCanvas) {
      ui_clear_press_offset_area(i, baseDrawX, baseDrawY, drawX, drawY, paintTextW, paintTextH);
    }
    uint8_t skipListOutsetShadow =
      (__ui_nodes[i].kind == NODE_LIST && !drawingBufferedScroll && !__ui_fb);
    if (!skipListOutsetShadow) {
      __ui_nodes[i].box.x = baseDrawX;
      ui_draw_shadow(i, baseDrawY, 0);
      __ui_nodes[i].box.x = drawX;
    } else {
      __ui_nodes[i].box.x = drawX;
    }

    // Border color: use borderColor if set, otherwise fg.
    UI_COLOR_T bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
    // Background color blended toward clearColor by opacity (raw bg when 100%).
    // NODE_FILL draws the fill at this color so opacity actually fades the
    // element's background toward what's behind it.
    UI_COLOR_T fillBg = __ui_nodes[i].bg;
    // Apply opacity: blend fg/bg/border toward what's BEHIND the node when <100%.
    // NOTE: blend toward the parent's clear color (ui_parent_clear_color), not
    // the node's own clearColor — a filled node's clearColor IS its own bg, so
    // blending bg toward it is a no-op (red toward red = red). The parent clear
    // is the actual backdrop showing through the translucent element.
    if (__ui_nodes[i].opacity < 100) {
      UI_COLOR_T backdrop = ui_parent_clear_color(i);
      bColor = ui_blend(bColor, backdrop, __ui_nodes[i].opacity);
      fillBg = ui_blend(__ui_nodes[i].bg, backdrop, __ui_nodes[i].opacity);
    }
    switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        if (__ui_nodes[i].gradientEnabled > 0) {
          ui_draw_gradient_fill(i, drawY);
        } else if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, __ui_nodes[i].borderRadius, fillBg);
        } else if (__ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, fillBg);
        }
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          UI_COLOR_T bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          int16_t borderW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t borderH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_draw_rect_outline(__ui_nodes[i].box.x, drawY, borderW, borderH,
            __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, bColor);
        }
        break;
      case NODE_TEXT:
        {
          int16_t insetL = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingLeft;
          int16_t insetR = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingRight;
          int16_t insetT = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingTop;
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          int16_t textW = (int16_t)__ui_nodes[i].box.w - insetL - insetR;
          if (textW < 1) textW = 1;
          uint8_t textBoxPainted = 0;
          if (__ui_nodes[i].gradientEnabled > 0) {
            ui_draw_gradient_fill(i, drawY);
            textBoxPainted = 1;
          } else if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg) {
            ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY,
              __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, fillBg);
            textBoxPainted = 1;
          } else if (__ui_nodes[i].hasBg) {
            ui_display_fill_rect(__ui_nodes[i].box.x, drawY,
              __ui_nodes[i].box.w, __ui_nodes[i].box.h, fillBg);
            textBoxPainted = 1;
          }
          {
            uint16_t clearW = __ui_nodes[i].box.w;
            int16_t paintedTextW = (int16_t)__ui_nodes[i].lastTextWidth + insetL + insetR;
            if (__ui_nodes[i].lastTextWidth > 0 && paintedTextW > (int16_t)clearW) {
              clearW = (uint16_t)paintedTextW;
            }
            uint16_t paddedTw = (uint16_t)((int16_t)tw + insetL + insetR);
            if (paddedTw > clearW) clearW = paddedTw;
            // overflow:hidden/scroll: never clear past the node's own box. A nowrap
            // line wider than its box would otherwise erase the parent's border.
            if (__ui_nodes[i].scrollable) clearW = __ui_nodes[i].box.w;
            uint16_t clearH = __ui_nodes[i].box.h;
            int16_t paintedTextH = (int16_t)__ui_nodes[i].lastTextHeight + insetT + (int16_t)__ui_nodes[i].paddingBottom + (int16_t)__ui_nodes[i].borderWidth;
            if (__ui_nodes[i].lastTextHeight > 0 && paintedTextH > (int16_t)clearH) {
              clearH = (uint16_t)paintedTextH;
            }
            uint16_t paddedTh = (uint16_t)((int16_t)th + insetT + (int16_t)__ui_nodes[i].paddingBottom + (int16_t)__ui_nodes[i].borderWidth);
            if (paddedTh > clearH) clearH = paddedTh;
            // Dynamic transparent text still needs a clear, otherwise old glyph
            // pixels accumulate when only this text node is dirty.
            UI_COLOR_T clearCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            // Blend the clear toward the backdrop by opacity so a translucent text
            // node (inherited from an opacity:<1 parent) doesn't repaint a solid
            // block of its parent's fill around the glyphs.
            if (__ui_nodes[i].opacity < 100) {
              clearCol = ui_blend(clearCol, ui_parent_clear_color(i), __ui_nodes[i].opacity);
            }
            if (!textBoxPainted) {
              ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH, clearCol);
            }
            __ui_nodes[i].lastTextWidth = tw;
            __ui_nodes[i].lastTextHeight = th;
          }
          ui_draw_shadow(i, drawY, 1);
          if (__ui_nodes[i].borderStyle != 0) {
            ui_draw_node_border(i, __ui_nodes[i].box.x, drawY, bColor);
          }
          // Rich-text (inline runs): draw from precomputed geometry instead of the
          // single-string wrapped path. Geometry is baked at transpile time; the
          // runtime does not re-wrap.
          if (__ui_nodes[i].runCount > 0) {
          UI_COLOR_T richTextBg;
          if (__ui_nodes[i].opacity < 100) {
            uint16_t p = __ui_nodes[i].parent;
            UI_COLOR_T source = (p != UI_NO_PARENT && __ui_nodes[p].hasBg) ? __ui_nodes[p].bg
                          : (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
            richTextBg = ui_blend(source, __ui_nodes[i].clearColor, __ui_nodes[i].opacity);
          } else {
            richTextBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : ui_parent_clear_color(i);
          }
          if (__ui_nodes[i].textShadowCount > 0) {
            UI_COLOR_T tsClear = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            uint32_t tsCol = ui_blend(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
            // Shadow pass: draw the rich block in the shadow color at the offset.
            // (Per-segment shadow color is approximated by drawing the whole
            // block once in tsCol.)
            ui_draw_rich_text(i,
              textX + __ui_nodes[i].textShadowOffsetX,
              textY + __ui_nodes[i].textShadowOffsetY,
              tsClear, __ui_nodes[i].fontAntialias, 1, tsCol, (uint16_t)textW);
          }
          ui_draw_rich_text(i, textX, textY, richTextBg, __ui_nodes[i].fontAntialias, 0, 0, (uint16_t)textW);
          break;
        }
        {
          // Text shadow: draw the text in the shadow color at the offset first.
          UI_COLOR_T tsClear = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          if (__ui_nodes[i].textShadowCount > 0) {
            uint32_t tsCol = ui_blend(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
            ui_draw_wrapped_text(displayText,
              textX + __ui_nodes[i].textShadowOffsetX,
              textY + __ui_nodes[i].textShadowOffsetY,
              (uint16_t)textW, tsCol, tsCol, ts, __ui_nodes[i].fontAntialias,
              __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight,
              __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, 0, __ui_nodes[i].textOverflow);
          }
          // Use the parent's clear color as the text background when the node
          // has no own background. This makes Adafruit_GFX's opaque glyph-cell
          // fill blend with the parent (instead of drawing solid fg blocks that
          // overlap adjacent lines/elements). For AA text, fg != bg so the
          // edge-detection path still runs correctly.
          // Glyph-cell background. For a translucent text node sitting on a
          // filled translucent parent, the glyph cells must match the parent's
          // blended fill: blend565(parent.bg, backdrop, opacity). The node's own
          // clearColor carries the backdrop (set by flatten), and opacity has
          // already inherited from the parent. Use the parent's raw bg as the
          // source so the glyph cells reproduce the parent's translucent fill.
          UI_COLOR_T textBg;
          if (__ui_nodes[i].opacity < 100) {
            uint16_t p = __ui_nodes[i].parent;
            UI_COLOR_T source = (p != UI_NO_PARENT && __ui_nodes[p].hasBg) ? __ui_nodes[p].bg
                          : (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
            textBg = ui_blend(source, __ui_nodes[i].clearColor, __ui_nodes[i].opacity);
          } else {
            textBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : ui_parent_clear_color(i);
          }
          ui_draw_wrapped_text(displayText, textX, textY, (uint16_t)textW,
            __ui_nodes[i].fg, textBg, ts, __ui_nodes[i].fontAntialias,
            __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight,
            __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
          }
        }
        break;
      case NODE_BUTTON:
        if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg)
          ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, __ui_nodes[i].bg);
        else if (__ui_nodes[i].hasBg)
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          ui_draw_node_border(i, __ui_nodes[i].box.x, drawY, bColor);
        }
        {
          int16_t insetL = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingLeft;
          int16_t insetR = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingRight;
          int16_t insetT = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingTop;
          int16_t insetB = (int16_t)__ui_nodes[i].borderWidth + (int16_t)__ui_nodes[i].paddingBottom;
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          int16_t textW = (int16_t)__ui_nodes[i].box.w - insetL - insetR;
          int16_t textH = (int16_t)__ui_nodes[i].box.h - insetT - insetB;
          if (textW < 1) textW = 1;
          if (textH < 1) textH = (int16_t)th;
          ui_draw_wrapped_text(displayText,
            textX,
            textY + (textH - (int16_t)th) / 2,
            (uint16_t)textW,
            __ui_nodes[i].fg,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
            ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
            __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        }
        break;
      case NODE_CHECK:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > (int16_t)clearH) {
            clearH = (uint16_t)__ui_nodes[i].lastTextHeight;
          }
          if (paintTextH > clearH) clearH = paintTextH;
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = paintTextW;
          __ui_nodes[i].lastTextHeight = paintTextH;
        }
        {
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
          if (__ui_nodes[i].value) {
            ui_display_fill_rect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
            UI_COLOR_T inv = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
#ifdef UI_AA
            {
              // Draw the checkmark to a 16×16 AA canvas for smooth diagonals.
              CuttlefishCanvas16* c = ui_aa_begin(16, 16, __ui_nodes[i].fg);
              // First stroke: down-left (3,8 → 7,12)
              ui_aa_line(c, 4.0f, 8.0f, 7.0f, 12.0f, inv);
              ui_aa_line(c, 5.0f, 8.0f, 8.0f, 12.0f, inv);
              // Second stroke: up-right (7,11 → 13,4)
              ui_aa_line(c, 7.0f, 11.0f, 13.0f, 4.0f, inv);
              ui_aa_line(c, 8.0f, 11.0f, 14.0f, 4.0f, inv);
              ui_aa_push(c, cbX, cbY);
            }
#else
            ui_display_draw_line(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
            ui_display_draw_line(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
            ui_display_draw_line(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
            ui_display_draw_line(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
            ui_display_draw_line(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
            ui_display_draw_line(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
#endif
          } else {
            ui_display_draw_rect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
          }
        }
        ui_draw_wrapped_text(displayText, __ui_nodes[i].box.x + 22, drawY, textMaxW,
          __ui_nodes[i].fg, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
          ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
          __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, 0, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        break;
      case NODE_RADIO:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > (int16_t)clearH) {
            clearH = (uint16_t)__ui_nodes[i].lastTextHeight;
          }
          if (paintTextH > clearH) clearH = paintTextH;
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = paintTextW;
          __ui_nodes[i].lastTextHeight = paintTextH;
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
#ifdef UI_AA
          {
            // Render the radio circle to a 16×16 AA canvas, then push.
            UI_COLOR_T radioBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            CuttlefishCanvas16* c = ui_aa_begin(16, 16, radioBg);
            if (__ui_nodes[i].value) {
              ui_aa_fill_circle(c, 8, 8, 7.0f, __ui_nodes[i].fg);
              ui_aa_fill_circle(c, 8, 8, 3.0f, radioBg);
            } else {
              ui_aa_circle(c, 8, 8, 7.0f, __ui_nodes[i].fg);
            }
            ui_aa_push(c, cbX, cbY);
          }
#else
          if (__ui_nodes[i].value) {
            ui_display_fill_circle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
            ui_display_fill_circle(cbX + 8, cbY + 8, 3, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          } else {
            ui_display_draw_circle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
          }
#endif
        }
        ui_draw_wrapped_text(displayText, __ui_nodes[i].box.x + 22, drawY, textMaxW,
          __ui_nodes[i].fg, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
          ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
          __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, 0, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        break;
      case NODE_PROGRESS:
        // Progress bar: outline track + filled portion based on .value (0-100).
        // Incremental redraw — only draws/clears the delta to avoid flashing.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          UI_COLOR_T bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          UI_COLOR_T fgCol = __ui_nodes[i].fg;

          // On first draw (lastTextWidth < 0), draw everything.
          // Otherwise incremental: only update the changed portion.
          uint8_t pct = constrain(__ui_nodes[i].value, 0, 100);
          int16_t fillW = ((int32_t)(bw - 2) * pct) / 100;
          int16_t prevW = __ui_nodes[i].lastTextWidth; // reused as previous fill width

          if (prevW < 0) {
            // Full redraw: outline + background + fill
            ui_display_draw_rect(bx, by, bw, bh, fgCol);
            ui_display_fill_rect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
            if (fillW > 0) {
              ui_display_fill_rect(bx + 1, by + 1, fillW, bh - 2, fgCol);
            }
          } else if (fillW > prevW) {
            // Value increased: draw new fill segment on top (no clear needed)
            ui_display_fill_rect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
          } else if (fillW < prevW) {
            // Value decreased: clear the removed portion
            ui_display_fill_rect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
          }
          // Remember current fill width for next incremental update
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
      case NODE_RANGE:
        // Range slider: horizontal track + draggable thumb.
        // Incremental redraw (like NODE_PROGRESS): lastTextWidth holds the
        // previous fill width. We erase the delta region between old and new
        // thumb positions with the background, then redraw the track portion
        // and the new thumb — so dragging backward doesn't leave ghost thumbs.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          UI_COLOR_T fgCol = __ui_nodes[i].fg;
          UI_COLOR_T bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          UI_COLOR_T dimFg = (UI_COLOR_T)((fgCol >> 1) & UI_DIM_MASK);

          int16_t trackY = by + bh / 2;
          int16_t rMin = __ui_nodes[i].rangeMin;
          int16_t rMax = __ui_nodes[i].rangeMax;
          int16_t range = rMax - rMin;
          if (range <= 0) range = 100;
          int16_t pct = constrain(__ui_nodes[i].value, rMin, rMax) - rMin;
          int16_t fillW = ((int32_t)(bw - 8) * pct) / range;
          // lastTextWidth carries the previous fill width, or -1 if this node
          // has never been drawn (fillW=0 at value=min is a valid thumb pos).
          int16_t prevFillW = __ui_nodes[i].lastTextWidth;
          int16_t newThumbX = bx + 4 + fillW - 3;

          if (prevFillW < 0) {
            // First draw: redraw the whole track + fill from scratch.
            ui_display_draw_fast_hline(bx, trackY, bw, dimFg);
            ui_display_draw_fast_hline(bx + 4, trackY, fillW, fgCol);
          } else {
            // Incremental: wipe the strip between the old and new thumb
            // positions (whichever extends further on each side), then restore
            // the track line. This is symmetric — old thumbs disappear whether
            // the drag moves forward or backward.
            int16_t prevThumbX = bx + 4 + prevFillW - 3;
            int16_t left = prevThumbX < newThumbX ? prevThumbX : newThumbX;
            int16_t right = prevThumbX + 6 > newThumbX + 6 ? prevThumbX + 6 : newThumbX + 6;
            if (left < bx) left = bx;
            if (right > bx + bw) right = bx + bw;
            // Erase the thumb band (10px tall) to background.
            ui_display_fill_rect(left, trackY - 5, right - left, 10, bgCol);
            // Restore the track line over the wiped strip: bright up to the
            // current fill end, dim beyond it.
            int16_t fillEnd = bx + 4 + fillW;
            if (right <= fillEnd) {
              ui_display_draw_fast_hline(left, trackY, right - left, fgCol);
            } else if (left >= fillEnd) {
              ui_display_draw_fast_hline(left, trackY, right - left, dimFg);
            } else {
              ui_display_draw_fast_hline(left, trackY, fillEnd - left, fgCol);
              ui_display_draw_fast_hline(fillEnd, trackY, right - fillEnd, dimFg);
            }
          }

          // Thumb: small filled rectangle at the current position.
          if (newThumbX < bx + 1) newThumbX = bx + 1;
          if (newThumbX > bx + bw - 7) newThumbX = bx + bw - 7;
          ui_display_fill_rect(newThumbX, trackY - 5, 6, 10, fgCol);

          // Remember current fill width for the next incremental update.
          __ui_nodes[i].lastTextWidth = fillW;
        }
        break;
      case NODE_INPUT:
        // Input field: bordered rect + current text (or placeholder), clipped to box width.
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          UI_COLOR_T fgCol = __ui_nodes[i].fg;
          UI_COLOR_T bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          if (__ui_nodes[i].borderRadius > 0) {
            ui_display_fill_round_rect(bx, by, bw, bh, __ui_nodes[i].borderRadius, bgCol);
          } else {
            ui_display_fill_rect(bx, by, bw, bh, bgCol);
          }
          UI_COLOR_T inputBorder = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : fgCol;
          uint8_t inputBorderStyle = __ui_nodes[i].borderStyle ? __ui_nodes[i].borderStyle : 1;
          uint8_t inputBorderWidth = __ui_nodes[i].borderWidth ? __ui_nodes[i].borderWidth : 1;
          ui_draw_rect_outline(bx, by, bw, bh, __ui_nodes[i].borderRadius, inputBorderStyle, inputBorderWidth, inputBorder);
          // Show typed text (textBuffer) in fg color, or placeholder (.text)
          // dimmed gray when the buffer is empty.
          UI_COLOR_T textCol = fgCol;
          const char* disp = (__ui_nodes[i].textBuffer[0] != 0)
            ? __ui_nodes[i].textBuffer
            : (__ui_nodes[i].text ? __ui_nodes[i].text : "");
#if defined(UI_HIDE_OSK)
          // Desktop target: when this input is the active edit target, suppress
          // the placeholder. The editing buffer is loaded from the (likely empty)
          // textBuffer on focus, so without this the placeholder ("enter name")
          // would render with the caret at its end. Hide it so the caret shows
          // on a clean field at position 0 until the user types.
          if (__ui_kb_visible && (int16_t)__ui_kb_target == (int16_t)i && __ui_nodes[i].textBuffer[0] == 0) {
            disp = "";
          }
#endif
          if (__ui_nodes[i].textBuffer[0] == 0) {
#if UI_COLOR_DEPTH == 888
            textCol = 0x848484;
#else
            textCol = 0x8410;
#endif
          }
          // Note: the actual text draw is via ui_draw_text (which uses __ui_gfx).
          // The setCursor/setTextColor/setTextSize below are legacy — ui_draw_text
          // handles its own cursor/colors. Keep them on __ui_gfx for consistency
          // (in case __ui_gfx is the scroll canvas, not __tc_display).
          ui_display_set_cursor(bx + 4, by + (bh - ts * 8) / 2);
          ui_display_set_text_color(textCol, bgCol);
          ui_display_set_text_size(ts);
          // Clip: at textSize ts, each char is ts*6px advance. Only print chars
          // that fit within the box (bw - 8px margin), so text never overflows
          // the border or wraps to the next line.
          int16_t maxChars = (bw - 8) / (ts * 6);
          if (maxChars < 0) maxChars = 0;
          int16_t len = (int16_t)strlen(disp);
          if (len > maxChars) len = maxChars;
          if (len > UI_TEXT_BUF) len = UI_TEXT_BUF;
          char clipped[UI_TEXT_BUF + 1];
          for (int16_t c = 0; c < len; c++) {
            clipped[c] = disp[c];
          }
          clipped[len] = 0;
          ui_draw_text(clipped, bx + 4, by + (bh - ui_text_height(ts, __ui_nodes[i].fontFace)) / 2,
            textCol, bgCol, ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
#if defined(UI_HIDE_OSK)
          // Desktop target: with no OSK grid there's no focus indicator. Draw a
          // blinking caret at the end of the typed text on the active edit target
          // so the user sees which field they're editing. Blink ~3×/sec via the
          // top bits of __ui_kb_blink (mask 0x20 toggles every 32 ticks ≈ 530ms).
          if (__ui_kb_visible && (int16_t)__ui_kb_target == (int16_t)i && (__ui_kb_blink & 0x20)) {
            uint16_t caretW = ui_text_width(clipped, ts, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
            int16_t caretX = bx + 4 + (int16_t)caretW;
            int16_t caretYTop = by + (bh - ts * 8) / 2;
            // fgCol (not textCol): the placeholder-dimming path sets textCol to
            // gray, which would make the caret nearly invisible on a focused
            // empty field. The caret should always be the input's foreground.
            ui_display_fill_rect(caretX, caretYTop, (int16_t)(ts > 1 ? 2 : 1), (int16_t)(ts * 8), fgCol);
          }
#endif
        }
        break;
      case NODE_IMG:
        {
          UI_COLOR_T imgBg = __ui_nodes[i].hasBg ? fillBg : __ui_nodes[i].clearColor;
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, imgBg);
        }
        if (__ui_nodes[i].imgDataId < __ui_image_count) {
          const UIImage* img = &__ui_images[__ui_nodes[i].imgDataId];
          int16_t targetW = __ui_nodes[i].box.w;
          int16_t targetH = __ui_nodes[i].box.h;
          ui_draw_image_with_fit(img, __ui_nodes[i].box.x, drawY, __ui_nodes[i].rotateDeg, __ui_nodes[i].objectFit, targetW, targetH);
        }
        if (__ui_nodes[i].borderStyle != 0) {
          int16_t borderW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t borderH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_draw_rect_outline(__ui_nodes[i].box.x, drawY, borderW, borderH,
            __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, bColor);
        }
        break;
      case NODE_CANVAS: {
        // Find this node's draw callback.
        void (*__ui_canvas_fn)(CuttlefishCanvas16*) = nullptr;
        for (uint16_t b = 0; b < __ui_canvas_binding_count; b++) {
          if (__ui_canvas_bindings[b].node == i) { __ui_canvas_fn = __ui_canvas_bindings[b].fn; break; }
        }
        if (__ui_canvas_fn) {
          int16_t __ui_cw = __ui_nodes[i].canvasW;
          int16_t __ui_ch = __ui_nodes[i].canvasH;
          if (__ui_cw > 0 && __ui_ch > 0) {
            uint8_t __ui_canvas_drawn = 0;
            if (ui_display_is_default_target()) {
              // Cache a canvas sized to the buffer for direct hardware draws so
              // the callback's many primitives push as one bitmap. When the
              // active target is already a memory canvas (scroll/repair/full
              // framebuffer), skip the nested allocation and draw directly below.
              // A canvas can construct but fail its internal pixel-buffer malloc
              // (non-null canvas, null buffer). Treat that as "no canvas" so a
              // transient malloc failure self-heals instead of blanking the node.
              if (!__ui_node_canvas || !display_canvasBuffer(__ui_node_canvas) ||
                  display_canvasWidth(__ui_node_canvas) != __ui_cw || display_canvasHeight(__ui_node_canvas) != __ui_ch) {
                display_deleteCanvas(__ui_node_canvas);
                __ui_node_canvas = display_createCanvas(__ui_cw, __ui_ch);
              }
              CuttlefishCanvas16* __ui_lc = __ui_node_canvas;
              if (__ui_lc && display_canvasBuffer(__ui_lc)) {
                display_canvasFillScreen(__ui_lc, __ui_nodes[i].clearColor);
                CuttlefishDisplayTarget* __ui_prev_target = ui_display_get_target();
                ui_display_set_target((CuttlefishDisplayTarget*)__ui_lc);
                __ui_canvas_fn(__ui_lc);
                ui_display_set_target(__ui_prev_target);
                ui_draw_canvas_rect(__ui_lc, __ui_nodes[i].box.x, drawY, __ui_cw, __ui_ch);
                __ui_canvas_drawn = 1;
              }
            }
            if (!__ui_canvas_drawn) {
              UI_COLOR_T __ui_canvas_bg = __ui_nodes[i].hasBg ? fillBg : __ui_nodes[i].clearColor;
              ui_display_fill_rect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_canvas_bg);
              int16_t __ui_prev_off_x = __ui_draw_off_x;
              int16_t __ui_prev_off_y = __ui_draw_off_y;
              int16_t __ui_prev_canvas_w = __ui_canvas_fallback_w;
              int16_t __ui_prev_canvas_h = __ui_canvas_fallback_h;
              __ui_canvas_fallback_w = __ui_cw;
              __ui_canvas_fallback_h = __ui_ch;
              __ui_draw_off_x = (int16_t)(__ui_prev_off_x + __ui_nodes[i].box.x);
              __ui_draw_off_y = (int16_t)(__ui_prev_off_y + drawY);
              __ui_canvas_fn(nullptr);
              __ui_draw_off_x = __ui_prev_off_x;
              __ui_draw_off_y = __ui_prev_off_y;
              __ui_canvas_fallback_w = __ui_prev_canvas_w;
              __ui_canvas_fallback_h = __ui_prev_canvas_h;
            }
          }
        }
        break;
      }
      case NODE_LIST: {
        // Virtualized list: state lives on the node now (listCountFn/listItemFn/
        // listCount/scrollY/contentHeight/listItemHeight), not in a side table.
        if (!__ui_nodes[i].listItemFn) break;
        int16_t bx = __ui_nodes[i].box.x;
        int16_t by = drawY;
        int16_t bw = __ui_nodes[i].box.w;
        int16_t bh = __ui_nodes[i].box.h;
        uint16_t ih = __ui_nodes[i].listItemHeight > 0 ? __ui_nodes[i].listItemHeight : 24;
        uint16_t itemCount = __ui_nodes[i].listCount;
        int16_t listScrollY = __ui_nodes[i].scrollY;
        int16_t listContentH = __ui_nodes[i].contentHeight;
        UI_COLOR_T clearCol = __ui_nodes[i].clearColor;
        uint8_t listFullRepaint = 0;
        // Render to a viewport-sized canvas so edge glyphs are naturally clipped.
        // Treat a null buffer (failed internal malloc) as "no canvas" and retry —
        // see __ui_node_canvas for the zombie-caching rationale.
        // __ui_list_canvas is file-scoped so ui_release_canvas_state() can free it.
        if (!__ui_list_canvas || !display_canvasBuffer(__ui_list_canvas) ||
            display_canvasWidth(__ui_list_canvas) != bw || display_canvasHeight(__ui_list_canvas) != bh) {
          display_deleteCanvas(__ui_list_canvas);
          __ui_list_canvas_node = -1;
          __ui_list_canvas = display_createCanvas(bw, bh);
          listFullRepaint = 1;
        }
        CuttlefishCanvas16* lc = __ui_list_canvas;
        if (!lc || !display_canvasBuffer(lc)) {
          break;
        }
        if (__ui_list_canvas_node != (int16_t)i) listFullRepaint = 1;
        int16_t repaintY = 0;
        int16_t repaintH = bh;
        int16_t deltaY = listScrollY - __ui_nodes[i].lastPaintedScrollY;
        int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
        uint8_t canShiftList = (!listFullRepaint && deltaY != 0 && absDelta < bh);
        if (canShiftList) {
          ui_shift_container_canvas(lc, deltaY, clearCol, &repaintY, &repaintH);
        } else {
          display_canvasFillScreen(lc, clearCol);
          repaintY = 0;
          repaintH = bh;
        }
        // GFXcanvas text has no clipping. For shift-and-repair frames, draw row
        // text into a strip-sized repair canvas first, then blit only that strip
        // into the shifted list canvas. This prevents a 1-5px repair from
        // repainting full glyphs across pixels that were already shifted.
        CuttlefishCanvas16* listTextCanvas = lc;
        int16_t listTextOffsetY = 0;
        uint8_t drawingListRepair = 0;
        if (canShiftList && repaintH > 0 && repaintH < bh) {
          CuttlefishCanvas16* rc = ui_get_repair_canvas(bw, repaintH);
          if (rc) {
            display_canvasFillScreen(rc, clearCol);
            listTextCanvas = rc;
            listTextOffsetY = repaintY;
            drawingListRepair = 1;
          } else {
            display_canvasFillScreen(lc, clearCol);
            repaintY = 0;
            repaintH = bh;
            canShiftList = 0;
          }
        }
        // Compute visible range for the repainted strip. Previously-rendered
        // pixels are shifted in-place; only the exposed band needs new rows.
        uint16_t first = (listScrollY + repaintY) / ih;
        uint16_t last = (listScrollY + repaintY + repaintH - 1) / ih + 1;
        if (itemCount > 0 && last >= itemCount) last = itemCount - 1;
        // Draw each visible item (canvas-local coords: 0,0 = viewport top).
        char listBuf[UI_TEXT_BUF + 1];
        display_targetSetTextWrap((CuttlefishDisplayTarget*)listTextCanvas, false);
        if (itemCount > 0 && repaintH > 0) {
          for (uint16_t idx = first; idx <= last; idx++) {
            int16_t itemY = (int16_t)(idx * ih) - listScrollY - listTextOffsetY;
            __ui_nodes[i].listItemFn(idx, listBuf, UI_TEXT_BUF + 1);
            listBuf[UI_TEXT_BUF] = 0;
            display_targetSetCursor((CuttlefishDisplayTarget*)listTextCanvas, 4, itemY + (ih - 16) / 2);
            display_targetSetTextColor((CuttlefishDisplayTarget*)listTextCanvas, __ui_nodes[i].fg);
            display_targetSetTextSize((CuttlefishDisplayTarget*)listTextCanvas, 2);
            display_targetPrint((CuttlefishDisplayTarget*)listTextCanvas, listBuf);
          }
        }
        if (drawingListRepair) {
          CuttlefishDisplayTarget* prevTarget = ui_display_get_target();
          ui_display_set_target((CuttlefishDisplayTarget*)lc);
          ui_draw_canvas_rect(listTextCanvas, 0, repaintY, bw, repaintH);
          ui_display_set_target(prevTarget);
        }
        // Scrollbar (canvas-local coords).
        if (listContentH > bh) {
          int16_t tx = bw - 4;
          uint16_t thumbH = (uint32_t)bh * bh / listContentH;
          if (thumbH < 8) thumbH = 8;
          int16_t maxScroll = listContentH - bh;
          uint16_t thumbY = maxScroll > 0 ? (uint32_t)(bh - thumbH) * listScrollY / maxScroll : 0;
          UI_COLOR_T dimFg = (UI_COLOR_T)((__ui_nodes[i].fg >> 1) & UI_DIM_MASK);
          display_canvasFillRect(lc, tx, 0, 3, bh, dimFg);
          display_canvasFillRect(lc, tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
        }
        // Outset shadows are static decoration. Redrawing the hard shadow
        // directly to the panel before every small scroll-frame creates a
        // visible shadow-then-content intermediate state on SPI TFTs. Keep it
        // for full list repaints, but skip it for shift-and-repair scrolls.
        if (!drawingBufferedScroll && !__ui_fb && !canShiftList) {
          ui_draw_shadow(i, by, 0);
        }
        // Standalone lists push directly. Lists inside a buffered scroll
        // container must composite into that scroll canvas; their box has
        // already been translated to canvas-local coordinates.
        if (drawingBufferedScroll) {
          ui_draw_canvas_rect(lc, bx, by, bw, bh);
        } else {
          ui_push_canvas_rect(lc, bx, by, bw, bh);
        }
        // Draw static decoration after the scrollable pixels are composited.
        // Keeping border rows out of __ui_list_canvas prevents the cached
        // shift step from dragging top/bottom border pixels through the list.
        ui_draw_shadow(i, by, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          ui_draw_node_border(i, bx, by, bColor);
        }
        ui_draw_node_outline(i, bx, by);
        __ui_list_canvas_node = (int16_t)i;
        __ui_nodes[i].lastPaintedScrollY = listScrollY;
        __ui_nodes[i].dirty = 0;
        ui_display_set_target(__ui_draw_target);
        __ui_nodes[i].box.x = origBoxX;
        __ui_nodes[i].box.y = origBoxY;
        continue;  // list handled canvas push, decoration, and coordinate restore
      }
    }
    if (__ui_nodes[i].kind == NODE_FILL && ui_rotation_quadrant(__ui_nodes[i].rotateDeg) != 0 &&
        __ui_nodes[i].outlineStyle != 0 && __ui_nodes[i].outlineWidth > 0) {
      uint8_t w = __ui_nodes[i].outlineWidth;
      int16_t outlineW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
      int16_t outlineH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
      ui_draw_rect_outline(__ui_nodes[i].box.x - w, drawY - w,
        outlineW + 2 * w, outlineH + 2 * w,
        __ui_nodes[i].borderRadius + w, __ui_nodes[i].outlineStyle, w, __ui_nodes[i].outlineColor);
    } else {
      ui_draw_node_outline(i, __ui_nodes[i].box.x, drawY);
    }
    if (drawingPaintCanvas) {
      ui_display_set_target(__ui_draw_target);
      ui_push_canvas_rect(paintCanvas, paintCanvasX, paintCanvasY, paintCanvasW, paintCanvasH);
    }
    if (!drawingBufferedScroll) {
      ui_invalidate_scroll_canvas_for_node(i);
    }
    // Restore original box coords (translated for canvas-local drawing above).
    __ui_nodes[i].box.x = origBoxX;
    __ui_nodes[i].box.y = origBoxY;
    __ui_nodes[i].dirty = 0;
    // Report this node's bounding box to the deferred-refresh accumulator. Phase
    // 4 uses the box as the dirty rect (a safe over-estimate); Phase 5 tightens
    // to the actual paint rect. No-op on TFT (compiles to nothing).
    ui_refresh_add_rect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
  }
  // ②b Draw scrollbar + push canvas for the buffered scroll container.
  if (bufferedScrollNode >= 0 && bufferedScrollCanvas) {
    ui_push_buffered_scroll_canvas(bufferedScrollCanvas, bufferedScrollRepaintCanvas,
      bufferedScrollNode, bufferedScrollVX, bufferedScrollVY,
      bufferedScrollRepaintY, bufferedScrollRepaintH, __ui_draw_target);
  } else if (bufferedScrollNode >= 0 && bufferedScrollDirectStrip) {
    ui_draw_scrollbar_direct(bufferedScrollNode, bufferedScrollVX, bufferedScrollVY);
    __ui_nodes[bufferedScrollNode].lastPaintedScrollY = __ui_nodes[bufferedScrollNode].scrollY;
  }
  // ── Framebuffer bulk push ────────────────────────────────────────────────
  // When a framebuffer was used this frame, flush it to the display in a single
  // SPI transaction and restore the direct-draw target. No-op without one.
  if (__ui_fb) {
    ui_push_framebuffer();
  }
  ui_display_use_default_target();
  // ③ Flush — ILI9341 is immediate, no separate flush needed. On deferred-
  // refresh panels (e-ink), flush the union of this frame's dirty paint rects
  // as one partial refresh. No-op on TFT.
  ui_refresh_flush();
}

// ── Antialiasing subsystem (offscreen canvas + coverage blending) ──────────
// Enabled via #define UI_AA 1 (from display profile antialias:true).
// Shapes are rendered to a GFXcanvas16, edges blended via getPixel read-back,
// then pushed to the display. The ILI9341 has no efficient SPI read-back, so
// all blending happens in RAM.
#ifdef UI_AA

// Get (or allocate) a canvas sized to the element being drawn.
static inline CuttlefishCanvas16* ui_aa_begin(int16_t w, int16_t h, UI_COLOR_T bg) {
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_aa_canvas || display_canvasWidth(__ui_aa_canvas) < w || display_canvasHeight(__ui_aa_canvas) < h) {
    display_deleteCanvas(__ui_aa_canvas);
    __ui_aa_canvas = display_createCanvas(w > 0 ? w : 1, h > 0 ? h : 1);
  }
  if (!__ui_aa_canvas || !display_canvasBuffer(__ui_aa_canvas)) return nullptr;
  display_canvasFillScreen(__ui_aa_canvas, bg);
  return __ui_aa_canvas;
 }

// Push the canvas rect to the display at (dx, dy).
static inline void ui_aa_push(CuttlefishCanvas16* c, int16_t dx, int16_t dy) {
  if (!c || !display_canvasBuffer(c)) return;
  int16_t w = display_canvasWidth(c), h = display_canvasHeight(c);
  // Push via __ui_gfx so the AA output goes to the scroll canvas when active,
  // or the display directly when not. Row-by-row drawRGBBitmap (no transparent
  // alpha — the AA canvas already has the blended pixels).
  for (int16_t row = 0; row < h; row++) {
    ui_display_draw_rgb_bitmap(dx, dy + row, display_canvasBuffer(c) + (int32_t)row * w, w, 1);
  }
}

// Blend a pixel at integer coords with a coverage fraction (0-255).
static inline void ui_aa_pixel(CuttlefishCanvas16* c, int16_t x, int16_t y, UI_COLOR_T color, uint8_t cov) {
  if (!c || !display_canvasBuffer(c)) return;
  if (cov == 0) return;
  if (x < 0 || y < 0 || x >= display_canvasWidth(c) || y >= display_canvasHeight(c)) return;
  if (cov >= 255) { display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color); return; }
  UI_COLOR_T bg = display_canvasGetPixel(c, x, y);
  uint8_t op = (uint8_t)((uint16_t)cov * 100 / 255);
  display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, ui_blend(color, bg, op));
}

// Xiaolin Wu antialiased line. Coordinates are in canvas-local space.
static inline void ui_aa_line(CuttlefishCanvas16* c, float x0, float y0, float x1, float y1, UI_COLOR_T color) {
  if (!c || !display_canvasBuffer(c)) return;
  auto ipart = [](float f) { return (int16_t)f; };
  auto round_f = [](float f) { return (int16_t)(f + 0.5f); };
  auto fpart = [](float f) { return f - (float)(int16_t)f; };
  auto rfpart = [&](float f) { return 1.0f - fpart(f); };

  bool steep = fabs(y1 - y0) > fabs(x1 - x0);
  if (steep) { float t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
  if (x0 > x1) { float t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }

  float dx = x1 - x0, dy = y1 - y0;
  float gradient = (dx == 0) ? 1.0f : dy / dx;

  int16_t xpx1 = round_f(x0);
  float xend = x0 + 0.5f * (xpx1 - x0) * (xpx1 - x0 < 0 ? -1 : 0); // simplified
  float intery = y0 + gradient * (xpx1 - x0);

  for (int16_t x = xpx1; x <= ipart(x1); x++) {
    if (steep) {
      ui_aa_pixel(c, ipart(intery), x, color, (uint8_t)(rfpart(intery) * 255));
      ui_aa_pixel(c, ipart(intery) + 1, x, color, (uint8_t)(fpart(intery) * 255));
    } else {
      ui_aa_pixel(c, x, ipart(intery), color, (uint8_t)(rfpart(intery) * 255));
      ui_aa_pixel(c, x, ipart(intery) + 1, color, (uint8_t)(fpart(intery) * 255));
    }
    intery += gradient;
  }
}

// Antialiased circle outline. cx,cy,r are in canvas-local space.
static inline void ui_aa_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color) {
  if (!c || !display_canvasBuffer(c)) return;
  if (r <= 0) return;
  // Walk each scanline from top to bottom of the bounding box.
  int16_t y0 = (int16_t)floor(cy - r);
  int16_t y1 = (int16_t)ceil(cy + r);
  for (int16_t y = y0; y <= y1; y++) {
    float dy = (float)y - cy;
    float dx = r * r - dy * dy;
    if (dx < 0) continue;
    float halfW = sqrtf(dx);
    float leftX = (float)cx - halfW;
    float rightX = (float)cx + halfW;
    // Left edge: blend two pixels at the coverage split.
    int16_t lx = (int16_t)floor(leftX);
    float lfrac = leftX - lx;
    ui_aa_pixel(c, lx, y, color, (uint8_t)((1.0f - lfrac) * 255));
    ui_aa_pixel(c, lx + 1, y, color, 0);  // interior starts here (drawn solid below)
    // Right edge.
    int16_t rx = (int16_t)floor(rightX);
    float rfrac = rightX - rx;
    ui_aa_pixel(c, rx, y, color, (uint8_t)(rfrac * 255));
    ui_aa_pixel(c, rx + 1, y, color, 0);
    // Solid fill between edges (skip the edge pixels already blended).
    for (int16_t x = lx + 1; x < rx; x++) {
      if (x >= 0 && x < display_canvasWidth(c)) display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color);
    }
  }
}

// Antialiased filled circle.
static inline void ui_aa_fill_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color) {
  if (!c || !display_canvasBuffer(c)) return;
  if (r <= 0) return;
  int16_t y0 = (int16_t)floor(cy - r);
  int16_t y1 = (int16_t)ceil(cy + r);
  for (int16_t y = y0; y <= y1; y++) {
    float dy = (float)y - cy;
    float dx = r * r - dy * dy;
    if (dx < 0) continue;
    float halfW = sqrtf(dx);
    float leftX = (float)cx - halfW;
    float rightX = (float)cx + halfW;
    int16_t lx = (int16_t)floor(leftX);
    int16_t rx = (int16_t)ceil(rightX);
    // Blend left edge.
    ui_aa_pixel(c, lx, y, color, (uint8_t)((1.0f - (leftX - lx)) * 255));
    // Blend right edge.
    ui_aa_pixel(c, rx, y, color, (uint8_t)((rightX - (rx - 1)) * 255));
    // Solid interior.
    for (int16_t x = lx + 1; x < rx; x++) {
      if (x >= 0 && x < display_canvasWidth(c) && y >= 0 && y < display_canvasHeight(c)) display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color);
    }
  }
}

#endif // UI_AA

// ── On-screen keyboard subsystem ───────────────────────────────────────────
// (UIKey struct, UI_KB_* defines, __ui_kb_box, __ui_kb_visible, __ui_kb_bs_held,
//  __ui_last_touch_x/y are declared earlier near the touch state machine so
//  the touch functions can reference them.)

// Populated by the per-keyboard loader function (emitted by the lowering).
// (__ui_kb_keys is forward-declared earlier near the touch state machine.)
static uint8_t __ui_kb_keyCount;
static uint8_t __ui_kb_rows;
static uint8_t __ui_kb_cols;
static char    __ui_kb_buffer[UI_TEXT_BUF + 1];
static uint8_t __ui_kb_len;
static uint8_t __ui_kb_maxlen;
static uint8_t __ui_kb_shift;
// __ui_kb_visible, __ui_kb_bs_held, __ui_last_touch_x/y are forward-declared
// earlier (near the touch state machine) because ui_touch_up references them.
// __ui_kb_target is also forward-declared there (the UI_HIDE_OSK caret/blink
// paths in ui_tick and the input draw reference it before this point).
static uint32_t __ui_kb_bs_repeat;   // last auto-repeat deletion time
// __ui_kb_dirty is forward-declared earlier (near the touch state machine).
static void    (*__ui_kb_onchange)();
// Dispatch table: one loader per input node. Indexed by input position.
extern void (*__ui_kb_loaders[])();
extern const uint16_t __ui_kb_loader_count;

static inline void ui_kb_add_key(char ch, uint8_t special, UI_COLOR_T bg, UI_COLOR_T fg, UI_COLOR_T borderColor) {
  if (__ui_kb_keyCount >= UI_KB_MAX) return;
  __ui_kb_keys[__ui_kb_keyCount] = { ch, special };
  __ui_kb_styles[__ui_kb_keyCount] = { bg, fg, borderColor };
  __ui_kb_keyCount++;
}

// Insert a character into the buffer (if space permits).
static inline void ui_kb_insert(char c) {
  if (__ui_kb_maxlen > 0 && __ui_kb_len >= __ui_kb_maxlen) return;
  if (__ui_kb_len >= UI_TEXT_BUF) return;
  __ui_kb_buffer[__ui_kb_len++] = c;
  __ui_kb_buffer[__ui_kb_len] = 0;
#if defined(UI_HIDE_OSK)
  // Desktop target: the OSK grid isn't drawn, so the input field itself is the
  // only place the in-progress text appears. Sync the buffer into the target
  // node's textBuffer and mark it dirty so the field repaints on the next tick
  // — without this, typing appears to do nothing until Enter commits at close.
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    ui_mark_dirty((uint16_t)__ui_kb_target);
  }
#endif
}

// Delete one character from the buffer.
static inline void ui_kb_delete() {
  if (__ui_kb_len == 0) return;
  __ui_kb_buffer[--__ui_kb_len] = 0;
#if defined(UI_HIDE_OSK)
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    ui_mark_dirty((uint16_t)__ui_kb_target);
  }
#endif
}

// Compute the keyboard box on open from display dimensions + grid shape.
// Alpha (wide grid) docks to the bottom 75%; number (narrow grid) centers at 60%.
// Uses the display profile dimensions if available, else 320×240.
#ifndef __ui_display_w
#define __ui_display_w 320
#endif
#ifndef __ui_display_h
#define __ui_display_h 240
#endif
static inline void ui_kb_compute_box() {
  uint8_t isNumber = (__ui_kb_cols <= 4);
  uint16_t h = isNumber ? (__ui_display_h * 60 / 100) : (__ui_display_h * 75 / 100);
  __ui_kb_box.w = isNumber ? (__ui_display_w * 50 / 100) : __ui_display_w;
  __ui_kb_box.h = h;
  __ui_kb_box.x = isNumber ? (__ui_display_w - __ui_kb_box.w) / 2 : 0;
  __ui_kb_box.y = __ui_display_h - h;
}

// Open the keyboard for an input node.
static inline void ui_kb_open(uint16_t nodeIdx, uint8_t inputPosition) {
  __ui_kb_target = nodeIdx;
  strncpy(__ui_kb_buffer, __ui_nodes[nodeIdx].textBuffer, UI_TEXT_BUF);
  __ui_kb_buffer[UI_TEXT_BUF] = 0;
  __ui_kb_len = strlen(__ui_kb_buffer);
  uint16_t ml = __ui_nodes[nodeIdx].maxlen;
  __ui_kb_maxlen = (ml > 0 && ml <= UI_TEXT_BUF) ? (uint8_t)ml : UI_TEXT_BUF;
  __ui_kb_shift = 0;
  __ui_kb_bs_held = 0;
  // Load the key set via the dispatch table.
  if (inputPosition < __ui_kb_loader_count) __ui_kb_loaders[inputPosition]();
  __ui_kb_set_onchange();
  ui_kb_compute_box();
  __ui_kb_visible = 1;
  __ui_kb_dirty = 1;  // redraw on the first visible frame
  // Do NOT pre-mark the tree dirty here. While the keyboard is visible the
  // draw pass is skipped (its opaque background covers app nodes), so any
  // dirty flags set now are never consumed/cleared — they survive until close,
  // and the first post-close frame then repaints every dirty node = full-screen
  // flash on SPI TFTs. The close path scopes the repaint to nodes whose paint
  // rect intersects __ui_kb_box, which is the only region that needs restoring.
#if defined(UI_HIDE_OSK)
  // Desktop target: the OSK isn't drawn, so the draw pass runs normally and the
  // input field must repaint on focus to show the caret BEFORE the first
  // keystroke. (The full-screen-flash concern above doesn't apply — there's no
  // opaque overlay being skipped.) Seed the blink phase so the caret is ON for
  // the first ~530ms (bit 0x20 set → visible), so focus feels immediate.
  if (__ui_kb_target >= 0) ui_mark_dirty((uint16_t)__ui_kb_target);
  __ui_kb_blink = 0x20;
#endif
}

// Close the keyboard: commit buffer back to the input node.
static inline void ui_kb_close() {
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    if (__ui_kb_onchange) __ui_kb_onchange();
  }
  // Capture the keyboard box before clearing visibility — it identifies the
  // screen region the opaque overlay covered and that now needs restoring.
  UIRect kbBox = __ui_kb_box;
  __ui_kb_visible = 0;
  __ui_kb_target = -1;
  __ui_kb_bs_held = 0;
  // The <screen> root's paint rect spans the whole display, so it always
  // intersects kbBox. Routing it through ui_mark_dirty would cascade via
  // ui_mark_overlapping_higher_layers_dirty into marking every node on the
  // active screen dirty (its rect overlaps everything), which is the
  // full-screen flash this function exists to avoid. Repaint just the
  // keyboard-box slice of its background directly instead.
  int16_t screenRoot = -1;
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].parent == UI_NO_PARENT && __ui_nodes[i].screenId == __ui_active_screen) {
      screenRoot = (int16_t)i;
      break;
    }
  }
  if (screenRoot >= 0) {
    UI_COLOR_T rootBg = (UI_COLOR_T)(__ui_nodes[screenRoot].hasBg
      ? __ui_nodes[screenRoot].bg
      : __ui_nodes[screenRoot].clearColor);
    ui_display_fill_rect(kbBox.x, kbBox.y, kbBox.w, kbBox.h, rootBg);
  }
  // Repaint everything else the keyboard overlay actually overwrote: nodes
  // whose paint rect intersects the keyboard box, plus the edited input
  // itself (its text just changed). ui_mark_dirty handles overlap repair +
  // scroll clipping — safe here since these nodes are bounded in size, unlike
  // the screen root.
  for (uint16_t i = 0; i < __ui_node_count; i++) {
    if ((int16_t)i == screenRoot) continue;
    UIRect r;
    ui_node_current_paint_rect(i, &r);
    if (r.w > 0 && r.h > 0 &&
        ui_rects_intersect(r.x, r.y, r.w, r.h, kbBox.x, kbBox.y, kbBox.w, kbBox.h)) {
      ui_mark_dirty(i);
    }
  }
}

// Compute a key's rect from its index, given the grid + box.
// The top UI_KB_TEXT_H pixels of the box are reserved for the preview text row;
// keys fill the area below it.
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out) {
  uint8_t col = idx % __ui_kb_cols;
  uint8_t row = idx / __ui_kb_cols;
  int16_t keysH = __ui_kb_box.h - UI_KB_TEXT_H;  // key area height (below text row)
  out->x = __ui_kb_box.x + (int16_t)col * __ui_kb_box.w / __ui_kb_cols;
  out->y = __ui_kb_box.y + UI_KB_TEXT_H + (int16_t)row * keysH / __ui_kb_rows;
  out->w = __ui_kb_box.w / __ui_kb_cols;
  out->h = keysH / __ui_kb_rows;
}

// Handle a touch-down inside the keyboard box. tx,ty are display coords.
// Handle a touch-down inside the keyboard box. Only fires on the initial
// down edge (tracked by __ui_touch_state in the modal path), NOT every poll.
// Records WHICH key is under the finger — the same key is activated on release
// (ui_kb_handle_tap), avoiding mis-targeting from coordinate drift on release.
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty) {
  __ui_kb_pressed_key = -1;
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIKey k = __ui_kb_keys[i];
    if (k.special == 255) continue;  // padding cell, skip
    UIRect r;
    ui_kb_key_rect(i, &r);
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
      __ui_kb_pressed_key = (int8_t)i;  // remember for release
      __ui_kb_repaint_key = (int8_t)i;
      __ui_kb_dirty = 2;  // targeted: redraw just this key's highlight
      // Backspace starts deleting immediately + arms auto-repeat.
      if (k.special == 2) {
        __ui_kb_bs_held = 1;
        __ui_kb_bs_repeat = millis();
        ui_kb_delete();
      }
      return;
    }
  }
}

// Called each frame while the keyboard is visible + a touch is held.
// Handles ⌫ auto-repeat.
static inline void ui_kb_tick(uint32_t now) {
  if (!__ui_kb_bs_held) return;
  if (now - __ui_kb_bs_repeat >= UI_KB_REPEAT_MS) {
    ui_kb_delete();
    __ui_kb_bs_repeat = now;
    __ui_kb_repaint_key = __ui_kb_pressed_key;  // ⌫ key stays highlighted
    __ui_kb_dirty = 2;  // targeted: text row + ⌫ key
  }
}

// Handle a tap release. Activates the key that was under the finger on
// touch-down (__ui_kb_pressed_key) — NOT a fresh hit-test, which would
// mis-target due to coordinate drift on a resistive panel at release.
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty) {
  (void)tx; (void)ty;  // key was recorded on touch-down; no re-hit-test
  if (__ui_kb_pressed_key < 0) return;
  UIKey k = __ui_kb_keys[__ui_kb_pressed_key];
  int8_t releasedKey = __ui_kb_pressed_key;
  __ui_kb_pressed_key = -1;  // clear pressed state → highlight reverts
  switch (k.special) {
    case 0: {  // char
      char c = k.ch;
      uint8_t wasShift = __ui_kb_shift;
      if (wasShift && c >= 'a' && c <= 'z') c -= 32;
      ui_kb_insert(c);
      __ui_kb_shift = 0;  // shift resets after one char
      // Text row changes; if shift was active, repaint shift key too.
      __ui_kb_repaint_key = wasShift ? -1 : releasedKey;
      __ui_kb_dirty = 2;
      break;
    }
    case 1:  // shift toggle — all letter keys change case, full redraw
      __ui_kb_shift = !__ui_kb_shift;
      __ui_kb_dirty = 1;
      break;
    case 2:  // backspace: handled on down + repeat; nothing on tap-up
      __ui_kb_repaint_key = releasedKey;  // revert highlight
      __ui_kb_dirty = 2;
      break;
    case 3:  // OK
      ui_kb_close();
      break;
    case 4: {  // page-swap — new key layout, full redraw
      extern void __ui_kb_load_default_alpha();
      extern void __ui_kb_load_default_number();
      if (__ui_kb_cols <= 4) __ui_kb_load_default_alpha();
      else __ui_kb_load_default_number();
      ui_kb_compute_box();
      __ui_kb_dirty = 1;
      break;
    }
  }
}

// Draw a single key by index. Shared by the full draw + targeted redraw.
static inline void ui_kb_draw_key(uint8_t i) {
  UIKey k = __ui_kb_keys[i];
  UIKeyStyle ks = __ui_kb_styles[i];
  UIRect r;
  ui_kb_key_rect(i, &r);
  UI_COLOR_T bg = ks.bg;
  UI_COLOR_T fg = ks.fg;
  UI_COLOR_T border = ks.borderColor;
  // Shift-active highlight: brighten the shift key's background — but only
  // when not pressed, so the press inversion stays high-contrast.
  if (k.special == 1 && __ui_kb_shift && (int8_t)i != __ui_kb_pressed_key) {
#if UI_COLOR_DEPTH == 888
    bg = 0xBDEFFF;
#else
    bg = 0xBDF7;
#endif
  }
  // Pressed key: invert colors for clear tap feedback.
  if ((int8_t)i == __ui_kb_pressed_key) { UI_COLOR_T t = bg; bg = fg; fg = t; }
  ui_display_fill_rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, bg);
  ui_display_draw_rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, border);
  ui_display_set_text_color(fg, bg);
  ui_display_set_text_size(1);
  // Derive the label string + its length for centering.
  const char* labelStr;
  char single[2];
  switch (k.special) {
    case 1:  labelStr = "Aa"; break;
    case 2:  labelStr = "DEL"; break;
    case 3:  labelStr = "OK"; break;
    case 4:  labelStr = __ui_kb_cols <= 4 ? "ABC" : "123"; break;
    default:
      single[0] = (__ui_kb_shift && k.ch >= 'a' && k.ch <= 'z') ? (char)(k.ch - 32) : k.ch;
      single[1] = 0;
      labelStr = single;
      break;
  }
  // Center: textW = len * 6px, textH = 8px. Position inside the key rect.
  uint8_t len = strlen(labelStr);
  int16_t textW = (int16_t)len * 6;
  int16_t textH = 8;
  int16_t cx = r.x + (r.w - textW) / 2;
  int16_t cy = r.y + (r.h - textH) / 2;
  if (cx < r.x + 1) cx = r.x + 1;  // clamp if label wider than key
  ui_display_set_cursor(cx, cy);
  ui_display_print(labelStr);
}

// Redraw only the text display row (top of keyboard box). Used when a char is
// inserted/deleted without changing key highlights.
static inline void ui_kb_draw_text_row() {
  // Clear the text row area (top UI_KB_TEXT_H px of the keyboard box).
  ui_display_fill_rect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, UI_KB_TEXT_H, __ui_kb_bg);
  ui_display_set_cursor(__ui_kb_box.x + 4, __ui_kb_box.y + 4);
#if UI_COLOR_DEPTH == 888
  ui_display_set_text_color(0xFFFFFF, 0x000000);
#else
  ui_display_set_text_color(0xFFFF, 0x0000);
#endif
  ui_display_set_text_size(2);
  ui_display_print(__ui_kb_buffer);
  ui_display_print("_");  // cursor
}

// Draw the full keyboard overlay (background + text row + all keys).
static inline void ui_kb_draw() {
  // Opaque background over the keyboard box.
  ui_display_fill_rect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, __ui_kb_box.h, __ui_kb_bg);
  ui_kb_draw_text_row();
  // Keys: one rect per key, label centered.
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    if (__ui_kb_keys[i].special == 255) continue;  // padding cell, skip
    ui_kb_draw_key(i);
  }
}

#endif

void ui_poll_touch() {}
const UIFontFace __ui_font_faces[] = {};
const uint16_t __ui_font_face_count = 0;
const UIImage __ui_images[] = {};
const uint16_t __ui_image_count = 0;
const UIKeyframeSet __ui_keyframe_sets[] = {};
const uint16_t __ui_keyframe_set_count = 0;
UIAnimation __ui_anims[] = {};
const uint16_t __ui_anim_count = 0;
UINode __ui_nodes[] = {
  { .box={0,0,320,240}, .bg=0x0000, .fg=0xffff, .kind=NODE_FILL, .text=nullptr, .textBuffer={0}, .hasTextBinding=0, .font=nullptr, .hasBg=0, .textAlign=0, .textSize=2, .lineHeight=16, .letterSpacing=0, .fontAntialias=1, .fontFace=0, .borderColor=0x0000, .borderStyle=0, .borderWidth=0, .borderTopWidth=0, .borderRightWidth=0, .borderBottomWidth=0, .borderLeftWidth=0, .hasPerSideBorder=0, .borderRadius=0, .paddingTop=0, .paddingRight=0, .paddingBottom=0, .paddingLeft=0, .gradientEnabled=0, .gradientColor1=0x0000, .gradientColor2=0x0000, .outlineColor=0xffff, .outlineStyle=0, .outlineWidth=0, .zIndex=0, .transformOffsetX=0, .transformOffsetY=0, .rotateDeg=0, .pressedOffsetX=0, .pressedOffsetY=0, .shadowCount=0, .shadowOffsetX={0,0,0,0}, .shadowOffsetY={0,0,0,0}, .shadowBlur={0,0,0,0}, .shadowColor={0x0000,0x0000,0x0000,0x0000}, .shadowAlpha={0,0,0,0}, .shadowInset={0,0,0,0}, .textShadowCount=0, .textShadowOffsetX=0, .textShadowOffsetY=0, .textShadowBlur=0, .textShadowColor=0x0000, .textShadowAlpha=0, .underline=0, .textOverflow=0, .nowrap=0, .whiteSpaceMode=0, .visible=1, .opacity=100, .clearColor=0x0000, .lastTextWidth=0, .lastTextHeight=0, .layoutCacheKey=0, .layoutMetricsW=0, .layoutMetricsH=0, .scrollable=0, .virtualized=0, .scrollY=0, .contentHeight=0, .overscrollPx=0, .settling=0, .lastPaintedScrollY=0, .listCount=0, .listCountFn=nullptr, .listItemFn=nullptr, .listTapFn=nullptr, .parent=65535, .subtreeEnd=2, .screenId=0, .imgDataId=255, .objectFit=1, .listItemHeight=0, .rangeMin=0, .rangeMax=100, .maxlen=0, .canvasW=0, .canvasH=0, .runCount=0, .richLineCount=0, .runStart=0, .richSegStart=0, .richSegCount=0, .richLineStart=0, .dirty=0, .value=0 },
  { .box={0,0,320,16}, .bg=0x0000, .fg=0xffff, .kind=NODE_TEXT, .text="hello", .textBuffer={0}, .hasTextBinding=0, .font=nullptr, .hasBg=0, .textAlign=0, .textSize=2, .lineHeight=16, .letterSpacing=0, .fontAntialias=1, .fontFace=0, .borderColor=0x0000, .borderStyle=0, .borderWidth=0, .borderTopWidth=0, .borderRightWidth=0, .borderBottomWidth=0, .borderLeftWidth=0, .hasPerSideBorder=0, .borderRadius=0, .paddingTop=0, .paddingRight=0, .paddingBottom=0, .paddingLeft=0, .gradientEnabled=0, .gradientColor1=0x0000, .gradientColor2=0x0000, .outlineColor=0xffff, .outlineStyle=0, .outlineWidth=0, .zIndex=0, .transformOffsetX=0, .transformOffsetY=0, .rotateDeg=0, .pressedOffsetX=0, .pressedOffsetY=0, .shadowCount=0, .shadowOffsetX={0,0,0,0}, .shadowOffsetY={0,0,0,0}, .shadowBlur={0,0,0,0}, .shadowColor={0x0000,0x0000,0x0000,0x0000}, .shadowAlpha={0,0,0,0}, .shadowInset={0,0,0,0}, .textShadowCount=0, .textShadowOffsetX=0, .textShadowOffsetY=0, .textShadowBlur=0, .textShadowColor=0x0000, .textShadowAlpha=0, .underline=0, .textOverflow=0, .nowrap=0, .whiteSpaceMode=0, .visible=1, .opacity=100, .clearColor=0x0000, .lastTextWidth=0, .lastTextHeight=0, .layoutCacheKey=0, .layoutMetricsW=0, .layoutMetricsH=0, .scrollable=0, .virtualized=0, .scrollY=0, .contentHeight=0, .overscrollPx=0, .settling=0, .lastPaintedScrollY=0, .listCount=0, .listCountFn=nullptr, .listItemFn=nullptr, .listTapFn=nullptr, .parent=0, .subtreeEnd=2, .screenId=0, .imgDataId=255, .objectFit=1, .listItemHeight=0, .rangeMin=0, .rangeMax=100, .maxlen=0, .canvasW=0, .canvasH=0, .runCount=0, .richLineCount=0, .runStart=0, .richSegStart=0, .richSegCount=0, .richLineStart=0, .dirty=0, .value=0 },
};
UIRichRun __ui_runs[1];
UIRichSeg __ui_rich_segs[1];
UIRichLine __ui_rich_lines[1];
const uint16_t __ui_run_count = 0;
const uint16_t __ui_rich_seg_count = 0;
const uint16_t __ui_rich_line_count = 0;
static inline const char* __ui_scroll_node_id(uint16_t idx) { (void)idx; return nullptr; }
UITransition __ui_trans[] = {};
void (*__ui_kb_loaders[])() = {};
const uint16_t __ui_kb_loader_count = 0;
UIBinding __ui_bindings[] = {};
UIListBinding __ui_list_bindings[] = {};
const uint16_t __ui_list_binding_count = 0;
UIInputBinding __ui_input_bindings[] = {};
const uint16_t __ui_input_binding_count = 0;
const uint16_t __ui_node_count = 2;
const uint16_t __ui_trans_count = 0;
const uint16_t __ui_binding_count = 0;
const uint16_t __ui_screen_count = 1;
UIPinWatch __ui_pin_watches[] = {};
const uint16_t __ui_pin_watch_count = 0;
void (*__ui_click_handlers[])() = {};
void (*__ui_hold_handlers[])() = {};
void (*__ui_release_handlers[])() = {};
const uint16_t __ui_click_handler_count = 0;
void __ui_kb_set_onchange();
void __ui_kb_set_onchange() { __ui_kb_onchange = nullptr; }
void (*__ui_rangechange_handlers[])() = {};
const uint16_t __ui_rangechange_handler_count = 0;
UIRadioGroup __ui_radio_groups[] = {};
const uint16_t __ui_radio_group_count = 0;
UICanvasBinding __ui_canvas_bindings[] = {};
const uint16_t __ui_canvas_binding_count = 0;
// ── 1. Numeric const enum ──────────────────────────────────────────────────
enum class Mode {
  Idle = 0,
  Run = 1,
  Stop = 2,
  Error = 3
};

// ── 2. Enum with explicit gaps ─────────────────────────────────────────────
enum class Code {
  Ok = 0,
  NotFound = 404,
  ServerError = 500,
  Timeout = 408
};

// ── 3. String enum ─────────────────────────────────────────────────────────
namespace Color {
  constexpr const char* Red = "red";
  constexpr const char* Green = "green";
  constexpr const char* Blue = "blue";
}

// ── 10. Enum with bitwise flags ────────────────────────────────────────────
enum class Flags {
  None = 0,
  A = 1,
  B = 2,
  C = 4,
  All = 7
};

const Mode currentMode = Mode::Run;
const __tc_str_ptr currentColor = Color::Green;
// ── 4. Enum as array index ─────────────────────────────────────────────────
int32_t PRIORITY[] = { 10, 20, 30, 40 };

static int32_t priorityForMode(Mode m);
static bool isHighPriority(Code c);
static __tc_str_ptr describeMode(Mode m);
static bool isPrimary(__tc_str_ptr c);
static __tc_str_ptr colorName(__tc_str_ptr c);
static int32_t packMode(Mode m);
static Mode unpackMode(int32_t n);
static Mode nextMode(Mode m);
static bool hasFlag(int32_t flags, Flags f);
static int32_t defaultCode();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  ui_init();
  pinMode(48, OUTPUT);
  cuttlefish_main();
}

static int32_t priorityForMode(Mode m)
{
  return PRIORITY[static_cast<int>(m)];
}

// ── 5. Enum relational comparison ──────────────────────────────────────────
static bool isHighPriority(Code c)
{
  return static_cast<int>(c) >= static_cast<int>(Code::ServerError);
}

// ── 6. Enum in switch ──────────────────────────────────────────────────────
static __tc_str_ptr describeMode(Mode m)
{
  if (m == Mode::Idle)
  {
    return "idle";
  } else if (m == Mode::Run)
  {
    return "running";
  } else if (m == Mode::Stop)
  {
    return "stopped";
  } else if (m == Mode::Error)
  {
    return "error";
  } else
  {
    return "unknown";
  }
}

// ── 7. String enum comparison and concat ───────────────────────────────────
static bool isPrimary(__tc_str_ptr c)
{
  return c == Color::Red;
}

static __tc_str_ptr colorName(__tc_str_ptr c)
{
  static char __cuttlefish_str_1[136];
  snprintf(__cuttlefish_str_1, sizeof(__cuttlefish_str_1), "color: %s", c.c_str());
  return __cuttlefish_str_1;
}

// ── 8. Enum↔integral storage boundary (Finding C: `as Mode` works) ─────────
static int32_t packMode(Mode m)
{
  return static_cast<int>(m);
}

static Mode unpackMode(int32_t n)
{
  return static_cast<Mode>(n);
}

// ── 9. Enum in arithmetic (Finding C: enum→int cast via member access) ─────
static Mode nextMode(Mode m)
{
  // enum→int via member access on an identifier is detected; the `as int32_t`
  // produces static_cast. Then +1, then `as Mode` back.
  return static_cast<Mode>(((static_cast<int32_t>(m)) + 1));
}

static bool hasFlag(int32_t flags, Flags f)
{
  return (flags & (static_cast<int32_t>(f))) != 0;
}

// ── 11. Enum member access ─────────────────────────────────────────────────
static int32_t defaultCode()
{
  return static_cast<int>(Code::Ok);
}

void cuttlefish_main()
{
  Serial.println(F("--- enum stress test ---"));
  char __cuttlefish_str_2[18];
  snprintf(__cuttlefish_str_2, sizeof(__cuttlefish_str_2), "mode=%d", static_cast<int>(currentMode));
  Serial.println(__cuttlefish_str_2);
  char __cuttlefish_str_3[18];
  snprintf(__cuttlefish_str_3, sizeof(__cuttlefish_str_3), "code=%d", static_cast<int>(Code::NotFound));
  Serial.println(__cuttlefish_str_3);
  Serial.println(colorName(currentColor));
  char __cuttlefish_str_4[139];
  snprintf(__cuttlefish_str_4, sizeof(__cuttlefish_str_4), "isPrimary=%s", ((isPrimary(Color::Red) ? "yes" : "no")));
  Serial.println(__cuttlefish_str_4);
  char __cuttlefish_str_5[18];
  snprintf(__cuttlefish_str_5, sizeof(__cuttlefish_str_5), "prio=%d", priorityForMode(Mode::Run));
  Serial.println(__cuttlefish_str_5);
  char __cuttlefish_str_6[138];
  snprintf(__cuttlefish_str_6, sizeof(__cuttlefish_str_6), "highPrio=%s", ((isHighPriority(Code::ServerError) ? "yes" : "no")));
  Serial.println(__cuttlefish_str_6);
  Serial.println(describeMode(Mode::Error));
  const int32_t packed = packMode(Mode::Stop);
  const Mode unpacked = unpackMode(packed);
  char __cuttlefish_str_7[42];
  snprintf(__cuttlefish_str_7, sizeof(__cuttlefish_str_7), "packed=%d unpacked=%d", packed, static_cast<int>(unpacked));
  Serial.println(__cuttlefish_str_7);
  const Mode nm = nextMode(Mode::Run);
  char __cuttlefish_str_8[18];
  snprintf(__cuttlefish_str_8, sizeof(__cuttlefish_str_8), "next=%d", static_cast<int>(nm));
  Serial.println(__cuttlefish_str_8);
  char __cuttlefish_str_9[134];
  snprintf(__cuttlefish_str_9, sizeof(__cuttlefish_str_9), "hasA=%s", ((hasFlag(static_cast<int>(Flags::A) | static_cast<int>(Flags::C), Flags::A) ? "yes" : "no")));
  Serial.println(__cuttlefish_str_9);
  char __cuttlefish_str_10[21];
  snprintf(__cuttlefish_str_10, sizeof(__cuttlefish_str_10), "default=%d", defaultCode());
  Serial.println(__cuttlefish_str_10);
  digitalWrite(48, HIGH);
  Serial.println(F("done"));
  pinMode(17, OUTPUT); digitalWrite(17, HIGH);
display_init();
}

void loop()
{
  uint32_t __tc_ui_now = (uint32_t)millis();
  static uint32_t __tc_ui_last_tick = __tc_ui_now;
  uint32_t __tc_ui_delta = __tc_ui_now - __tc_ui_last_tick;
  __tc_ui_last_tick = __tc_ui_now;
  if (__tc_ui_delta > 250) __tc_ui_delta = 250;
  ui_tick((uint16_t)__tc_ui_delta);
}
