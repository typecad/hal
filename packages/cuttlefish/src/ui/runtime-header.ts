// ---------------------------------------------------------------------------
// C++ reactive runtime header — the driver code that walks the node/binding/
// transition tables each frame.
//
// This is emitted once per translation unit (guarded) so the static tables
// produced by the lowering transformer have something to drive them. It
// implements the three-phase frame from spec §7:
//   1. Advance transitions (lerp toward target)
//   2. Draw traversal (dirty nodes only)
//   3. Flush dirty rects
//
// Plus the press/release entry points that node.onPress(pin) lowers to.
// ---------------------------------------------------------------------------

export function emitRuntimeHeader(): string {
  return `
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
#ifndef UI_SCROLL_DRAG_MULTIPLIER
#define UI_SCROLL_DRAG_MULTIPLIER 4
#endif
#define UI_SCROLL_EDGE_SNAP_PX 12

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT, NODE_IMG, NODE_LIST };
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
  uint16_t bg;
  uint16_t fg;
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
  uint16_t borderColor; // resolved color for the border (0 = use fg)
  uint8_t borderStyle;  // 0=none, 1=solid, 2=dashed
  uint8_t borderWidth;  // px, 0=none
  uint8_t borderRadius; // px, 0=square
  uint8_t gradientEnabled; // 0=none, 1=vertical, 2=horizontal
  uint16_t gradientColor1;
  uint16_t gradientColor2;
  uint16_t outlineColor;
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
  uint16_t shadowColor[4];
  uint8_t shadowAlpha[4];
  uint8_t shadowInset[4]; // 0=outset, 1=inset
  uint8_t textShadowCount;
  int8_t textShadowOffsetX;
  int8_t textShadowOffsetY;
  uint8_t textShadowBlur;
  uint16_t textShadowColor;
  uint8_t textShadowAlpha;
  uint8_t underline;    // text-decoration: 0=none,1=underline,2=line-through,3=both
  uint8_t textOverflow; // text-overflow: 0=clip, 1=ellipsis (truncate + ...)
  uint8_t nowrap;       // 1 = no text wrapping (white-space: nowrap/pre)
  uint8_t whiteSpaceMode; // 0=normal, 1=nowrap, 2=pre, 3=pre-line
  uint8_t visible;      // 0=hidden, 1=visible
  uint8_t opacity;      // 0-100
  uint16_t clearColor;  // ancestor's background — used to wipe transparent text before redraw
  int16_t lastTextWidth;
  int16_t lastTextHeight;
  // scroll
  uint8_t scrollable;   // 1 = children are offset by scrollY and clipped to this box
  int16_t scrollY;      // current scroll offset (children Y -= scrollY)
  int16_t contentHeight; // total height of children (for scrollbar ratio)
  uint8_t parent;       // 255 = root/no parent
  uint8_t subtreeEnd;   // exclusive pre-order end index
  uint8_t screenId;     // which <screen> this node belongs to (for navigation)
  uint8_t imgDataId;    // index into __ui_images[] (255 = no image)
  uint8_t objectFit;    // 0=none, 1=fill, 2=contain, 3=cover, 4=scale-down
  uint16_t listItemHeight; // px per item for <list> (0 = not a list)
  int16_t rangeMin;     // for <range>: minimum value
  int16_t rangeMax;     // for <range>: maximum value
  int16_t maxlen;       // for <input>: max character length (0 = UI_TEXT_BUF)
  // runtime slot
  uint8_t dirty;
  int16_t value;  // unified element state
};
struct UITransition {
  uint8_t node;
  UIProperty prop;
  uint16_t durationMs;
  // The :pressed and base-state target colors. ui_on_press arms toward
  // pressedTarget; ui_on_release arms toward baseTarget.
  uint16_t pressedTarget;
  uint16_t baseTarget;
  // runtime
  uint16_t elapsed;
  uint16_t prevValue;
  uint16_t targetValue;
  uint8_t  active;
};
struct UIBinding {
  uint8_t node;
  UIProperty prop;
  uint16_t (*fn)(void);       // for color/numeric bindings
  void (*textFn)(char* buf, uint8_t size); // for text bindings (PROP_TEXT): fills buf
};

// Color lerp for transitions (rgb565). For mono, this collapses to a snap.
static inline uint16_t lerp_color(uint16_t a, uint16_t b, uint8_t k100) {
  if (k100 >= 100) return b;
  uint8_t ar = (a >> 11) & 0x1f, ag = (a >> 5) & 0x3f, ab = a & 0x1f;
  uint8_t br = (b >> 11) & 0x1f, bg = (b >> 5) & 0x3f, bb = b & 0x1f;
  int16_t r = ar + (int16_t)(((int16_t)br - (int16_t)ar) * k100 / 100);
  int16_t g = ag + (int16_t)(((int16_t)bg - (int16_t)ag) * k100 / 100);
  int16_t bl = ab + (int16_t)(((int16_t)bb - (int16_t)ab) * k100 / 100);
  return ((uint16_t)(r & 0x1f) << 11) | ((uint16_t)(g & 0x3f) << 5) | (uint16_t)(bl & 0x1f);
}

// Declared by the lowering output (the tables). Matches the mutable (non-const)
// definitions: ui_tick updates node bg/dirty and transition elapsed/active.
extern UINode __ui_nodes[];
extern UITransition __ui_trans[];
extern UIBinding __ui_bindings[];
extern const UIFontFace __ui_font_faces[];
extern const uint8_t __ui_node_count;
extern const uint8_t __ui_trans_count;
extern const uint8_t __ui_binding_count;

// ── Multi-screen navigation ─────────────────────────────────────────────────
// Touch/scroll/keyboard state reset by navigation.
static uint8_t __ui_touch_state = 0;
static int8_t __ui_touch_node = -1;
static int8_t __ui_scroll_node = -1;
static int16_t __ui_scroll_pending_dy = 0;
static uint8_t __ui_scroll_snap_top = 0;
static int16_t __ui_scroll_start_y = 0;
static int8_t __ui_scroll_cache_node = -1;
static int16_t __ui_scroll_cache_y = 0;
static int16_t __ui_scroll_cache_w = 0;
static int16_t __ui_scroll_cache_h = 0;
static uint8_t __ui_scroll_cache_valid = 0;
static uint8_t __ui_list_snap_top = 0;
static int16_t __ui_list_start_y = 0;
static uint8_t __ui_kb_visible = 0;

static uint8_t __ui_active_screen = 0;   // which screen is visible/interactive
extern const uint8_t __ui_screen_count;  // total number of screens (emitted by lowering)

// ── Image assets ────────────────────────────────────────────────────────────
struct UIImage { uint16_t w; uint16_t h; const uint16_t* data; };
extern const UIImage __ui_images[];
extern const uint8_t __ui_image_count;

// ── @keyframes animations ───────────────────────────────────────────────────
struct UIKeyframeStop {
  uint8_t percent;
  uint8_t props; // bitmask: 1=background, 2=color, 4=opacity, 8=transform, 16=size
  uint16_t bg;
  uint16_t fg;
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
  uint8_t node;
  uint8_t keyframeSet;
  uint16_t durationMs;
  uint16_t delayMs;
  int16_t iterations;
  int16_t baseWidth;
  int16_t baseHeight;
  int8_t originX;
  int8_t originY;
  uint32_t elapsed;
  uint8_t active;
  uint32_t lastUpdateMs;  // throttle: only redraw every ~100ms to avoid tearing
};
extern const UIKeyframeSet __ui_keyframe_sets[];
extern const uint8_t __ui_keyframe_set_count;
extern UIAnimation __ui_anims[];
extern const uint8_t __ui_anim_count;

// ── List bindings ───────────────────────────────────────────────────────────
struct UIListBinding {
  uint8_t node;
  uint16_t (*countFn)(void);
  void (*itemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*tapFn)(uint16_t idx);  // optional: called when an item is tapped
};
extern UIListBinding __ui_list_bindings[];
extern const uint8_t __ui_list_binding_count;

// ── Input bindings (two-way) ─────────────────────────────────────────────────
// ui.bindInput(node, cb) — cb fires with the node's current text whenever the
// bound <input>'s textBuffer changes (e.g. user typed via on-screen keyboard).
// lastSeen holds the previously-observed text so the runtime can detect change.
struct UIInputBinding {
  uint8_t node;
  void (*cb)(const char* text);
  char lastSeen[UI_TEXT_BUF + 1];
};
extern UIInputBinding __ui_input_bindings[];
extern const uint8_t __ui_input_binding_count;

struct UIListState {
  uint8_t nodeIndex;
  uint16_t scrollY;
  uint16_t itemHeight;
  uint16_t contentHeight;
  uint16_t itemCount;
  uint16_t (*countFn)(void);
  void (*itemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*tapFn)(uint16_t idx);  // optional: called when an item is tapped
};
static UIListState __ui_lists[4];
static uint8_t __ui_list_count = 0;
static int8_t __ui_list_drag = -1;  // index into __ui_lists[] being scrolled (-1=none)
static uint8_t __ui_fade_opacity = 100;  // fade-in animation (0=transparent, 100=full)
static uint16_t __ui_fade_elapsed = 0;
static uint16_t __ui_fade_duration = 200; // ms

// Navigate to a screen by index. Marks the new screen's nodes dirty + starts fade.
static inline void ui_navigate(uint8_t screenIdx) {
  if (screenIdx >= __ui_screen_count || screenIdx == __ui_active_screen) return;
  __ui_active_screen = screenIdx;
  // Reset scroll/touch state so the old screen's scroll container doesn't
  // interfere with the new screen.
  __ui_scroll_node = -1;
  __ui_scroll_pending_dy = 0;
  __ui_scroll_cache_valid = 0;
  __ui_scroll_cache_node = -1;
  __ui_touch_node = -1;
  __ui_touch_state = 0;
  __ui_kb_visible = 0;
  // Clear the entire display so old screen content doesn't show.
  display_fillScreen(0x0000);
  // Mark all nodes dirty so the new screen fully redraws.
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) __ui_nodes[i].lastTextWidth = -1;
    else __ui_nodes[i].lastTextWidth = 0;
  }
}
extern const uint8_t __ui_font_face_count;

#define UI_NO_PARENT 255

// Forward declarations suppress Arduino's auto-prototyper, which would insert
// prototypes before UIFontFace/UIFontGlyph are declared.
static inline const UIFontFace* ui_font_face(uint8_t id);
static inline const UIFontGlyph* ui_font_glyph(const UIFontFace* face, uint16_t codepoint);
static inline uint8_t ui_font_alpha_at(const UIFontFace* face, const UIFontGlyph* glyph, uint16_t pixelIndex);
static inline uint16_t ui_asset_text_width(const char* text, const UIFontFace* face);
static inline uint8_t ui_asset_text_height(const UIFontFace* face);
static inline uint8_t ui_draw_asset_text(const char* text, int16_t x, int16_t y, uint16_t fg, uint16_t bg, uint8_t antialias, uint8_t fontFace);
static inline uint16_t ui_text_width(const char* text, uint8_t ts, uint8_t fontFace, int8_t letterSpacing);
struct UITextLine;
static inline uint8_t ui_text_next_line(const char** cursor, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, UITextLine* out);
static inline void ui_text_layout_metrics(const char* text, uint16_t maxWidth, uint8_t whiteSpaceMode, uint8_t ts, uint8_t fontFace, int8_t letterSpacing, uint8_t lineHeight, uint16_t* outW, uint16_t* outH);
static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah, int16_t bx, int16_t by, int16_t bw, int16_t bh);
static inline uint8_t ui_is_effectively_visible(uint8_t nodeIdx);
static inline uint8_t ui_node_draws_before(uint8_t a, uint8_t b);
static inline void ui_node_paint_rect(uint8_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH, UIRect* out);
static inline void ui_node_current_paint_rect(uint8_t nodeIdx, UIRect* out);
static inline uint8_t ui_subtree_current_paint_rect(uint8_t nodeIdx, UIRect* out);
static inline void ui_mark_overlapping_higher_layers_dirty(uint8_t nodeIdx);
static inline void ui_mark_overlapping_higher_layers_dirty_for_rect(uint8_t nodeIdx, const UIRect* r);
static inline void ui_set_visible(uint8_t nodeIdx, uint8_t visible);
static inline uint8_t ui_clip_rect_to_rect(UIRect* r, const UIRect* clip);
static inline void ui_fill_rect_clipped(int16_t x, int16_t y, int16_t w, int16_t h, const UIRect* clip, uint16_t color);
static inline void ui_hline_clipped(int16_t x, int16_t y, int16_t w, const UIRect* clip, uint16_t color);
static inline void ui_vline_clipped(int16_t x, int16_t y, int16_t h, const UIRect* clip, uint16_t color);
static inline void ui_draw_rect_outline_clipped(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t style, uint8_t width, const UIRect* clip, uint16_t color);
static inline void ui_draw_node_decoration_clipped(uint8_t nodeIdx, int16_t drawY, const UIRect* clip);
static inline uint8_t ui_repair_current_node_paint_with_parent(uint8_t nodeIdx, UIRect* r);
static inline void ui_draw_node_border(uint8_t i, int16_t drawX, int16_t drawY, uint16_t color);
static inline void ui_draw_node_outline(uint8_t i, int16_t drawX, int16_t drawY);
static inline void ui_draw_gradient_fill(uint8_t i, int16_t drawY);
static inline uint8_t ui_rotation_quadrant(int16_t deg);
static inline int16_t ui_rotated_face_w(uint8_t nodeIdx, int16_t w, int16_t h);
static inline int16_t ui_rotated_face_h(uint8_t nodeIdx, int16_t w, int16_t h);
static inline void ui_draw_image_rotated(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg);
static inline void ui_draw_image_with_fit(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                          uint8_t fitMode, int16_t targetW, int16_t targetH);
static inline void ui_draw_scaled_image(const UIImage* img, int16_t x, int16_t y, int16_t rotateDeg,
                                         int16_t drawW, int16_t drawH);

static CuttlefishDisplayTarget* __ui_gfx = display_defaultTarget();
static CuttlefishCanvas16* __ui_scroll_canvas = nullptr;
static CuttlefishCanvas16* __ui_scroll_repaint_canvas = nullptr;

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
static inline void ui_display_draw_pixel(int16_t x, int16_t y, uint16_t color) {
  display_targetDrawPixel(__ui_gfx, x, y, color);
}
static inline void ui_display_draw_rgb_bitmap(int16_t x, int16_t y, const uint16_t* bitmap, int16_t w, int16_t h) {
  display_targetDrawRGBBitmap(__ui_gfx, x, y, bitmap, w, h);
}
static inline void ui_display_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  display_targetFillRect(__ui_gfx, x, y, w, h, color);
}
static inline void ui_display_draw_fast_hline(int16_t x, int16_t y, int16_t w, uint16_t color) {
  display_targetDrawFastHLine(__ui_gfx, x, y, w, color);
}
static inline void ui_display_draw_fast_vline(int16_t x, int16_t y, int16_t h, uint16_t color) {
  display_targetDrawFastVLine(__ui_gfx, x, y, h, color);
}
static inline void ui_display_fill_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  display_targetFillRoundRect(__ui_gfx, x, y, w, h, r, color);
}
static inline void ui_display_draw_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  display_targetDrawRect(__ui_gfx, x, y, w, h, color);
}
static inline void ui_display_draw_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  display_targetDrawRoundRect(__ui_gfx, x, y, w, h, r, color);
}
static inline void ui_display_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
  display_targetDrawLine(__ui_gfx, x0, y0, x1, y1, color);
}
static inline void ui_display_fill_circle(int16_t x, int16_t y, int16_t r, uint16_t color) {
  display_targetFillCircle(__ui_gfx, x, y, r, color);
}
static inline void ui_display_draw_circle(int16_t x, int16_t y, int16_t r, uint16_t color) {
  display_targetDrawCircle(__ui_gfx, x, y, r, color);
}
static inline void ui_display_set_cursor(int16_t x, int16_t y) {
  display_targetSetCursor(__ui_gfx, x, y);
}
static inline void ui_display_set_text_color(uint16_t fg, uint16_t bg) {
  display_targetSetTextColorBg(__ui_gfx, fg, bg);
}
static inline void ui_display_set_text_color_solid(uint16_t fg) {
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

static inline void ui_invalidate_scroll_cache() {
  __ui_scroll_cache_valid = 0;
  __ui_scroll_cache_node = -1;
}

static inline void ui_invalidate_scroll_cache_for_node(uint8_t nodeIdx) {
  if (!__ui_scroll_cache_valid || __ui_scroll_cache_node < 0) return;
  if (nodeIdx >= __ui_node_count) return;
  uint8_t cacheNode = (uint8_t)__ui_scroll_cache_node;
  if (nodeIdx == cacheNode) {
    ui_invalidate_scroll_cache();
    return;
  }
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (p == cacheNode) {
      ui_invalidate_scroll_cache();
      return;
    }
    p = __ui_nodes[p].parent;
  }
}

// Get (or allocate) a canvas sized to the viewport (w×h), not the full
// display. Much smaller allocation → allocates reliably on ESP32 without PSRAM.
static inline CuttlefishCanvas16* ui_get_scroll_canvas_keep_cache(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_scroll_canvas || display_canvasWidth(__ui_scroll_canvas) != w || display_canvasHeight(__ui_scroll_canvas) != h) {
    ui_invalidate_scroll_cache();
    display_deleteCanvas(__ui_scroll_canvas);
    __ui_scroll_canvas = display_createCanvas(w, h);
  }
  if (!__ui_scroll_canvas || !display_canvasBuffer(__ui_scroll_canvas)) {
    ui_invalidate_scroll_cache();
    return nullptr;
  }
  return __ui_scroll_canvas;
}

static inline CuttlefishCanvas16* ui_get_scroll_canvas(int16_t w, int16_t h) {
  ui_invalidate_scroll_cache();
  return ui_get_scroll_canvas_keep_cache(w, h);
}

static inline CuttlefishCanvas16* ui_get_scroll_repaint_canvas(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_scroll_repaint_canvas ||
      display_canvasWidth(__ui_scroll_repaint_canvas) != w ||
      display_canvasHeight(__ui_scroll_repaint_canvas) != h) {
    display_deleteCanvas(__ui_scroll_repaint_canvas);
    __ui_scroll_repaint_canvas = display_createCanvas(w, h);
  }
  if (!__ui_scroll_repaint_canvas || !display_canvasBuffer(__ui_scroll_repaint_canvas)) return nullptr;
  return __ui_scroll_repaint_canvas;
}

static inline void ui_shift_scroll_canvas(CuttlefishCanvas16* canvas, int16_t deltaY, uint16_t bg,
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

  uint16_t* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  int16_t contentW = w > 4 ? w - 4 : w;
  if (contentW > 0) {
    if (deltaY > 0) {
      for (int16_t row = 0; row < h - shift; row++) {
        memmove(pixels + (int32_t)row * stride,
                pixels + (int32_t)(row + shift) * stride,
                (size_t)contentW * sizeof(uint16_t));
      }
      if (exposedY) *exposedY = h - shift;
    } else {
      for (int16_t row = h - shift - 1; row >= 0; row--) {
        memmove(pixels + (int32_t)(row + shift) * stride,
                pixels + (int32_t)row * stride,
                (size_t)contentW * sizeof(uint16_t));
      }
      if (exposedY) *exposedY = 0;
    }
  }

  int16_t y = deltaY > 0 ? h - shift : 0;
  display_canvasFillRect(canvas, 0, y, w, shift, bg);
  if (w > contentW) {
    display_canvasFillRect(canvas, contentW, 0, w - contentW, h, bg);
  }
  if (exposedH) *exposedH = shift;
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

static inline int16_t ui_rotated_face_w(uint8_t nodeIdx, int16_t w, int16_t h) {
  if (__ui_nodes[nodeIdx].kind != NODE_IMG &&
      !(__ui_nodes[nodeIdx].kind == NODE_FILL && __ui_nodes[nodeIdx].gradientEnabled == 0)) return w;
  uint8_t q = ui_rotation_quadrant(__ui_nodes[nodeIdx].rotateDeg);
  return (q == 1 || q == 3) ? h : w;
}

static inline int16_t ui_rotated_face_h(uint8_t nodeIdx, int16_t w, int16_t h) {
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
  for (int16_t ty = 0; ty < targetH; ty++) {
    int16_t localY = ty - offY;
    if (localY < 0 || localY >= drawH) continue;
    int16_t srcY = ((int32_t)localY * srcH) / drawH;
    if (srcY < 0) srcY = 0;
    if (srcY >= srcH) srcY = srcH - 1;
    for (int16_t tx = 0; tx < targetW; tx++) {
      int16_t localX = tx - offX;
      if (localX < 0 || localX >= drawW) continue;
      int16_t srcX = ((int32_t)localX * srcW) / drawW;
      if (srcX < 0) srcX = 0;
      if (srcX >= srcW) srcX = srcW - 1;
      uint16_t color = img->data[(int32_t)srcY * srcW + srcX];
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
  if (q == 0) {
    // Simple case: no rotation, draw with scaling
    if (drawW == img->w && drawH == img->h) {
      ui_display_draw_rgb_bitmap(x, y, img->data, img->w, img->h);
    } else {
      // Scale using nearest-neighbor
      for (int16_t dy = 0; dy < drawH; dy++) {
        int16_t srcY = ((int32_t)dy * img->h) / drawH;
        for (int16_t dx = 0; dx < drawW; dx++) {
          int16_t srcX = ((int32_t)dx * img->w) / drawW;
          uint16_t color = img->data[(int32_t)srcY * img->w + srcX];
          ui_display_draw_pixel(x + dx, y + dy, color);
        }
      }
    }
    return;
  }
  for (int16_t dy = 0; dy < drawH; dy++) {
    int16_t srcY = ((int32_t)dy * img->h) / drawH;
    for (int16_t dx = 0; dx < drawW; dx++) {
      int16_t srcX = ((int32_t)dx * img->w) / drawW;
      uint16_t color = img->data[(int32_t)srcY * img->w + srcX];
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
   if (q == 0) {
     ui_display_draw_rgb_bitmap(x, y, img->data, img->w, img->h);
     return;
   }
   for (uint16_t sy = 0; sy < img->h; sy++) {
     for (uint16_t sx = 0; sx < img->w; sx++) {
       uint16_t color = img->data[(uint32_t)sy * img->w + sx];
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

// Draw offset: when non-zero, all __ui_gfx draw calls subtract this from
// display coords to produce canvas-local coords. Set when redirecting to a
// viewport-sized canvas; reset to 0 for direct-display draws.
static int16_t __ui_draw_off_x = 0;
static int16_t __ui_draw_off_y = 0;

static inline void ui_push_canvas_rect(CuttlefishCanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  uint16_t* pixels = display_canvasBuffer(canvas);
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
  uint16_t* pixels = display_canvasBuffer(canvas);
  int16_t stride = display_canvasWidth(canvas);
  if (w == stride && h == display_canvasHeight(canvas)) {
    ui_display_draw_rgb_bitmap(x, y, pixels, w, h);
    return;
  }
  for (int16_t row = 0; row < h; row++) {
    ui_display_draw_rgb_bitmap(x, y + row, pixels + (int32_t)row * stride, w, 1);
  }
}

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  ui_invalidate_scroll_cache_for_node(nodeIdx);
  __ui_nodes[nodeIdx].dirty = 1;
  ui_mark_overlapping_higher_layers_dirty(nodeIdx);
}

// Set dirty=1 across a scroll subtree WITHOUT the per-child O(n) overlap repair.
// During scroll the subtree repaints into a freshly-cleared off-screen canvas, so
// intra-subtree overlap repair is pointless, and scroll children are draw-clipped
// to the container's viewport box — so all external higher-z neighbors of the
// viewport are covered by ONE overlap check at the container's paint rect (done by
// the caller). This drops scroll marking from O(K·n) to O(K + n).
static inline void ui_mark_subtree_dirty_local(uint8_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  for (uint8_t c = scrollNode + 1; c < __ui_nodes[scrollNode].subtreeEnd; c++) {
    __ui_nodes[c].dirty = 1;
  }
  __ui_nodes[scrollNode].dirty = 1;
}

static inline void ui_mark_scroll_view_overlaps_dirty(uint8_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  if (!ui_is_effectively_visible(scrollNode)) return;
  if (__ui_nodes[scrollNode].screenId != __ui_active_screen) return;
  UIRect r;
  ui_node_current_paint_rect(scrollNode, &r);
  if (r.w <= 0 || r.h <= 0) return;
  for (uint8_t c = 0; c < __ui_node_count; c++) {
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

static inline void ui_mark_scroll_subtree_dirty(uint8_t scrollNode) {
  ui_invalidate_scroll_cache();
  ui_mark_subtree_dirty_local(scrollNode);
  // Single overlap check at the container's paint rect covers every external
  // higher-z neighbor of the viewport. The container index is the right one to
  // pass: scroll content lives within the container's stacking context, so
  // ui_node_draws_before(scrollNode, c) selects exactly the external layers that
  // should be repaired when the viewport is repainted.
  ui_mark_overlapping_higher_layers_dirty(scrollNode);
}

static inline void ui_mark_scroll_view_dirty(uint8_t scrollNode) {
  if (scrollNode >= __ui_node_count) return;
  __ui_nodes[scrollNode].dirty = 1;
  ui_mark_scroll_view_overlaps_dirty(scrollNode);
}

static inline uint8_t ui_snap_scroll_to_top(int8_t scrollNode, uint8_t force) {
  if (scrollNode < 0) return 0;
  if (!force && __ui_nodes[scrollNode].scrollY > UI_SCROLL_EDGE_SNAP_PX) return 0;
  uint8_t changed = __ui_nodes[scrollNode].scrollY != 0;
  __ui_nodes[scrollNode].scrollY = 0;
  // Force redraw even when scrollY is already 0: a pull beyond the top can leave
  // stale clipped children on incremental displays if the final delta is ignored.
  if (changed || force) {
    ui_mark_scroll_subtree_dirty((uint8_t)scrollNode);
    return 1;
  }
  return 0;
}

static inline int8_t ui_scroll_ancestor_for_node(uint8_t nodeIdx) {
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) return (int8_t)p;
    p = __ui_nodes[p].parent;
  }
  return -1;
}

static inline uint8_t ui_apply_scroll_delta(int8_t scrollNode, int16_t dy) {
  if (scrollNode < 0) return 0;
  int16_t maxScroll = __ui_nodes[scrollNode].contentHeight - __ui_nodes[scrollNode].box.h;
  if (maxScroll < 0) maxScroll = 0;
  int16_t prevScrollY = __ui_nodes[scrollNode].scrollY;
  int32_t rawNextY = (int32_t)prevScrollY - (int32_t)dy;
  if (dy > 0 && rawNextY <= 0) __ui_scroll_snap_top = 1;
  int16_t nextScrollY = constrain(rawNextY, 0, maxScroll);
  if (nextScrollY == prevScrollY) return 0;
  __ui_nodes[scrollNode].scrollY = nextScrollY;
  ui_mark_scroll_view_dirty((uint8_t)scrollNode);
  return 1;
}

static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah,
                                         int16_t bx, int16_t by, int16_t bw, int16_t bh) {
  return ax + aw > bx && ax < bx + bw && ay + ah > by && ay < by + bh;
}

static inline int16_t ui_scroll_scaled_drag_delta(int16_t dy) {
  int16_t mult = (int16_t)UI_SCROLL_DRAG_MULTIPLIER;
  if (mult <= 0) return dy;
  int32_t scaled = (int32_t)dy * (int32_t)mult;
  if (scaled > 32767) return 32767;
  if (scaled < -32768) return -32768;
  return (int16_t)scaled;
}

static inline int16_t ui_scroll_saturating_add(int16_t a, int16_t b) {
  int32_t sum = (int32_t)a + (int32_t)b;
  if (sum > 32767) return 32767;
  if (sum < -32768) return -32768;
  return (int16_t)sum;
}

static inline uint8_t ui_is_effectively_visible(uint8_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return 0;
  if (!__ui_nodes[nodeIdx].visible) return 0;
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (!__ui_nodes[p].visible) return 0;
    p = __ui_nodes[p].parent;
  }
  return 1;
}

static inline uint8_t ui_node_draws_before(uint8_t a, uint8_t b) {
  if (__ui_nodes[a].zIndex != __ui_nodes[b].zIndex) {
    return __ui_nodes[a].zIndex < __ui_nodes[b].zIndex;
  }
  return a < b;
}

static inline uint8_t ui_is_ancestor_of(uint8_t candidate, uint8_t nodeIdx) {
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (p == candidate) return 1;
    p = __ui_nodes[p].parent;
  }
  return 0;
}

static inline int16_t ui_pressed_offset_x_for_node(uint8_t nodeIdx) {
  return __ui_nodes[nodeIdx].value > 0 ? __ui_nodes[nodeIdx].pressedOffsetX : 0;
}

static inline int16_t ui_pressed_offset_y_for_node(uint8_t nodeIdx) {
  return __ui_nodes[nodeIdx].value > 0 ? __ui_nodes[nodeIdx].pressedOffsetY : 0;
}

static inline int16_t ui_base_draw_x_for_node(uint8_t nodeIdx) {
  return __ui_nodes[nodeIdx].box.x + __ui_nodes[nodeIdx].transformOffsetX;
}

static inline int16_t ui_draw_x_for_node(uint8_t nodeIdx) {
  return ui_base_draw_x_for_node(nodeIdx) + ui_pressed_offset_x_for_node(nodeIdx);
}

static inline int16_t ui_base_draw_y_for_node(uint8_t nodeIdx) {
  int16_t y = __ui_nodes[nodeIdx].box.y + __ui_nodes[nodeIdx].transformOffsetY;
  uint8_t p = __ui_nodes[nodeIdx].parent;
  while (p != UI_NO_PARENT && p < __ui_node_count) {
    if (__ui_nodes[p].scrollable) y -= __ui_nodes[p].scrollY;
    p = __ui_nodes[p].parent;
  }
  return y;
}

static inline int16_t ui_draw_y_for_node(uint8_t nodeIdx) {
  return ui_base_draw_y_for_node(nodeIdx) + ui_pressed_offset_y_for_node(nodeIdx);
}

static inline uint16_t ui_parent_clear_color(uint8_t nodeIdx) {
  uint8_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    return __ui_nodes[p].hasBg ? __ui_nodes[p].bg : __ui_nodes[p].clearColor;
  }
  return __ui_nodes[nodeIdx].clearColor;
}

static inline void ui_shadow_extents(uint8_t nodeIdx, int16_t* left, int16_t* top, int16_t* right, int16_t* bottom) {
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

static inline void ui_node_paint_rect(uint8_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH, UIRect* out) {
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

static inline void ui_node_current_paint_rect(uint8_t nodeIdx, UIRect* out) {
  const char* displayText = __ui_nodes[nodeIdx].hasTextBinding
    ? __ui_nodes[nodeIdx].textBuffer
    : __ui_nodes[nodeIdx].text;
  uint8_t ts = __ui_nodes[nodeIdx].textSize ? __ui_nodes[nodeIdx].textSize : 2;
  uint16_t textMaxW = __ui_nodes[nodeIdx].box.w;
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    textMaxW = __ui_nodes[nodeIdx].box.w > 22 ? __ui_nodes[nodeIdx].box.w - 22 : 0;
  }
  uint16_t tw = 0;
  uint16_t th = 0;
  ui_text_layout_metrics(displayText, textMaxW, __ui_nodes[nodeIdx].whiteSpaceMode, ts,
    __ui_nodes[nodeIdx].fontFace, __ui_nodes[nodeIdx].letterSpacing, __ui_nodes[nodeIdx].lineHeight, &tw, &th);
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

static inline uint8_t ui_subtree_current_paint_rect(uint8_t nodeIdx, UIRect* out) {
  if (nodeIdx >= __ui_node_count) return 0;
  int16_t end = __ui_nodes[nodeIdx].subtreeEnd;
  if (end > __ui_node_count) end = __ui_node_count;
  uint8_t hasRect = 0;
  int16_t x0 = 0;
  int16_t y0 = 0;
  int16_t x1 = 0;
  int16_t y1 = 0;
  for (uint8_t c = nodeIdx; c < end; c++) {
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

static inline void ui_mark_overlapping_higher_layers_dirty(uint8_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  if (!ui_is_effectively_visible(nodeIdx)) return;
  if (__ui_nodes[nodeIdx].screenId != __ui_active_screen) return;
  UIRect r;
  ui_node_current_paint_rect(nodeIdx, &r);
  ui_mark_overlapping_higher_layers_dirty_for_rect(nodeIdx, &r);
}

static inline void ui_mark_overlapping_higher_layers_dirty_for_rect(uint8_t nodeIdx, const UIRect* r) {
  if (nodeIdx >= __ui_node_count || !r) return;
  if (!ui_is_effectively_visible(nodeIdx)) return;
  if (__ui_nodes[nodeIdx].screenId != __ui_active_screen) return;
  if (r->w <= 0 || r->h <= 0) return;
  for (uint8_t c = 0; c < __ui_node_count; c++) {
    if (c == nodeIdx) continue;
    if (__ui_nodes[c].dirty) continue;
    if (!ui_is_effectively_visible(c)) continue;
    if (__ui_nodes[c].screenId != __ui_active_screen) continue;
    if (!ui_node_draws_before(nodeIdx, c)) continue;
    UIRect cr;
    ui_node_current_paint_rect(c, &cr);
    if (cr.w <= 0 || cr.h <= 0) continue;
    if (ui_rects_intersect(r->x, r->y, r->w, r->h, cr.x, cr.y, cr.w, cr.h)) {
      ui_invalidate_scroll_cache_for_node(c);
      __ui_nodes[c].dirty = 1;
    }
  }
}

static inline void ui_clear_press_offset_area(uint8_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint16_t textH) {
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

static inline uint8_t ui_should_buffer_paint(uint8_t nodeIdx, int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_LIST) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_PROGRESS || __ui_nodes[nodeIdx].kind == NODE_RANGE) return 0;
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
  return (uint32_t)w * (uint32_t)h <= UI_MAX_BUFFERED_PAINT_PIXELS;
}

static inline void ui_seed_paint_canvas_for_node(uint8_t nodeIdx, CuttlefishCanvas16* canvas, int16_t canvasX, int16_t canvasY) {
  if (!canvas || !display_canvasBuffer(canvas)) return;
  uint8_t p = __ui_nodes[nodeIdx].parent;
  if (p == UI_NO_PARENT || p >= __ui_node_count) {
    display_canvasFillScreen(canvas, __ui_nodes[nodeIdx].clearColor);
    return;
  }

  uint8_t parentDecorated =
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

  if (__ui_nodes[p].gradientEnabled > 0) {
    ui_draw_gradient_fill(p, localY);
  } else if (__ui_nodes[p].borderRadius > 0 && __ui_nodes[p].hasBg) {
    ui_display_fill_round_rect(__ui_nodes[p].box.x, localY, __ui_nodes[p].box.w, __ui_nodes[p].box.h,
      __ui_nodes[p].borderRadius, __ui_nodes[p].bg);
  } else if (__ui_nodes[p].hasBg) {
    ui_display_fill_rect(__ui_nodes[p].box.x, localY, __ui_nodes[p].box.w, __ui_nodes[p].box.h, __ui_nodes[p].bg);
  }
  if (__ui_nodes[p].borderStyle != 0) {
    uint16_t bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
    ui_draw_node_border(p, __ui_nodes[p].box.x, localY, bColor);
  }
  ui_draw_node_outline(p, __ui_nodes[p].box.x, localY);

  __ui_nodes[p].box.x = origParentX;
  ui_display_set_target(previousGfx);
}

static inline uint8_t ui_repair_current_node_paint_with_parent(uint8_t nodeIdx, UIRect* r) {
  if (!r || r->w <= 0 || r->h <= 0) return 0;
  if ((uint32_t)r->w * (uint32_t)r->h > UI_MAX_BUFFERED_PAINT_PIXELS) return 0;
  CuttlefishCanvas16* repairCanvas = ui_get_scroll_canvas(r->w, r->h);
  if (!repairCanvas) return 0;
  ui_seed_paint_canvas_for_node(nodeIdx, repairCanvas, r->x, r->y);
  ui_display_use_default_target();
  ui_push_canvas_rect(repairCanvas, r->x, r->y, r->w, r->h);
  return 1;
}

static inline uint8_t ui_is_rect_clipped_by_scroll(uint8_t nodeIdx, int16_t drawX, int16_t drawY, int16_t drawW, int16_t drawH) {
  uint8_t p = __ui_nodes[nodeIdx].parent;
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

static inline uint8_t ui_is_clipped_by_scroll(uint8_t nodeIdx, int16_t drawX, int16_t drawY) {
  return ui_is_rect_clipped_by_scroll(nodeIdx, drawX, drawY, __ui_nodes[nodeIdx].box.w, __ui_nodes[nodeIdx].box.h);
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

static inline void ui_fill_rect_clipped(int16_t x, int16_t y, int16_t w, int16_t h, const UIRect* clip, uint16_t color) {
  UIRect r = { x, y, w, h };
  if (!ui_clip_rect_to_rect(&r, clip)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, color);
}

static inline void ui_hline_clipped(int16_t x, int16_t y, int16_t w, const UIRect* clip, uint16_t color) {
  if (w <= 0 || y < clip->y || y >= clip->y + clip->h) return;
  int16_t x0 = x > clip->x ? x : clip->x;
  int16_t x1 = x + w < clip->x + clip->w ? x + w : clip->x + clip->w;
  if (x1 <= x0) return;
  ui_display_draw_fast_hline(x0, y, x1 - x0, color);
}

static inline void ui_vline_clipped(int16_t x, int16_t y, int16_t h, const UIRect* clip, uint16_t color) {
  if (h <= 0 || x < clip->x || x >= clip->x + clip->w) return;
  int16_t y0 = y > clip->y ? y : clip->y;
  int16_t y1 = y + h < clip->y + clip->h ? y + h : clip->y + clip->h;
  if (y1 <= y0) return;
  ui_display_draw_fast_vline(x, y0, y1 - y0, color);
}

static inline void ui_draw_rect_outline_clipped(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t style, uint8_t width, const UIRect* clip, uint16_t color) {
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

static inline void ui_draw_node_decoration_clipped(uint8_t nodeIdx, int16_t drawY, const UIRect* clip) {
  if (nodeIdx >= __ui_node_count) return;
  if (__ui_nodes[nodeIdx].borderStyle != 0) {
    uint16_t bColor = __ui_nodes[nodeIdx].borderColor ? __ui_nodes[nodeIdx].borderColor : __ui_nodes[nodeIdx].fg;
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

static inline void ui_clear_current_node_paint(uint8_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  int8_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  const char* displayText = __ui_nodes[nodeIdx].hasTextBinding
    ? __ui_nodes[nodeIdx].textBuffer
    : __ui_nodes[nodeIdx].text;
  uint8_t ts = __ui_nodes[nodeIdx].textSize ? __ui_nodes[nodeIdx].textSize : 2;
  uint16_t tw = 0;
  uint16_t th = 0;
  uint16_t maxTextW = __ui_nodes[nodeIdx].box.w;
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    maxTextW = __ui_nodes[nodeIdx].box.w > 22 ? __ui_nodes[nodeIdx].box.w - 22 : 0;
  }
  ui_text_layout_metrics(displayText, maxTextW, __ui_nodes[nodeIdx].whiteSpaceMode, ts,
    __ui_nodes[nodeIdx].fontFace, __ui_nodes[nodeIdx].letterSpacing, __ui_nodes[nodeIdx].lineHeight, &tw, &th);
  if (__ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) tw += 22;
  int16_t baseDrawX = ui_base_draw_x_for_node(nodeIdx);
  int16_t baseDrawY = ui_base_draw_y_for_node(nodeIdx);
  int16_t drawX = ui_draw_x_for_node(nodeIdx);
  int16_t drawY = ui_draw_y_for_node(nodeIdx);
  UIRect r;
  ui_node_paint_rect(nodeIdx, baseDrawX, baseDrawY, drawX, drawY, tw, th, &r);
  ui_display_use_default_target();
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[(uint8_t)scrollParent].box.x,
      __ui_nodes[(uint8_t)scrollParent].box.y,
      __ui_nodes[(uint8_t)scrollParent].box.w,
      __ui_nodes[(uint8_t)scrollParent].box.h
    };
    UIRect clipped = r;
    if (!ui_clip_rect_to_rect(&clipped, &clip)) return;
    if (ui_repair_current_node_paint_with_parent(nodeIdx, &clipped)) return;
    ui_fill_rect_clipped(clipped.x, clipped.y, clipped.w, clipped.h, &clip, ui_parent_clear_color(nodeIdx));
    uint8_t p = __ui_nodes[nodeIdx].parent;
    if (p != UI_NO_PARENT && p < __ui_node_count) {
      ui_draw_node_decoration_clipped(p, ui_draw_y_for_node(p), &clip);
    }
    return;
  }
  if (ui_is_rect_clipped_by_scroll(nodeIdx, r.x, r.y, r.w, r.h)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, ui_parent_clear_color(nodeIdx));
  uint8_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    int16_t parentDrawY = ui_draw_y_for_node(p);
    if (__ui_nodes[p].borderStyle != 0) {
      uint16_t bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
      ui_draw_node_border(p, ui_draw_x_for_node(p), parentDrawY, bColor);
    }
    ui_draw_node_outline(p, ui_draw_x_for_node(p), parentDrawY);
  }
}

static inline void ui_clear_subtree_current_paint(uint8_t nodeIdx) {
  if (nodeIdx >= __ui_node_count) return;
  UIRect r;
  if (!ui_subtree_current_paint_rect(nodeIdx, &r)) return;
  ui_display_use_default_target();
  int8_t scrollParent = ui_scroll_ancestor_for_node(nodeIdx);
  if (scrollParent >= 0) {
    UIRect clip = {
      __ui_nodes[(uint8_t)scrollParent].box.x,
      __ui_nodes[(uint8_t)scrollParent].box.y,
      __ui_nodes[(uint8_t)scrollParent].box.w,
      __ui_nodes[(uint8_t)scrollParent].box.h
    };
    UIRect clipped = r;
    if (!ui_clip_rect_to_rect(&clipped, &clip)) return;
    if (ui_repair_current_node_paint_with_parent(nodeIdx, &clipped)) return;
    ui_fill_rect_clipped(clipped.x, clipped.y, clipped.w, clipped.h, &clip, ui_parent_clear_color(nodeIdx));
    uint8_t p = __ui_nodes[nodeIdx].parent;
    if (p != UI_NO_PARENT && p < __ui_node_count) {
      ui_draw_node_decoration_clipped(p, ui_draw_y_for_node(p), &clip);
    }
    return;
  }
  if (ui_repair_current_node_paint_with_parent(nodeIdx, &r)) return;
  ui_display_fill_rect(r.x, r.y, r.w, r.h, ui_parent_clear_color(nodeIdx));
  uint8_t p = __ui_nodes[nodeIdx].parent;
  if (p != UI_NO_PARENT && p < __ui_node_count) {
    int16_t parentDrawY = ui_draw_y_for_node(p);
    if (__ui_nodes[p].borderStyle != 0) {
      uint16_t bColor = __ui_nodes[p].borderColor ? __ui_nodes[p].borderColor : __ui_nodes[p].fg;
      ui_draw_node_border(p, ui_draw_x_for_node(p), parentDrawY, bColor);
    }
    ui_draw_node_outline(p, ui_draw_x_for_node(p), parentDrawY);
  }
}

static inline void ui_set_visible(uint8_t nodeIdx, uint8_t visible) {
  if (nodeIdx >= __ui_node_count) return;
  visible = visible ? 1 : 0;
  if (__ui_nodes[nodeIdx].visible == visible) return;
  ui_invalidate_scroll_cache_for_node(nodeIdx);

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
  for (uint8_t c = nodeIdx; c < end; c++) {
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
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
    __ui_nodes[i].lastTextHeight = 0;
    if (__ui_nodes[i].kind == NODE_PROGRESS || __ui_nodes[i].kind == NODE_RANGE) {
      __ui_nodes[i].lastTextWidth = -1;
    }
  }
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      uint8_t n = __ui_bindings[i].node;
      __ui_nodes[n].hasTextBinding = 1;
      strncpy(__ui_nodes[n].textBuffer, __ui_nodes[n].text ? __ui_nodes[n].text : "", UI_TEXT_BUF);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF] = '\\0';
    }
  }
  // Initialize list state from bindings.
  for (uint8_t i = 0; i < __ui_list_binding_count && __ui_list_count < 4; i++) {
    uint8_t n = __ui_list_bindings[i].node;
    if (n >= __ui_node_count) continue;
    UIListState* ls = &__ui_lists[__ui_list_count];
    ls->nodeIndex = n;
    ls->itemHeight = __ui_nodes[n].listItemHeight > 0 ? __ui_nodes[n].listItemHeight : 24;
    ls->scrollY = 0;
    ls->countFn = __ui_list_bindings[i].countFn;
    ls->itemFn = __ui_list_bindings[i].itemFn;
    ls->tapFn = __ui_list_bindings[i].tapFn;
    ls->itemCount = ls->countFn ? ls->countFn() : 0;
    ls->contentHeight = ls->itemCount * ls->itemHeight;
    __ui_list_count++;
  }
}

// Debounce: ignore press/release events within 50ms of the last edge.
// Mechanical switches bounce (multiple edges in ~5-20ms); without this, the
// transition gets armed/interrupted dozens of times per physical press.
static volatile uint32_t __ui_last_edge_time = 0;
#define UI_DEBOUNCE_MS 50

static inline void ui_set_pressed(uint8_t nodeIdx, uint8_t pressed) {
  __ui_nodes[nodeIdx].value = pressed ? 1 : 0;
  ui_mark_dirty(nodeIdx);
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
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
static inline void ui_on_press(uint8_t nodeIdx) {
  uint32_t now = millis();
  if (now - __ui_last_edge_time < UI_DEBOUNCE_MS) return;
  __ui_last_edge_time = now;
  ui_set_pressed(nodeIdx, 1);
}
static inline void ui_on_release(uint8_t nodeIdx) {
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
extern const uint8_t __ui_pin_watch_count;

// Poll all configured pin-watchers. Called at the start of ui_tick each frame.
// Detects falling edges with natural debounce from the ~16ms frame rate.
static inline void ui_poll_inputs() {
  for (uint8_t i = 0; i < __ui_pin_watch_count; i++) {
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
  uint8_t nodeIndices[8];
  uint8_t count;
};
extern UIRadioGroup __ui_radio_groups[];
extern const uint8_t __ui_radio_group_count;

// Forward-declare the click handler type + tables (defined by the emit layer).
extern void (*__ui_click_handlers[])();
extern void (*__ui_hold_handlers[])();
extern void (*__ui_release_handlers[])();
extern void (*__ui_rangechange_handlers[])();
extern const uint8_t __ui_click_handler_count;
extern const uint8_t __ui_rangechange_handler_count;

// Touch state machine: tracks down → hold → up → click lifecycle
// Touch node/scroll node state is defined near navigation because ui_navigate resets it.
static uint32_t __ui_touch_down_time = 0;  // millis() when touch started
static int16_t __ui_touch_down_y_pos = 0; // Y position when touch started (for tap vs drag detection)
static uint32_t __ui_last_touch_time = 0;  // for debounce (updated on touch down only)
static uint32_t __ui_last_release_time = 0;  // for release debounce
static int16_t __ui_drag_start_x = 0;
static int16_t __ui_drag_start_y = 0;
static uint8_t __ui_is_dragging = 0;     // 1 once movement exceeds threshold
static int8_t __ui_range_node = -1;      // range slider being dragged
// Scroll delta state is defined near navigation because ui_navigate resets it.
static uint32_t __ui_last_scroll_draw_time = 0;

// ── Awaitable tap source (for \`await ui.onTap()\`) ─────────────────────────
// __ui_tap_seq increments on every completed tap (after click/release dispatch);
// async awaiters poll it for change. __ui_tap_node records the node hit by the
// last tap (-1 = empty space / non-interactive area) for per-element awaiters.
// volatile: written in the touch path, read from task .step() polls.
static volatile uint32_t __ui_tap_seq = 0;
static volatile int8_t   __ui_tap_node = -1;
// Keyboard overlay state.
#define UI_KB_MAX 48   // max key cells (4 rows × 11 padded cols + margin)
#define UI_KB_HOLD_MS 600
#define UI_KB_REPEAT_MS 100
#define UI_KB_TEXT_H 24  // height reserved for the preview text row at the top
struct UIKey { char ch; uint8_t special; };  // special: 0=char,1=shift,2=bs,3=ok,4=page
struct UIKeyStyle { uint16_t bg, fg, borderColor; };
static UIRect  __ui_kb_box;
static UIKey   __ui_kb_keys[UI_KB_MAX];
static UIKeyStyle __ui_kb_styles[UI_KB_MAX];
static uint16_t __ui_kb_bg = 0x0000;  // keyboard background (resolved from CSS)
static uint8_t __ui_kb_bs_held = 0;
static uint8_t __ui_kb_dirty = 0;     // 0=clean, 1=full redraw, 2=text row + single key
static int8_t __ui_kb_pressed_key = -1; // key index under the current touch (-1=none)
static int8_t __ui_kb_repaint_key = -1; // key to repaint on a targeted (mode 2) redraw
static int16_t __ui_last_touch_x = 0;
static int16_t __ui_last_touch_y = 0;
// Keyboard function forward declarations (defined in the subsystem block below;
// needed because ui_touch_down/up/handle_touch reference them, AND to suppress
// Arduino's auto-prototyper which would inject prototypes before UIRect is defined).
static inline void ui_kb_insert(char c);
static inline void ui_kb_delete();
static inline void ui_kb_open(uint8_t nodeIdx, uint8_t inputPosition);
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
#define UI_SCROLL_FRAME_MS 16
#define UI_SCROLL_STEP_PX 1

// Hit-test a touch point against all visible nodes (topmost first).
// Returns the node index of the topmost node that BOTH contains the point
// AND has a click handler registered. Returns -1 if none.
static int8_t ui_hit_test(int16_t tx, int16_t ty) {
  int16_t best = -1;
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    int16_t drawX = ui_draw_x_for_node((uint8_t)i);
    int16_t drawY = ui_draw_y_for_node((uint8_t)i);
    if (ui_is_clipped_by_scroll((uint8_t)i, drawX, drawY)) continue;
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      // Skip nodes without any click handler — they're containers, not targets.
      // Exceptions: NODE_RANGE (horizontal drag) and NODE_INPUT (opens keyboard)
      // are always interactive.
      if (__ui_nodes[i].kind == NODE_RANGE || __ui_nodes[i].kind == NODE_INPUT || __ui_nodes[i].kind == NODE_LIST) {
        if (best < 0 || ui_node_draws_before((uint8_t)best, i)) best = i;
        continue;
      }
      if ((uint8_t)i < __ui_click_handler_count &&
          (__ui_click_handlers[i] || __ui_hold_handlers[i] || __ui_release_handlers[i])) {
        if (best < 0 || ui_node_draws_before((uint8_t)best, i)) best = i;
      }
    }
  }
  return (int8_t)best;
}

// Dispatch a handler from the given table if registered for the node.
static void ui_dispatch(void (**table)(), uint8_t count, int8_t node) {
  if (node >= 0 && (uint8_t)node < count && table[node]) {
    table[node]();
  }
}

static inline void ui_open_keyboard_for_input(uint8_t nodeIdx) {
  if (__ui_nodes[nodeIdx].kind != NODE_INPUT || __ui_kb_visible) return;
  // Resolve the input's position in the loader dispatch table by scanning
  // for the Nth NODE_INPUT. (The loader table is indexed by input order.)
  uint8_t inputPos = 0;
  for (uint8_t j = 0; j < nodeIdx; j++) {
    if (__ui_nodes[j].kind == NODE_INPUT) inputPos++;
  }
  ui_kb_open(nodeIdx, inputPos);
}

// Touch down: called when screen is first touched.
static void ui_touch_down(int16_t tx, int16_t ty) {
  int8_t node = ui_hit_test(tx, ty);
  __ui_touch_node = node;
  __ui_touch_state = 1;
  __ui_touch_down_time = millis();
  __ui_touch_down_y_pos = ty;
  __ui_drag_start_x = tx;
  __ui_drag_start_y = ty;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  __ui_scroll_pending_dy = 0;
  __ui_scroll_snap_top = 0;
  __ui_scroll_start_y = 0;
  __ui_list_snap_top = 0;
  __ui_list_start_y = 0;
  // Check if the touch is inside a scrollable container
  int16_t bestScroll = -1;
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].scrollable || !ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    int16_t drawX = ui_draw_x_for_node((uint8_t)i);
    int16_t drawY = ui_draw_y_for_node((uint8_t)i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      if (__ui_nodes[i].contentHeight > __ui_nodes[i].box.h) {
        if (bestScroll < 0 || ui_node_draws_before((uint8_t)bestScroll, i)) bestScroll = i;
      }
    }
  }
  __ui_scroll_node = (int8_t)bestScroll;
  if (__ui_scroll_node >= 0) {
    __ui_scroll_start_y = __ui_nodes[(uint8_t)__ui_scroll_node].scrollY;
  }
  // Check if the touch is inside a list node (for list scrolling).
  __ui_list_drag = -1;
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].kind != NODE_LIST || !ui_is_effectively_visible(i)) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    int16_t drawX = ui_draw_x_for_node(i);
    int16_t drawY = ui_draw_y_for_node(i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      for (uint8_t l = 0; l < __ui_list_count; l++) {
        if (__ui_lists[l].nodeIndex == i) { __ui_list_drag = l; __ui_list_start_y = __ui_lists[l].scrollY; break; }
      }
      break;
    }
  }
  if (node >= 0) {
    if (__ui_nodes[node].kind == NODE_BUTTON) {
      ui_set_pressed((uint8_t)node, 1);
    }
    // Track range nodes for horizontal drag
    if (__ui_nodes[node].kind == NODE_RANGE) {
      __ui_range_node = node;
      // Immediately set value from touch position
      int16_t rMin = __ui_nodes[node].rangeMin;
      int16_t rMax = __ui_nodes[node].rangeMax;
      int16_t range = rMax - rMin;
      if (range <= 0) range = 100;
      int16_t relX = tx - ui_draw_x_for_node((uint8_t)node) - 4;
      int16_t usable = __ui_nodes[node].box.w - 8;
      if (usable <= 0) usable = 1;
      __ui_nodes[node].value = rMin + ((int32_t)relX * range) / usable;
      __ui_nodes[node].value = constrain(__ui_nodes[node].value, rMin, rMax);
      ui_mark_dirty(node);
    }
    ui_mark_dirty(node);
  }
}

// Touch up: called when touch is released. Determines click vs hold.
static void ui_touch_up() {
  // Modal keyboard: route tap-up to the keyboard; swallow normal click logic.
  if (__ui_kb_visible) {
    ui_kb_handle_tap(__ui_last_touch_x, __ui_last_touch_y);
    __ui_kb_bs_held = 0;
    __ui_touch_state = 0;
    __ui_last_touch_time = millis();
    return;
  }
  uint32_t elapsed = millis() - __ui_touch_down_time;
  if (__ui_scroll_node >= 0 && __ui_scroll_pending_dy > 0 &&
      (int32_t)__ui_nodes[(uint8_t)__ui_scroll_node].scrollY - (int32_t)__ui_scroll_pending_dy <= 0) {
    __ui_scroll_snap_top = 1;
  }
  if (__ui_scroll_node >= 0 && __ui_scroll_snap_top) {
    if (ui_snap_scroll_to_top(__ui_scroll_node, 1)) {
      __ui_last_scroll_draw_time = millis();
    }
    __ui_scroll_pending_dy = 0;
  } else if (__ui_scroll_node >= 0 && __ui_scroll_pending_dy != 0) {
    if (ui_apply_scroll_delta(__ui_scroll_node, __ui_scroll_pending_dy)) {
      __ui_last_scroll_draw_time = millis();
    }
    __ui_scroll_pending_dy = 0;
  }
  if (__ui_scroll_node >= 0 &&
      __ui_scroll_start_y > UI_SCROLL_EDGE_SNAP_PX &&
      __ui_nodes[(uint8_t)__ui_scroll_node].scrollY <= UI_SCROLL_EDGE_SNAP_PX) {
    if (ui_snap_scroll_to_top(__ui_scroll_node, 0)) {
      __ui_last_scroll_draw_time = millis();
    }
  }
  if (__ui_touch_node >= 0 && !__ui_is_dragging) {
    int8_t clickedNode = __ui_touch_node;
    if (elapsed < UI_TOUCH_HOLD_MS) {
      if (__ui_nodes[clickedNode].kind == NODE_INPUT) {
        ui_open_keyboard_for_input((uint8_t)clickedNode);
      }
      ui_dispatch(__ui_click_handlers, __ui_click_handler_count, __ui_touch_node);
    }
    ui_dispatch(__ui_release_handlers, __ui_click_handler_count, __ui_touch_node);
    if (__ui_nodes[clickedNode].kind == NODE_BUTTON) {
      ui_set_pressed((uint8_t)clickedNode, 0);
    }
    ui_mark_dirty(clickedNode);
  }
  // Resume any \`await ui.onTap()\` awaiter. Runs for EVERY completed tap —
  // including holds (released above) and taps on empty space (__ui_touch_node
  // == -1), which is what makes "wake on any touch" work for display-sleep.
  // Placed AFTER the click/release dispatch so onClick always fires first.
  __ui_tap_seq++;
  __ui_tap_node = __ui_touch_node;
  // List item tap: if the touch was inside a list, compute item index.
  // Use total movement (not drag flag) to distinguish tap from scroll:
  // a tap moves < itemHeight/2 total; a scroll moves more.
  if (__ui_list_drag >= 0 && __ui_is_dragging) {
    UIListState* ls = &__ui_lists[__ui_list_drag];
    if (__ui_list_snap_top ||
        (__ui_list_start_y > UI_SCROLL_EDGE_SNAP_PX && ls->scrollY <= UI_SCROLL_EDGE_SNAP_PX)) {
      ls->scrollY = 0;
      ui_mark_dirty(ls->nodeIndex);
    }
  }
  if (__ui_list_drag >= 0) {
    UIListState* ls = &__ui_lists[__ui_list_drag];
    if (ls->tapFn) {
      uint8_t n = ls->nodeIndex;
      int16_t drawY = ui_draw_y_for_node(n);
      int16_t relY = __ui_last_touch_y - drawY;
      int16_t totalMove = abs(__ui_last_touch_y - __ui_touch_down_y_pos);
      if (totalMove < (int16_t)(ls->itemHeight / 2) &&
          relY >= 0 && relY < __ui_nodes[n].box.h) {
        uint16_t itemIdx = (uint16_t)((relY + ls->scrollY) / ls->itemHeight);
        if (itemIdx < ls->itemCount) {
          ls->tapFn(itemIdx);
        }
      }
    }
  }
  __ui_touch_state = 0;
  __ui_touch_node = -1;
  __ui_is_dragging = 0;
  __ui_scroll_node = -1;
  __ui_list_drag = -1;
  __ui_range_node = -1;
  __ui_scroll_pending_dy = 0;
  __ui_scroll_snap_top = 0;
  __ui_scroll_start_y = 0;
  __ui_list_snap_top = 0;
  __ui_list_start_y = 0;
}

// Called each frame from ui_poll_touch when touch is detected.
// Implements debounce + the down/hold/up/click state machine.
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  uint32_t now = millis();
  // Track last touch coords for tap-up routing.
  __ui_last_touch_x = tx;
  __ui_last_touch_y = ty;

  // Modal keyboard: if visible, route touch to the keyboard only.
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

  if (__ui_touch_state == 0) {
    // Idle: check debounce, then start touch
    if (now - __ui_last_touch_time < UI_TOUCH_DEBOUNCE_MS) return;
    ui_touch_down(tx, ty);
  } else {
    // Already touching: check for drag or hold
    if (!__ui_is_dragging && (__ui_scroll_node >= 0 || __ui_list_drag >= 0)) {
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
      int16_t relX = tx - ui_draw_x_for_node((uint8_t)__ui_range_node) - 4;
      int16_t usable = __ui_nodes[__ui_range_node].box.w - 8;
      if (usable <= 0) usable = 1;
      int16_t newVal = rMin + ((int32_t)relX * range) / usable;
      newVal = constrain(newVal, rMin, rMax);
      if (newVal != __ui_nodes[__ui_range_node].value) {
        __ui_nodes[__ui_range_node].value = newVal;
        ui_mark_dirty(__ui_range_node);
        // Fire the onChange callback (if any) — every value change during drag.
        if ((uint8_t)__ui_range_node < __ui_rangechange_handler_count &&
            __ui_rangechange_handlers[__ui_range_node]) {
          __ui_rangechange_handlers[__ui_range_node]();
        }
      }
    }
    if (__ui_is_dragging && __ui_scroll_node >= 0) {
      // Scroll: accumulate small touch deltas and redraw at a bounded cadence.
      int16_t dy = ui_scroll_scaled_drag_delta(ty - __ui_drag_start_y);
      __ui_drag_start_y = ty;
      __ui_scroll_pending_dy = ui_scroll_saturating_add(__ui_scroll_pending_dy, dy);
      if (__ui_scroll_pending_dy > 0 &&
          (int32_t)__ui_nodes[(uint8_t)__ui_scroll_node].scrollY - (int32_t)__ui_scroll_pending_dy <= 0) {
        __ui_scroll_snap_top = 1;
      }
      if (abs(__ui_scroll_pending_dy) >= UI_SCROLL_STEP_PX &&
          now - __ui_last_scroll_draw_time >= UI_SCROLL_FRAME_MS) {
        ui_apply_scroll_delta(__ui_scroll_node, __ui_scroll_pending_dy);
        __ui_scroll_pending_dy = 0;
        __ui_last_scroll_draw_time = now;
      }
    }
    // List scroll: apply drag delta to the active list's scrollY.
    if (__ui_is_dragging && __ui_list_drag >= 0) {
      int16_t dy = ui_scroll_scaled_drag_delta(ty - __ui_drag_start_y);
      __ui_drag_start_y = ty;
      UIListState* ls = &__ui_lists[__ui_list_drag];
      int16_t maxScroll = ls->contentHeight - __ui_nodes[ls->nodeIndex].box.h;
      if (maxScroll < 0) maxScroll = 0;
      int32_t rawNextY = (int32_t)ls->scrollY - (int32_t)dy;
      if (dy > 0 && rawNextY <= 0) __ui_list_snap_top = 1;
      int16_t nextY = constrain(rawNextY, 0, maxScroll);
      if (nextY != (int16_t)ls->scrollY) {
        ls->scrollY = nextY;
        ui_mark_dirty(ls->nodeIndex);
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
  uint8_t fr = (fg >> 11) & 0x1F, fg5 = (fg >> 5) & 0x3F, fb = fg & 0x1F;
  uint8_t br = (bg >> 11) & 0x1F, bg5 = (bg >> 5) & 0x3F, bb = bg & 0x1F;
  uint8_t r = (fr * opacity + br * (100 - opacity)) / 100;
  uint8_t g = (fg5 * opacity + bg5 * (100 - opacity)) / 100;
  uint8_t b = (fb * opacity + bb * (100 - opacity)) / 100;
  return (r << 11) | (g << 5) | b;
}

static inline const UIFontFace* ui_font_face(uint8_t id) {
   if (id == 0) return nullptr;
   for (uint8_t i = 0; i < __ui_font_face_count; i++) {
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
  return c == ' ' || c == '\\t' || c == '\\f' || c == '\\v';
}

static inline uint8_t ui_is_text_newline(char c) {
  return c == '\\n' || c == '\\r';
}

static inline const char* ui_after_text_newline(const char* p) {
  if (!p || !*p) return p;
  if (*p == '\\r' && p[1] == '\\n') return p + 2;
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

static inline void ui_copy_text_span(const char* start, const char* end, char* out, uint8_t outSize) {
  if (!out || outSize == 0) return;
  uint8_t len = 0;
  while (start && end && start < end && *start && len + 1 < outSize) {
    out[len++] = *start++;
  }
  out[len] = 0;
}

static inline uint8_t ui_draw_asset_text(const char* text, int16_t x, int16_t y, uint16_t fg, uint16_t bg, uint8_t antialias, uint8_t fontFace) {
  const UIFontFace* face = ui_font_face(fontFace);
  if (!text || !face) return 0;
  int16_t cursor = x;
  int16_t baseline = y + face->baseline;
  const unsigned char* p = (const unsigned char*)text;
  while (*p) {
    uint16_t codepoint = ui_next_utf8_codepoint(&p);
    const UIFontGlyph* glyph = ui_font_glyph(face, codepoint);
    if (!glyph) {
      cursor += face->lineHeight / 2;
      continue;
    }
    for (uint8_t gy = 0; gy < glyph->height; gy++) {
      for (uint8_t gx = 0; gx < glyph->width; gx++) {
        uint16_t pixelIndex = (uint16_t)gy * glyph->width + gx;
        uint8_t alpha = ui_font_alpha_at(face, glyph, pixelIndex);
        if (alpha == 0) continue;
        int16_t dx = cursor + glyph->xOffset + gx;
        int16_t dy = baseline + glyph->yOffset + gy;
        if (antialias) {
          if (fg == bg) {
            // Transparent mode: can't blend (fg==bg → all alphas become fg).
            // Use a threshold so only high-coverage pixels draw, avoiding
            // the bumpy look from flattening sub-pixel coverage to solid.
            if (alpha >= 8) ui_display_draw_pixel(dx, dy, fg);
          } else {
            ui_display_draw_pixel(dx, dy, alpha >= 15 ? fg : ui_blend565(fg, bg, (uint8_t)((uint16_t)alpha * 100 / 15)));
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

static inline void ui_draw_bitmap_text(const char* text, int16_t x, int16_t y, uint16_t fg, uint16_t bg, uint8_t ts, int8_t letterSpacing) {
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

 static inline uint8_t ui_text_fg_neighbors(CuttlefishCanvas16* src, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t fg, uint8_t radius = 1) {
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

static inline void ui_draw_aa_text(const char* text, int16_t x, int16_t y, uint16_t fg, uint16_t bg, uint8_t ts) {
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

// Use pre-allocated static canvases (no dynamic allocation)
   CuttlefishCanvas16* src = ui_text_canvas(&__ui_text_src_canvas, (int16_t)w, (int16_t)h);
   CuttlefishCanvas16* dst = ui_text_canvas(&__ui_text_dst_canvas, (int16_t)w, (int16_t)h);
   if (!src || !dst || !display_canvasBuffer(src) || !display_canvasBuffer(dst)) {
     ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
     return;
   }

   display_canvasFillRect(src, 0, 0, w, h, bg);
   display_canvasFillRect(dst, 0, 0, w, h, bg);
   display_targetSetCursor((CuttlefishDisplayTarget*)src, 0, 0);
   display_targetSetTextColorBg((CuttlefishDisplayTarget*)src, fg, bg);
   display_targetSetTextSize((CuttlefishDisplayTarget*)src, ts);
   display_targetSetTextWrap((CuttlefishDisplayTarget*)src, false);
   display_targetPrint((CuttlefishDisplayTarget*)src, text);

   for (int16_t yy = 0; yy < (int16_t)h; yy++) {
     for (int16_t xx = 0; xx < (int16_t)w; xx++) {
       uint16_t px = display_canvasGetPixel(src, xx, yy);
       uint8_t neighbors = ui_text_fg_neighbors(src, xx, yy, (int16_t)w, h, fg);
       uint8_t outerNeighbors = 0;
       if (ts >= 3 && px != fg && neighbors == 0) {
         outerNeighbors = ui_text_fg_neighbors(src, xx, yy, (int16_t)w, h, fg, 2);
       }
       uint8_t coverage = ui_text_aa_coverage(neighbors, outerNeighbors, px == fg ? 1 : 0, ts);
       display_targetDrawPixel((CuttlefishDisplayTarget*)dst, xx, yy, coverage == 0 ? bg : ui_blend565(fg, bg, coverage));
     }
   }

   int16_t stride = display_canvasWidth(dst);
   uint16_t* pixels = display_canvasBuffer(dst);
   for (int16_t row = 0; row < (int16_t)h; row++) {
     ui_display_draw_rgb_bitmap(x, y + row, pixels + (int32_t)row * stride, (int16_t)w, 1);
   }
 }

static inline void ui_draw_text(const char* text, int16_t x, int16_t y, uint16_t fg, uint16_t bg, uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing) {
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
static inline void ui_draw_text(const char* text, int16_t x, int16_t y, uint16_t fg, uint16_t bg, uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing) {
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

static inline void ui_draw_wrapped_text(const char* text, int16_t x, int16_t y, uint16_t maxWidth, uint16_t fg, uint16_t bg,
                                        uint8_t ts, uint8_t antialias, uint8_t fontFace, int8_t letterSpacing,
                                        uint8_t lineHeight, uint8_t whiteSpaceMode, uint8_t textAlign, uint8_t underline, uint8_t textOverflow) {
  if (!text) text = "";
  uint8_t lh = ui_text_line_height(ts, fontFace, lineHeight);
  const char* cursor = text;
  int16_t lineY = y;
  UITextLine line;
  char lineBuf[UI_TEXT_LINE_BUF];
  while (ui_text_next_line(&cursor, maxWidth, whiteSpaceMode, ts, fontFace, letterSpacing, &line)) {
    int16_t lineX = x;
    if (textAlign == 1) lineX = x + ((int16_t)maxWidth - (int16_t)line.width) / 2;
    else if (textAlign == 2) lineX = x + (int16_t)maxWidth - (int16_t)line.width;
    ui_copy_text_span(line.start, line.end, lineBuf, UI_TEXT_LINE_BUF);
    // text-overflow: ellipsis — if this line is wider than maxWidth,
    // truncate the copied span and append three dots to fit.
    if (textOverflow && (int16_t)line.width > (int16_t)maxWidth) {
      ui_truncate_ellipsis(lineBuf, UI_TEXT_LINE_BUF, maxWidth, ts, fontFace, letterSpacing);
    }
    ui_draw_text(lineBuf, lineX, lineY, fg, bg, ts, antialias, fontFace, letterSpacing);
    // text-decoration (underline=bit0, strikethrough=bit1)
    if (underline & 1) ui_display_draw_fast_hline(lineX, lineY + ui_text_height(ts, fontFace) - 1, line.width, fg);
    if (underline & 2) ui_display_draw_fast_hline(lineX, lineY + ui_text_height(ts, fontFace) / 2, line.width, fg);
    lineY += lh;
  }
}

// Draw shadows for an element. Loops over up to 4 shadow specs. Outset shadows
// are drawn behind the element; inset shadows are drawn over the element fill.
// Draw a gradient fill for an element. Replaces solid fillRect/fillRoundRect.
static inline void ui_draw_gradient_fill(uint8_t i, int16_t drawY) {
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = drawY;
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  uint16_t c1 = __ui_nodes[i].gradientColor1;
  uint16_t c2 = __ui_nodes[i].gradientColor2;
  uint8_t dir = __ui_nodes[i].gradientEnabled;  // 1=vertical, 2=horizontal
  if (dir == 1) {
    // Vertical: top=c1, bottom=c2. Draw row by row.
    for (int16_t y = 0; y < bh; y++) {
      uint8_t op = (uint8_t)((uint16_t)y * 100 / (bh > 1 ? bh - 1 : 1));
      uint16_t col = ui_blend565(c1, c2, op);
      ui_display_draw_fast_hline(bx, by + y, bw, col);
    }
  } else {
    // Horizontal: left=c1, right=c2. Draw column by column.
    for (int16_t x = 0; x < bw; x++) {
      uint8_t op = (uint8_t)((uint16_t)x * 100 / (bw > 1 ? bw - 1 : 1));
      uint16_t col = ui_blend565(c1, c2, op);
      ui_display_draw_fast_vline(bx + x, by, bh, col);
    }
  }
}

static inline void ui_draw_shadow(uint8_t i, int16_t drawY, uint8_t insetOnly) {
  if (__ui_nodes[i].shadowCount == 0) return;
  int16_t bx = __ui_nodes[i].box.x;
  int16_t by = drawY;
  int16_t bw = __ui_nodes[i].box.w;
  int16_t bh = __ui_nodes[i].box.h;
  uint16_t clearCol = __ui_nodes[i].clearColor;
  uint8_t radius = __ui_nodes[i].borderRadius;

  for (uint8_t s = 0; s < __ui_nodes[i].shadowCount && s < 4; s++) {
    if (s >= __ui_nodes[i].shadowCount) continue;  // use count, not color check (0 is valid black)
    uint16_t shadowCol = __ui_nodes[i].shadowColor[s];
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
      uint16_t insetBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
      uint16_t col = ui_blend565(shadowCol, insetBg, baseAlpha);
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
      uint16_t col = ui_blend565(shadowCol, inset ? (__ui_nodes[i].hasBg ? __ui_nodes[i].bg : clearCol) : clearCol, opacity);
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

static inline void ui_draw_closed_round_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t radius, uint16_t color) {
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

static inline void ui_draw_rect_outline(int16_t x, int16_t y, int16_t w, int16_t h, uint8_t radius, uint8_t style, uint8_t width, uint16_t color) {
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

static inline void ui_draw_node_border(uint8_t i, int16_t drawX, int16_t drawY, uint16_t color) {
  ui_draw_rect_outline(drawX, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h,
    __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, color);
}

static inline void ui_draw_node_outline(uint8_t i, int16_t drawX, int16_t drawY) {
  if (__ui_nodes[i].outlineStyle == 0 || __ui_nodes[i].outlineWidth == 0) return;
  uint8_t w = __ui_nodes[i].outlineWidth;
  ui_draw_rect_outline(drawX - w, drawY - w,
    __ui_nodes[i].box.w + 2 * w, __ui_nodes[i].box.h + 2 * w,
    __ui_nodes[i].borderRadius + w, __ui_nodes[i].outlineStyle, w, __ui_nodes[i].outlineColor);
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
  // ⓪ Evaluate bindings: call each binding's fn, compare to the node's
  // current property value, mark dirty if changed.
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text binding: fill the node's buffer, compare content, mark dirty if changed.
      uint8_t n = __ui_bindings[i].node;
      char oldBuf[UI_TEXT_BUF + 1];
      strncpy(oldBuf, __ui_nodes[n].textBuffer, UI_TEXT_BUF);
      oldBuf[UI_TEXT_BUF] = '\\0';
      __ui_bindings[i].textFn(__ui_nodes[n].textBuffer, UI_TEXT_BUF + 1);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF] = '\\0';
      if (strcmp(oldBuf, __ui_nodes[n].textBuffer) != 0) {
        ui_mark_dirty(n);
      }
    } else if (__ui_bindings[i].fn) {
      // Color/numeric binding
      uint16_t newVal = __ui_bindings[i].fn();
      if (__ui_bindings[i].prop == PROP_VISIBLE) {
        uint8_t nextVisible = newVal ? 1 : 0;
        if (nextVisible != __ui_nodes[__ui_bindings[i].node].visible) {
          ui_set_visible(__ui_bindings[i].node, nextVisible);
        }
        continue;
      }
      if (__ui_bindings[i].prop == PROP_VALUE) {
        // Numeric value binding: drive a progress/range node's value live.
        uint8_t n = __ui_bindings[i].node;
        int16_t v = (int16_t)__ui_bindings[i].fn();
        if (v != __ui_nodes[n].value) {
          __ui_nodes[n].value = v;
          ui_mark_dirty(n);
        }
        continue;
      }
      uint16_t* target = (__ui_bindings[i].prop == PROP_BG) ? &__ui_nodes[__ui_bindings[i].node].bg
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
  // ⓪b Evaluate list bindings: refresh item count, recompute content height.
  for (uint8_t l = 0; l < __ui_list_count; l++) {
    if (!__ui_lists[l].countFn) continue;
    uint16_t newCount = __ui_lists[l].countFn();
    if (newCount != __ui_lists[l].itemCount) {
      __ui_lists[l].itemCount = newCount;
      __ui_lists[l].contentHeight = newCount * __ui_lists[l].itemHeight;
      ui_mark_dirty(__ui_lists[l].nodeIndex);
    }
  }
  // ⓪c Evaluate input bindings (two-way): if a bound <input>'s textBuffer
  // changed since last tick (e.g. the user typed via the on-screen keyboard),
  // fire the author's callback with the new text.
  for (uint8_t i = 0; i < __ui_input_binding_count; i++) {
    if (!__ui_input_bindings[i].cb) continue;
    uint8_t n = __ui_input_bindings[i].node;
    const char* cur = __ui_nodes[n].textBuffer;
    if (strcmp(cur, __ui_input_bindings[i].lastSeen) != 0) {
      strncpy(__ui_input_bindings[i].lastSeen, cur, UI_TEXT_BUF);
      __ui_input_bindings[i].lastSeen[UI_TEXT_BUF] = '\\0';
      __ui_input_bindings[i].cb(cur);
    }
  }
  // ① Advance transitions.
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (!__ui_trans[i].active) continue;
    __ui_trans[i].elapsed += deltaMs;
    uint16_t k = __ui_trans[i].durationMs == 0
      ? 100
      : (uint16_t)((uint32_t)__ui_trans[i].elapsed * 100 / __ui_trans[i].durationMs);
    if (__ui_trans[i].durationMs > 0 && __ui_trans[i].durationMs <= UI_TRANSITION_SNAP_MS) k = 100;
    uint16_t v = lerp_color(__ui_trans[i].prevValue, __ui_trans[i].targetValue, (uint8_t)k);
    if (__ui_trans[i].prop == PROP_FG) {
      __ui_nodes[__ui_trans[i].node].fg = v;
    } else {
      __ui_nodes[__ui_trans[i].node].bg = v;
    }
    ui_mark_dirty(__ui_trans[i].node);
    if (k >= 100) __ui_trans[i].active = 0;
  }

  // ①b Advance @keyframes animations.
  for (uint8_t i = 0; i < __ui_anim_count; i++) {
    if (!__ui_anims[i].active) continue;
    // Skip animations on non-visible screens — their nodes are not drawn,
    // so advancing them would paint stray fragments ("blotches") on the
    // active screen. The animation resumes correctly on navigation back.
    {
      uint8_t animNode = __ui_anims[i].node;
      if (animNode < __ui_node_count && __ui_nodes[animNode].screenId != __ui_active_screen) continue;
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
    // Apply to node — only mark dirty if a value actually changed.
    uint8_t n = __ui_anims[i].node;
    if (n >= __ui_node_count) continue;
    uint8_t changed = 0;
    if ((sLo->props & UI_KF_BG) && (sHi->props & UI_KF_BG)) {
      uint16_t newBg = range > 0 ? lerp_color(sLo->bg, sHi->bg, lerpK) : sLo->bg;
      if (newBg != __ui_nodes[n].bg) { __ui_nodes[n].bg = newBg; __ui_nodes[n].hasBg = 1; changed = 1; }
    }
    if ((sLo->props & UI_KF_FG) && (sHi->props & UI_KF_FG)) {
      uint16_t newFg = range > 0 ? lerp_color(sLo->fg, sHi->fg, lerpK) : sLo->fg;
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
      // Throttle redraws to ~10fps to avoid ILI9341 tearing from rapid SPI writes.
      if (completing || __ui_anims[i].elapsed - __ui_anims[i].lastUpdateMs >= 100) {
        if (geometryChanged) {
          ui_clear_current_node_paint(n);
          __ui_nodes[n].transformOffsetX = nextTransformX;
          __ui_nodes[n].transformOffsetY = nextTransformY;
          __ui_nodes[n].rotateDeg = nextRotateDeg;
          __ui_nodes[n].box.w = nextWidth;
          __ui_nodes[n].box.h = nextHeight;
        }
        ui_mark_dirty(n);
        __ui_anims[i].lastUpdateMs = __ui_anims[i].elapsed;
      }
    }
    if (completing) __ui_anims[i].active = 0;
  }

  // ② Draw dirty nodes directly to the display object.
  // Skip the node draw pass while the keyboard overlay is visible — its opaque
  // background covers everything underneath, so redrawing app nodes wastes SPI
  // bandwidth and causes flashing. Nodes redraw once when the keyboard closes
  // (ui_kb_close marks the edited input dirty; ui_kb_open had marked all dirty
  // on open so they're stale-but-covered while the keyboard is up).
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
  // Process each dirty scroll container. Full invalidations repaint the
  // subtree; normal scroll deltas shift cached canvas rows and repaint only the
  // newly exposed strip.
  int8_t bufferedScrollNode = -1;
  int16_t bufferedScrollVX = 0;  // viewport origin X for coord translation
  int16_t bufferedScrollVY = 0;  // viewport origin Y
  CuttlefishCanvas16* bufferedScrollCanvas = nullptr;
  CuttlefishCanvas16* bufferedScrollRepaintCanvas = nullptr;
  int16_t bufferedScrollRepaintY = 0;
  int16_t bufferedScrollRepaintH = 0;
  for (uint8_t s = 0; s < __ui_node_count; s++) {
    if (!__ui_nodes[s].scrollable || !ui_is_effectively_visible(s)) continue;
    if (__ui_nodes[s].screenId != __ui_active_screen) continue;
    if (__ui_nodes[s].contentHeight <= __ui_nodes[s].box.h) continue;
    if (!__ui_nodes[s].dirty) continue;

    // The scroll canvas is viewport-sized. The setup below either shifts cached
    // pixels for a small delta or falls back to a full subtree redraw.
    int16_t vw = __ui_nodes[s].box.w;
    int16_t vh = __ui_nodes[s].box.h;
    int16_t vox = __ui_nodes[s].box.x;
    int16_t voy = __ui_nodes[s].box.y;
    uint16_t scrollBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
    bufferedScrollCanvas = ui_get_scroll_canvas_keep_cache(vw, vh);
    if (bufferedScrollCanvas) {
      bufferedScrollNode = (int8_t)s;
      bufferedScrollVX = vox;
      bufferedScrollVY = voy;

      int16_t deltaY = 0;
      uint8_t canShift = 0;
      if (__ui_scroll_cache_valid &&
          __ui_scroll_cache_node == (int8_t)s &&
          __ui_scroll_cache_w == vw &&
          __ui_scroll_cache_h == vh) {
        deltaY = __ui_nodes[s].scrollY - __ui_scroll_cache_y;
        int16_t absDelta = deltaY < 0 ? -deltaY : deltaY;
        if (deltaY != 0 && absDelta < vh) canShift = 1;
      }

      if (canShift) {
        int16_t exposedY = 0;
        int16_t exposedH = 0;
        ui_shift_scroll_canvas(bufferedScrollCanvas, deltaY, scrollBg, &exposedY, &exposedH);
        bufferedScrollRepaintCanvas = ui_get_scroll_repaint_canvas(vw, exposedH);
        if (bufferedScrollRepaintCanvas) {
          bufferedScrollRepaintY = exposedY;
          bufferedScrollRepaintH = exposedH;
          display_canvasFillScreen(bufferedScrollRepaintCanvas, scrollBg);
          UIRect exposed = { vox, (int16_t)(voy + exposedY), vw, exposedH };
          for (uint8_t c = s + 1; c < __ui_nodes[s].subtreeEnd; c++) {
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
        for (uint8_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
          __ui_nodes[c].dirty = 1;
          if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
          else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
          __ui_nodes[c].lastTextHeight = 0;
        }
        display_canvasFillScreen(bufferedScrollCanvas, scrollBg);
      }
    } else {
      ui_invalidate_scroll_cache();
      for (uint8_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
        __ui_nodes[c].dirty = 1;
        if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
        else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
        __ui_nodes[c].lastTextHeight = 0;
      }
      ui_display_fill_rect(__ui_nodes[s].box.x, __ui_nodes[s].box.y,
        __ui_nodes[s].box.w, __ui_nodes[s].box.h, scrollBg);
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
    for (uint8_t s = 0; s < __ui_node_count; s++) {
      if (__ui_nodes[s].screenId == __ui_active_screen && __ui_nodes[s].kind == NODE_FILL) {
        fbBg = __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor;
        break;
      }
    }
    display_canvasFillScreen(__ui_fb, fbBg);
  }

  // Draw dirty nodes in stacking order: lower z-index first, then source order.
  for (uint8_t __ui_draw_pass = 0; __ui_draw_pass < __ui_node_count; __ui_draw_pass++) {
    int16_t selected = -1;
    for (uint8_t candidate = 0; candidate < __ui_node_count; candidate++) {
      if (!__ui_nodes[candidate].dirty) continue;
      if (!ui_is_effectively_visible(candidate)) { __ui_nodes[candidate].dirty = 0; continue; }
      if (__ui_nodes[candidate].screenId != __ui_active_screen) { __ui_nodes[candidate].dirty = 0; continue; }
      if (selected < 0 || ui_node_draws_before(candidate, (uint8_t)selected)) selected = candidate;
    }
    if (selected < 0) break;
    uint8_t i = (uint8_t)selected;

    // Redirect to the scroll canvas if this node is inside the buffered container.
    uint8_t drawingBufferedScroll = bufferedScrollNode >= 0 && i > (uint8_t)bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd;
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
    uint16_t textMaxW = __ui_nodes[i].box.w;
    if (__ui_nodes[i].kind == NODE_CHECK || __ui_nodes[i].kind == NODE_RADIO) {
      textMaxW = __ui_nodes[i].box.w > 22 ? __ui_nodes[i].box.w - 22 : 0;
    }
    uint16_t tw = 0;
    uint16_t th = 0;
    ui_text_layout_metrics(displayText, textMaxW, __ui_nodes[i].whiteSpaceMode, ts,
      __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight, &tw, &th);
    uint16_t paintTextW = tw;
    uint16_t paintTextH = th;
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
      CuttlefishCanvas16* scrollDrawCanvas = bufferedScrollRepaintCanvas ? bufferedScrollRepaintCanvas : bufferedScrollCanvas;
      if (cullY + cullH <= 0 || cullY >= display_canvasHeight(scrollDrawCanvas) ||
          cullX + cullW <= 0 || cullX >= display_canvasWidth(scrollDrawCanvas)) {
        __ui_nodes[i].box.x = origBoxX;
        __ui_nodes[i].box.y = origBoxY;
        __ui_nodes[i].dirty = 0;
        continue;
      }
    } else if (ui_is_rect_clipped_by_scroll(i, cullX, cullY, cullW, cullH)) {
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
    if (!drawingBufferedScroll && bufferedScrollNode < 0 && ui_should_buffer_paint(i, paintCanvasW, paintCanvasH)) {
      paintCanvas = ui_get_scroll_canvas(paintCanvasW, paintCanvasH);
      if (paintCanvas) {
        drawingPaintCanvas = 1;
        ui_display_set_target(paintCanvas);
        ui_seed_paint_canvas_for_node(i, paintCanvas, paintCanvasX, paintCanvasY);
        baseDrawX -= paintCanvasX;
        baseDrawY -= paintCanvasY;
        drawX -= paintCanvasX;
        drawY -= paintCanvasY;
      }
    }
    if (!drawingPaintCanvas) {
      ui_clear_press_offset_area(i, baseDrawX, baseDrawY, drawX, drawY, paintTextW, paintTextH);
    }
    __ui_nodes[i].box.x = baseDrawX;
    ui_draw_shadow(i, baseDrawY, 0);
    __ui_nodes[i].box.x = drawX;

    // Border color: use borderColor if set, otherwise fg.
    uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
    // Apply opacity: blend fg/bg/border toward clearColor when < 100%.
    if (__ui_nodes[i].opacity < 100) {
      uint16_t clear = __ui_nodes[i].clearColor;
      bColor = ui_blend565(bColor, clear, __ui_nodes[i].opacity);
    }
    switch (__ui_nodes[i].kind) {
      case NODE_FILL:
        if (__ui_nodes[i].gradientEnabled > 0) {
          ui_draw_gradient_fill(i, drawY);
        } else if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_round_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, __ui_nodes[i].borderRadius, __ui_nodes[i].bg);
        } else if (__ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, __ui_nodes[i].bg);
        }
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          int16_t borderW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t borderH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_draw_rect_outline(__ui_nodes[i].box.x, drawY, borderW, borderH,
            __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, bColor);
        }
        break;
      case NODE_TEXT:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          if (tw > clearW) clearW = tw;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > (int16_t)clearH) {
            clearH = (uint16_t)__ui_nodes[i].lastTextHeight;
          }
          if (th > clearH) clearH = th;
          // Dynamic transparent text still needs a clear, otherwise old glyph
          // pixels accumulate when only this text node is dirty.
          uint16_t clearCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, clearW, clearH, clearCol);
          __ui_nodes[i].lastTextWidth = tw;
          __ui_nodes[i].lastTextHeight = th;
        }
        {
          // Text shadow: draw the text in the shadow color at the offset first.
          uint16_t tsClear = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          if (__ui_nodes[i].textShadowCount > 0) {
            uint16_t tsCol = ui_blend565(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
            ui_draw_wrapped_text(displayText,
              __ui_nodes[i].box.x + __ui_nodes[i].textShadowOffsetX,
              drawY + __ui_nodes[i].textShadowOffsetY,
              __ui_nodes[i].box.w, tsCol, tsCol, ts, __ui_nodes[i].fontAntialias,
              __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight,
              __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, 0, __ui_nodes[i].textOverflow);
          }
          // Use the parent's clear color as the text background when the node
          // has no own background. This makes Adafruit_GFX's opaque glyph-cell
          // fill blend with the parent (instead of drawing solid fg blocks that
          // overlap adjacent lines/elements). For AA text, fg != bg so the
          // edge-detection path still runs correctly.
          uint16_t textBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : ui_parent_clear_color(i);
          ui_draw_wrapped_text(displayText, __ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w,
            __ui_nodes[i].fg, textBg, ts, __ui_nodes[i].fontAntialias,
            __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing, __ui_nodes[i].lineHeight,
            __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
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
        ui_draw_wrapped_text(displayText,
          __ui_nodes[i].box.x,
          drawY + (__ui_nodes[i].box.h - (int16_t)th) / 2,
          __ui_nodes[i].box.w,
          __ui_nodes[i].fg,
          __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
          ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
          __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, 1, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
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
            uint16_t inv = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
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
            uint16_t radioBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
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
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          uint16_t fgCol = __ui_nodes[i].fg;

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
          uint16_t fgCol = __ui_nodes[i].fg;
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          uint16_t dimFg = ((fgCol >> 1) & 0x7BEF);

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
          uint16_t fgCol = __ui_nodes[i].fg;
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          if (__ui_nodes[i].borderRadius > 0) {
            ui_display_fill_round_rect(bx, by, bw, bh, __ui_nodes[i].borderRadius, bgCol);
          } else {
            ui_display_fill_rect(bx, by, bw, bh, bgCol);
          }
          uint16_t inputBorder = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : fgCol;
          uint8_t inputBorderStyle = __ui_nodes[i].borderStyle ? __ui_nodes[i].borderStyle : 1;
          uint8_t inputBorderWidth = __ui_nodes[i].borderWidth ? __ui_nodes[i].borderWidth : 1;
          ui_draw_rect_outline(bx, by, bw, bh, __ui_nodes[i].borderRadius, inputBorderStyle, inputBorderWidth, inputBorder);
          // Show typed text (textBuffer) in fg color, or placeholder (.text)
          // dimmed gray when the buffer is empty.
          uint16_t textCol = fgCol;
          const char* disp = (__ui_nodes[i].textBuffer[0] != 0)
            ? __ui_nodes[i].textBuffer
            : (__ui_nodes[i].text ? __ui_nodes[i].text : "");
          if (__ui_nodes[i].textBuffer[0] == 0) textCol = 0x8410;  // dim gray for placeholder
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
        }
        break;
      case NODE_IMG:
        if (__ui_nodes[i].hasBg) {
          int16_t fillW = ui_rotated_face_w(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          int16_t fillH = ui_rotated_face_h(i, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
          ui_display_fill_rect(__ui_nodes[i].box.x, drawY, fillW, fillH, __ui_nodes[i].bg);
        }
        if (__ui_nodes[i].imgDataId < __ui_image_count) {
          const UIImage* img = &__ui_images[__ui_nodes[i].imgDataId];
          int16_t targetW = __ui_nodes[i].box.w;
          int16_t targetH = __ui_nodes[i].box.h;
          ui_draw_image_with_fit(img, __ui_nodes[i].box.x, drawY, __ui_nodes[i].rotateDeg, __ui_nodes[i].objectFit, targetW, targetH);
        }
        break;
      case NODE_LIST: {
        // Find this list's state.
        UIListState* ls = nullptr;
        for (uint8_t l = 0; l < __ui_list_count; l++) {
          if (__ui_lists[l].nodeIndex == i) { ls = &__ui_lists[l]; break; }
        }
        if (!ls || !ls->itemFn) break;
        int16_t bx = __ui_nodes[i].box.x;
        int16_t by = drawY;
        int16_t bw = __ui_nodes[i].box.w;
        int16_t bh = __ui_nodes[i].box.h;
        uint16_t ih = ls->itemHeight;
        uint16_t clearCol = __ui_nodes[i].clearColor;
        // Render to a viewport-sized canvas so edge glyphs are naturally clipped.
        // Use a dedicated list canvas to avoid conflicts with the scroll canvas.
        static CuttlefishCanvas16* __ui_list_canvas = nullptr;
        if (!__ui_list_canvas || display_canvasWidth(__ui_list_canvas) != bw || display_canvasHeight(__ui_list_canvas) != bh) {
          display_deleteCanvas(__ui_list_canvas);
          __ui_list_canvas = display_createCanvas(bw, bh);
        }
        CuttlefishCanvas16* lc = __ui_list_canvas;
        if (!lc || !display_canvasBuffer(lc)) break;
        display_canvasFillScreen(lc, clearCol);
        // Compute visible range.
        uint16_t first = ls->scrollY / ih;
        uint16_t last = (ls->scrollY + bh - 1) / ih + 1;
        if (ls->itemCount > 0 && last >= ls->itemCount) last = ls->itemCount - 1;
        // Draw each visible item (canvas-local coords: 0,0 = viewport top).
        char listBuf[UI_TEXT_BUF + 1];
        display_targetSetTextWrap((CuttlefishDisplayTarget*)lc, false);
        for (uint16_t idx = first; idx <= last; idx++) {
          int16_t itemY = (int16_t)(idx * ih) - ls->scrollY;
          ls->itemFn(idx, listBuf, UI_TEXT_BUF + 1);
          listBuf[UI_TEXT_BUF] = 0;
          display_targetSetCursor((CuttlefishDisplayTarget*)lc, 4, itemY + (ih - 16) / 2);
          display_targetSetTextColor((CuttlefishDisplayTarget*)lc, __ui_nodes[i].fg);
          display_targetSetTextSize((CuttlefishDisplayTarget*)lc, 2);
          display_targetPrint((CuttlefishDisplayTarget*)lc, listBuf);
        }
        // Scrollbar (canvas-local coords).
        if (ls->contentHeight > (uint16_t)bh) {
          int16_t tx = bw - 4;
          uint16_t thumbH = (uint32_t)bh * bh / ls->contentHeight;
          if (thumbH < 8) thumbH = 8;
          uint16_t thumbY = (uint32_t)(bh - thumbH) * ls->scrollY / (ls->contentHeight - bh);
          uint16_t dimFg = ((__ui_nodes[i].fg >> 1) & 0x7BEF);
          display_canvasFillRect(lc, tx, 0, 3, bh, dimFg);
          display_canvasFillRect(lc, tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
        }
        // Standalone lists push directly. Lists inside a buffered scroll
        // container must composite into that scroll canvas; their box has
        // already been translated to canvas-local coordinates.
        if (drawingBufferedScroll) {
          ui_draw_canvas_rect(lc, bx, by, bw, bh);
        } else {
          ui_push_canvas_rect(lc, bx, by, bw, bh);
        }
        __ui_nodes[i].dirty = 0;
        ui_display_set_target(__ui_draw_target);
        __ui_nodes[i].box.x = origBoxX;
        __ui_nodes[i].box.y = origBoxY;
        continue;  // skip outline/paint-canvas/restore (list draws its own border)
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
    // Restore original box coords (translated for canvas-local drawing above).
    __ui_nodes[i].box.x = origBoxX;
    __ui_nodes[i].box.y = origBoxY;
    __ui_nodes[i].dirty = 0;
  }
  // ②b Draw scrollbar + push canvas for the buffered scroll container.
  if (bufferedScrollNode >= 0 && bufferedScrollCanvas) {
    // Draw scrollbar into the canvas (canvas-local coords: 0,0 = viewport top-left).
    ui_display_set_target(bufferedScrollCanvas);
    uint8_t si = (uint8_t)bufferedScrollNode;
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
    uint16_t dimFg = ((__ui_nodes[si].fg >> 1) & 0x7BEF);
    ui_display_fill_rect(tx, 0, 3, vh, dimFg);
    ui_display_fill_rect(tx, thumbY, 3, thumbH, __ui_nodes[si].fg);
    __ui_scroll_cache_valid = 1;
    __ui_scroll_cache_node = bufferedScrollNode;
    __ui_scroll_cache_y = __ui_nodes[si].scrollY;
    __ui_scroll_cache_w = vw;
    __ui_scroll_cache_h = vh;
    // Push the canvas to the draw target at the viewport position (the
    // framebuffer when active, else the display directly).
    ui_display_set_target(__ui_draw_target);
    ui_push_canvas_rect(bufferedScrollCanvas,
      bufferedScrollVX, bufferedScrollVY,
      vw, vh);
  }
  // ── Framebuffer bulk push ────────────────────────────────────────────────
  // When a framebuffer was used this frame, flush it to the display in a single
  // SPI transaction and restore the direct-draw target. No-op without one.
  if (__ui_fb) {
    ui_push_framebuffer();
  }
  ui_display_use_default_target();
  // ③ Flush — ILI9341 is immediate, no separate flush needed.
}

// ── Antialiasing subsystem (offscreen canvas + coverage blending) ──────────
// Enabled via #define UI_AA 1 (from display profile antialias:true).
// Shapes are rendered to a GFXcanvas16, edges blended via getPixel read-back,
// then pushed to the display. The ILI9341 has no efficient SPI read-back, so
// all blending happens in RAM.
#ifdef UI_AA

// Get (or allocate) a canvas sized to the element being drawn.
static inline CuttlefishCanvas16* ui_aa_begin(int16_t w, int16_t h, uint16_t bg) {
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
static inline void ui_aa_pixel(CuttlefishCanvas16* c, int16_t x, int16_t y, uint16_t color, uint8_t cov) {
  if (!c || !display_canvasBuffer(c)) return;
  if (cov == 0) return;
  if (x < 0 || y < 0 || x >= display_canvasWidth(c) || y >= display_canvasHeight(c)) return;
  if (cov >= 255) { display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, color); return; }
  uint16_t bg = display_canvasGetPixel(c, x, y);
  uint8_t op = (uint8_t)((uint16_t)cov * 100 / 255);
  display_targetDrawPixel((CuttlefishDisplayTarget*)c, x, y, ui_blend565(color, bg, op));
}

// Xiaolin Wu antialiased line. Coordinates are in canvas-local space.
static inline void ui_aa_line(CuttlefishCanvas16* c, float x0, float y0, float x1, float y1, uint16_t color) {
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
static inline void ui_aa_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, uint16_t color) {
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
static inline void ui_aa_fill_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, uint16_t color) {
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
static int8_t  __ui_kb_target;       // node index of input being edited (-1 = none)
static uint32_t __ui_kb_bs_repeat;   // last auto-repeat deletion time
// __ui_kb_dirty is forward-declared earlier (near the touch state machine).
static void    (*__ui_kb_onchange)();
// Dispatch table: one loader per input node. Indexed by input position.
extern void (*__ui_kb_loaders[])();
extern const uint8_t __ui_kb_loader_count;

static inline void ui_kb_add_key(char ch, uint8_t special, uint16_t bg, uint16_t fg, uint16_t borderColor) {
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
}

// Delete one character from the buffer.
static inline void ui_kb_delete() {
  if (__ui_kb_len == 0) return;
  __ui_kb_buffer[--__ui_kb_len] = 0;
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
static inline void ui_kb_open(uint8_t nodeIdx, uint8_t inputPosition) {
  __ui_kb_target = (int8_t)nodeIdx;
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
  // Mark the whole tree dirty so the app fully redraws when the keyboard closes.
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
}

// Close the keyboard: commit buffer back to the input node.
static inline void ui_kb_close() {
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    if (__ui_kb_onchange) __ui_kb_onchange();
  }
  __ui_kb_visible = 0;
  __ui_kb_target = -1;
  __ui_kb_bs_held = 0;
  // Mark the whole tree dirty so the app fully redraws after the keyboard
  // overlay is removed (the draw pass was skipped while the keyboard was up).
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
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
  uint16_t bg = ks.bg;
  uint16_t fg = ks.fg;
  uint16_t border = ks.borderColor;
  // Shift-active highlight: brighten the shift key's background — but only
  // when not pressed, so the press inversion stays high-contrast.
  if (k.special == 1 && __ui_kb_shift && (int8_t)i != __ui_kb_pressed_key) { bg = 0xBDF7; }
  // Pressed key: invert colors for clear tap feedback.
  if ((int8_t)i == __ui_kb_pressed_key) { uint16_t t = bg; bg = fg; fg = t; }
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
  ui_display_set_text_color(0xFFFF, 0x0000);
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
`;
}
