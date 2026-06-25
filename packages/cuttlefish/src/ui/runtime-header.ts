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
#define UI_TEXT_BUF 32   // max stored UI text chars, excluding the trailing NUL
#ifndef UI_MAX_BUFFERED_PAINT_PIXELS
#define UI_MAX_BUFFERED_PAINT_PIXELS 20000
#endif

enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT, NODE_IMG, NODE_LIST };
enum UIProperty { PROP_BG, PROP_FG, PROP_TEXT, PROP_VISIBLE, PROP_BORDER_COLOR };

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
  int8_t transformOffsetX; // draw-only transform: translate(...)
  int8_t transformOffsetY;
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
  uint8_t underline;    // 0=none, 1=underline
  uint8_t nowrap;       // 1 = no text wrapping (white-space: nowrap/pre)
  uint8_t visible;      // 0=hidden, 1=visible
  uint8_t opacity;      // 0-100
  uint16_t clearColor;  // ancestor's background — used to wipe transparent text before redraw
  int16_t lastTextWidth;
  // scroll
  uint8_t scrollable;   // 1 = children are offset by scrollY and clipped to this box
  int16_t scrollY;      // current scroll offset (children Y -= scrollY)
  int16_t contentHeight; // total height of children (for scrollbar ratio)
  uint8_t parent;       // 255 = root/no parent
  uint8_t subtreeEnd;   // exclusive pre-order end index
  uint8_t screenId;     // which <screen> this node belongs to (for navigation)
  uint8_t imgDataId;    // index into __ui_images[] (255 = no image)
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
  uint8_t r = ar + (uint8_t)(((uint16_t)(br - ar) * k100) / 100);
  uint8_t g = ag + (uint8_t)(((uint16_t)(bg - ag) * k100) / 100);
  uint8_t bl = ab + (uint8_t)(((uint16_t)(bb - ab) * k100) / 100);
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
static uint8_t __ui_kb_visible = 0;

static uint8_t __ui_active_screen = 0;   // which screen is visible/interactive
extern const uint8_t __ui_screen_count;  // total number of screens (emitted by lowering)

// ── Image assets ────────────────────────────────────────────────────────────
struct UIImage { uint16_t w; uint16_t h; const uint16_t* data; };
extern const UIImage __ui_images[];
extern const uint8_t __ui_image_count;

// ── List bindings ───────────────────────────────────────────────────────────
struct UIListBinding {
  uint8_t node;
  uint16_t (*countFn)(void);
  void (*itemFn)(uint16_t idx, char* buf, uint8_t size);
  void (*tapFn)(uint16_t idx);  // optional: called when an item is tapped
};
extern UIListBinding __ui_list_bindings[];
extern const uint8_t __ui_list_binding_count;

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
  __ui_touch_node = -1;
  __ui_touch_state = 0;
  __ui_kb_visible = 0;
  // Clear the entire display so old screen content doesn't show.
  __tc_display.fillScreen(0x0000);
  // Mark all nodes dirty so the new screen fully redraws.
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
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
static inline void ui_node_paint_rect(uint8_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint8_t textSize, UIRect* out);

static Adafruit_GFX* __ui_gfx = &__tc_display;
static GFXcanvas16* __ui_scroll_canvas = nullptr;

// Get (or re-allocate) a canvas sized to the viewport (w×h), not the full
// display. Much smaller allocation → allocates reliably on ESP32 without PSRAM.
static inline GFXcanvas16* ui_get_scroll_canvas(int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return nullptr;
  if (!__ui_scroll_canvas || __ui_scroll_canvas->width() != w || __ui_scroll_canvas->height() != h) {
    delete __ui_scroll_canvas;
    __ui_scroll_canvas = new GFXcanvas16(w, h);
  }
  if (!__ui_scroll_canvas || !__ui_scroll_canvas->getBuffer()) return nullptr;
  return __ui_scroll_canvas;
}

// Draw offset: when non-zero, all __ui_gfx draw calls subtract this from
// display coords to produce canvas-local coords. Set when redirecting to a
// viewport-sized canvas; reset to 0 for direct-display draws.
static int16_t __ui_draw_off_x = 0;
static int16_t __ui_draw_off_y = 0;

static inline void ui_push_canvas_rect(GFXcanvas16* canvas, int16_t x, int16_t y, int16_t w, int16_t h) {
  if (!canvas || !canvas->getBuffer()) return;
  uint16_t* pixels = canvas->getBuffer();
  int16_t stride = canvas->width();
  // The canvas is viewport-sized: buffer row 0 = the first row of the viewport.
  // The display destination is (x, y) but the source buffer starts at (0, 0).
  __tc_display.startWrite();
  __tc_display.setAddrWindow(x, y, w, h);
  if (w == stride) {
    // Full-width: contiguous in buffer, single write.
    __tc_display.writePixels(pixels, (uint32_t)w * h);
    __tc_display.endWrite();
    return;
  }
  for (int16_t row = 0; row < h; row++) {
    __tc_display.writePixels(pixels + (int32_t)row * stride, w);
  }
  __tc_display.endWrite();
}

// Per-node dirty marker (called by press handlers and binding evaluation).
static inline void ui_mark_dirty(uint8_t nodeIdx) {
  __ui_nodes[nodeIdx].dirty = 1;
}

static inline void ui_mark_scroll_subtree_dirty(uint8_t scrollNode) {
  for (uint8_t c = scrollNode + 1; c < __ui_nodes[scrollNode].subtreeEnd; c++) {
    ui_mark_dirty(c);
  }
  ui_mark_dirty(scrollNode);
}

static inline uint8_t ui_apply_scroll_delta(int8_t scrollNode, int16_t dy) {
  if (scrollNode < 0) return 0;
  int16_t maxScroll = __ui_nodes[scrollNode].contentHeight - __ui_nodes[scrollNode].box.h;
  int16_t prevScrollY = __ui_nodes[scrollNode].scrollY;
  int16_t nextScrollY = constrain(prevScrollY - dy, 0, maxScroll);
  // Snap to boundaries: if within a few pixels of 0 or maxScroll, clamp exactly.
  // This prevents the "jump" where a residual offset hides the first/last row.
  if (nextScrollY > 0 && nextScrollY < 2) nextScrollY = 0;
  if (nextScrollY > maxScroll - 2 && nextScrollY < maxScroll) nextScrollY = maxScroll;
  if (nextScrollY == prevScrollY) return 0;
  __ui_nodes[scrollNode].scrollY = nextScrollY;
  ui_mark_scroll_subtree_dirty((uint8_t)scrollNode);
  return 1;
}

static inline uint8_t ui_rects_intersect(int16_t ax, int16_t ay, int16_t aw, int16_t ah,
                                         int16_t bx, int16_t by, int16_t bw, int16_t bh) {
  return ax + aw > bx && ax < bx + bw && ay + ah > by && ay < by + bh;
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

static inline void ui_node_paint_rect(uint8_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint8_t textSize, UIRect* out) {
  int16_t shadowL, shadowT, shadowR, shadowB;
  ui_shadow_extents(nodeIdx, &shadowL, &shadowT, &shadowR, &shadowB);

  int16_t faceW = __ui_nodes[nodeIdx].box.w;
  int16_t faceH = __ui_nodes[nodeIdx].box.h;
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT || __ui_nodes[nodeIdx].kind == NODE_CHECK || __ui_nodes[nodeIdx].kind == NODE_RADIO) {
    if (__ui_nodes[nodeIdx].lastTextWidth > faceW) faceW = __ui_nodes[nodeIdx].lastTextWidth;
    if ((int16_t)textW > faceW) faceW = (int16_t)textW;
  }
  if (__ui_nodes[nodeIdx].kind == NODE_TEXT) {
    int16_t glyphH = textSize * 8;
    if (glyphH > faceH) faceH = glyphH;
  }

  int16_t shadowX0 = baseX - shadowL;
  int16_t shadowY0 = baseY - shadowT;
  int16_t shadowX1 = baseX + __ui_nodes[nodeIdx].box.w + shadowR;
  int16_t shadowY1 = baseY + __ui_nodes[nodeIdx].box.h + shadowB;
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
    ui_expand_rect(&x0, &y0, &x1, &y1, drawX - o, drawY - o, drawX + __ui_nodes[nodeIdx].box.w + o, drawY + __ui_nodes[nodeIdx].box.h + o);
  }
  out->x = x0;
  out->y = y0;
  out->w = x1 - x0;
  out->h = y1 - y0;
}

static inline void ui_clear_press_offset_area(uint8_t nodeIdx, int16_t baseX, int16_t baseY, int16_t drawX, int16_t drawY, uint16_t textW, uint8_t textSize) {
  if (__ui_nodes[nodeIdx].pressedOffsetX == 0 && __ui_nodes[nodeIdx].pressedOffsetY == 0) return;
  UIRect r;
  ui_node_paint_rect(nodeIdx, baseX, baseY, drawX, drawY, textW, textSize, &r);
  int16_t x0 = r.x;
  int16_t y0 = r.y;
  int16_t x1 = r.x + r.w;
  int16_t y1 = r.y + r.h;
  __ui_gfx->fillRect(x0, y0, x1 - x0, y1 - y0, ui_parent_clear_color(nodeIdx));
}

static inline uint8_t ui_should_buffer_paint(uint8_t nodeIdx, int16_t w, int16_t h) {
  if (w <= 0 || h <= 0) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_PROGRESS || __ui_nodes[nodeIdx].kind == NODE_RANGE) return 0;
  if (__ui_nodes[nodeIdx].kind == NODE_FILL &&
      !__ui_nodes[nodeIdx].hasBg &&
      __ui_nodes[nodeIdx].borderStyle == 0 &&
      __ui_nodes[nodeIdx].outlineStyle == 0 &&
      __ui_nodes[nodeIdx].shadowCount == 0) return 0;
  return (uint32_t)w * (uint32_t)h <= UI_MAX_BUFFERED_PAINT_PIXELS;
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

// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Called once in setup() before the loop begins.
// Also seed each text-bound node's buffer from its flash literal so the first
// strcmp in ui_tick has a valid baseline (no spurious redraw on frame 1).
static inline void ui_init(void) {
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
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
extern const uint8_t __ui_click_handler_count;

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
  for (int8_t i = __ui_node_count - 1; i >= 0; i--) {
    if (!__ui_nodes[i].visible) continue;
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
        return i;
      }
      if ((uint8_t)i < __ui_click_handler_count &&
          (__ui_click_handlers[i] || __ui_hold_handlers[i] || __ui_release_handlers[i])) {
        return i;
      }
    }
  }
  return -1;
}

// Dispatch a handler from the given table if registered for the node.
static void ui_dispatch(void (**table)(), uint8_t count, int8_t node) {
  if (node >= 0 && (uint8_t)node < count && table[node]) {
    table[node]();
  }
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
  // Check if the touch is inside a scrollable container
  for (int8_t i = __ui_node_count - 1; i >= 0; i--) {
    if (!__ui_nodes[i].scrollable || !__ui_nodes[i].visible) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    int16_t drawX = ui_draw_x_for_node((uint8_t)i);
    int16_t drawY = ui_draw_y_for_node((uint8_t)i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      if (__ui_nodes[i].contentHeight > __ui_nodes[i].box.h) {
        __ui_scroll_node = i;
        break;
      }
    }
  }
  // Check if the touch is inside a list node (for list scrolling).
  __ui_list_drag = -1;
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (__ui_nodes[i].kind != NODE_LIST || !__ui_nodes[i].visible) continue;
    if (__ui_nodes[i].screenId != __ui_active_screen) continue;
    int16_t drawX = ui_draw_x_for_node(i);
    int16_t drawY = ui_draw_y_for_node(i);
    if (tx >= drawX && tx < drawX + __ui_nodes[i].box.w &&
        ty >= drawY && ty < drawY + __ui_nodes[i].box.h) {
      for (uint8_t l = 0; l < __ui_list_count; l++) {
        if (__ui_lists[l].nodeIndex == i) { __ui_list_drag = l; break; }
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
    // Open the on-screen keyboard when an input is tapped (and not already open).
    if (__ui_nodes[node].kind == NODE_INPUT && !__ui_kb_visible) {
      // Resolve the input's position in the loader dispatch table by scanning
      // for the Nth NODE_INPUT. (The loader table is indexed by input order.)
      uint8_t inputPos = 0;
      for (int16_t j = 0; j < node; j++) {
        if (__ui_nodes[j].kind == NODE_INPUT) inputPos++;
      }
      ui_kb_open((uint8_t)node, inputPos);
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
  if (__ui_scroll_node >= 0 && __ui_scroll_pending_dy != 0) {
    if (ui_apply_scroll_delta(__ui_scroll_node, __ui_scroll_pending_dy)) {
      __ui_last_scroll_draw_time = millis();
    }
    __ui_scroll_pending_dy = 0;
  }
  if (__ui_touch_node >= 0 && !__ui_is_dragging) {
    int8_t clickedNode = __ui_touch_node;
    if (elapsed < UI_TOUCH_HOLD_MS) {
      ui_dispatch(__ui_click_handlers, __ui_click_handler_count, __ui_touch_node);
    }
    ui_dispatch(__ui_release_handlers, __ui_click_handler_count, __ui_touch_node);
    if (__ui_nodes[clickedNode].kind == NODE_BUTTON) {
      ui_set_pressed((uint8_t)clickedNode, 0);
    }
    ui_mark_dirty(clickedNode);
  }
  // List item tap: if the touch was inside a list, compute item index.
  // Use total movement (not drag flag) to distinguish tap from scroll:
  // a tap moves < itemHeight/2 total; a scroll moves more.
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
      }
    }
    if (__ui_is_dragging && __ui_scroll_node >= 0) {
      // Scroll: accumulate small touch deltas and redraw at a bounded cadence.
      int16_t dy = ty - __ui_drag_start_y;
      __ui_drag_start_y = ty;
      __ui_scroll_pending_dy += dy;
      if (abs(__ui_scroll_pending_dy) >= UI_SCROLL_STEP_PX &&
          now - __ui_last_scroll_draw_time >= UI_SCROLL_FRAME_MS) {
        ui_apply_scroll_delta(__ui_scroll_node, __ui_scroll_pending_dy);
        __ui_scroll_pending_dy = 0;
        __ui_last_scroll_draw_time = now;
      }
    }
    // List scroll: apply drag delta to the active list's scrollY.
    if (__ui_is_dragging && __ui_list_drag >= 0) {
      int16_t dy = ty - __ui_drag_start_y;
      __ui_drag_start_y = ty;
      UIListState* ls = &__ui_lists[__ui_list_drag];
      int16_t maxScroll = ls->contentHeight - __ui_nodes[ls->nodeIndex].box.h;
      int16_t nextY = constrain((int16_t)ls->scrollY - dy, 0, maxScroll);
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
  uint8_t byte = face->alpha[nibble >> 1];
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
            if (alpha >= 8) __ui_gfx->drawPixel(dx, dy, fg);
          } else {
            __ui_gfx->drawPixel(dx, dy, alpha >= 15 ? fg : ui_blend565(fg, bg, (uint8_t)((uint16_t)alpha * 100 / 15)));
          }
        } else if (alpha >= 8) {
          __ui_gfx->drawPixel(dx, dy, fg);
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
  __ui_gfx->setTextColor(fg, bg);
  __ui_gfx->setTextSize(ts);
  __ui_gfx->setTextWrap(false);
  // Draw char-by-char to apply letterSpacing between glyphs.
  if (letterSpacing == 0) {
    __ui_gfx->setCursor(x, y);
    __ui_gfx->print(text);
  } else {
    int16_t cx = x;
    char buf[2] = {0, 0};
    for (const char* p = text; *p; p++) {
      __ui_gfx->setCursor(cx, y);
      buf[0] = *p;
      __ui_gfx->print(buf);
      cx += ts * 6 + letterSpacing;
    }
  }
}

#ifdef UI_AA
static inline GFXcanvas16* ui_aa_begin(int16_t w, int16_t h, uint16_t bg);
static inline void ui_aa_push(GFXcanvas16* c, int16_t dx, int16_t dy);
static inline void ui_aa_line(GFXcanvas16* c, float x0, float y0, float x1, float y1, uint16_t color);
static inline void ui_aa_circle(GFXcanvas16* c, int16_t cx, int16_t cy, float r, uint16_t color);
static inline void ui_aa_fill_circle(GFXcanvas16* c, int16_t cx, int16_t cy, float r, uint16_t color);

static GFXcanvas16* __ui_text_src_canvas = nullptr;
static GFXcanvas16* __ui_text_dst_canvas = nullptr;

static inline GFXcanvas16* ui_text_canvas(GFXcanvas16** slot, int16_t w, int16_t h) {
  if (w <= 0) w = 1;
  if (h <= 0) h = 1;
  if (!*slot || (*slot)->width() < w || (*slot)->height() < h) {
    delete *slot;
    *slot = new GFXcanvas16(w, h);
  }
  return *slot;
}

static inline uint8_t ui_text_fg_neighbors(GFXcanvas16* src, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t fg, uint8_t radius = 1) {
  uint8_t count = 0;
  for (int8_t dy = -(int8_t)radius; dy <= (int8_t)radius; dy++) {
    int16_t yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (int8_t dx = -(int8_t)radius; dx <= (int8_t)radius; dx++) {
      int16_t xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      if (src->getPixel(xx, yy) == fg) count++;
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
  uint8_t h = ui_text_height(ts, 0);
  if (w == 0 || h == 0 || fg == bg) {
    ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
    return;
  }

  GFXcanvas16* src = ui_text_canvas(&__ui_text_src_canvas, (int16_t)w, (int16_t)h);
  GFXcanvas16* dst = ui_text_canvas(&__ui_text_dst_canvas, (int16_t)w, (int16_t)h);
  if (!src || !dst || !src->getBuffer() || !dst->getBuffer()) {
    ui_draw_bitmap_text(text, x, y, fg, bg, ts, 0);
    return;
  }

  src->fillRect(0, 0, w, h, bg);
  dst->fillRect(0, 0, w, h, bg);
  src->setCursor(0, 0);
  src->setTextColor(fg, bg);
  src->setTextSize(ts);
  src->setTextWrap(false);
  src->print(text);

  for (int16_t yy = 0; yy < h; yy++) {
    for (int16_t xx = 0; xx < (int16_t)w; xx++) {
      uint16_t px = src->getPixel(xx, yy);
      uint8_t neighbors = ui_text_fg_neighbors(src, xx, yy, (int16_t)w, h, fg);
      uint8_t outerNeighbors = 0;
      if (ts >= 3 && px != fg && neighbors == 0) {
        outerNeighbors = ui_text_fg_neighbors(src, xx, yy, (int16_t)w, h, fg, 2);
      }
      uint8_t coverage = ui_text_aa_coverage(neighbors, outerNeighbors, px == fg ? 1 : 0, ts);
      dst->drawPixel(xx, yy, coverage == 0 ? bg : ui_blend565(fg, bg, coverage));
    }
  }

  int16_t stride = dst->width();
  uint16_t* pixels = dst->getBuffer();
  for (int16_t row = 0; row < h; row++) {
    __ui_gfx->drawRGBBitmap(x, y + row, pixels + (int32_t)row * stride, w, 1);
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
      __ui_gfx->drawFastHLine(bx, by + y, bw, col);
    }
  } else {
    // Horizontal: left=c1, right=c2. Draw column by column.
    for (int16_t x = 0; x < bw; x++) {
      uint8_t op = (uint8_t)((uint16_t)x * 100 / (bw > 1 ? bw - 1 : 1));
      uint16_t col = ui_blend565(c1, c2, op);
      __ui_gfx->drawFastVLine(bx + x, by, bh, col);
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
        __ui_gfx->fillRect(bx, by, bw, oy, col);
      } else if (oy < 0) {
        __ui_gfx->fillRect(bx, by + bh + oy, bw, -oy, col);
      }
      if (ox > 0) {
        __ui_gfx->fillRect(bx, by, ox, bh, col);
      } else if (ox < 0) {
        __ui_gfx->fillRect(bx + bw + ox, by, -ox, bh, col);
      }
      if (ox == 0 && oy == 0) {
        __ui_gfx->drawRect(bx, by, bw, bh, col);
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
        __ui_gfx->fillRect(ix, iy, iw, 1, col);         // top edge
        __ui_gfx->fillRect(ix, iy + ih - 1, iw, 1, col); // bottom edge
        __ui_gfx->fillRect(ix, iy, 1, ih, col);          // left edge
        __ui_gfx->fillRect(ix + iw - 1, iy, 1, ih, col); // right edge
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
          __ui_gfx->fillRoundRect(sx, sy, sw, sh_, r, col);
        } else {
          __ui_gfx->fillRect(sx, sy, sw, sh_, col);
        }
      }
    }
  }
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
      if (r > 0) __ui_gfx->drawRoundRect(rx, ry, rw, rh, r, color);
      else __ui_gfx->drawRect(rx, ry, rw, rh, color);
    } else {
      for (int16_t dx = 0; dx < rw; dx += 8) {
        int16_t seg = (dx + 4 <= rw) ? 4 : (rw - dx);
        if (seg > 0) {
          __ui_gfx->drawFastHLine(rx + dx, ry, seg, color);
          __ui_gfx->drawFastHLine(rx + dx, ry + rh - 1, seg, color);
        }
      }
      for (int16_t dy = 0; dy < rh; dy += 8) {
        int16_t seg = (dy + 4 <= rh) ? 4 : (rh - dy);
        if (seg > 0) {
          __ui_gfx->drawFastVLine(rx, ry + dy, seg, color);
          __ui_gfx->drawFastVLine(rx + rw - 1, ry + dy, seg, color);
        }
      }
    }
  }
}

static inline void ui_draw_node_border(uint8_t i, int16_t drawY, uint16_t color) {
  ui_draw_rect_outline(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h,
    __ui_nodes[i].borderRadius, __ui_nodes[i].borderStyle, __ui_nodes[i].borderWidth, color);
}

static inline void ui_draw_node_outline(uint8_t i, int16_t drawY) {
  if (__ui_nodes[i].outlineStyle == 0 || __ui_nodes[i].outlineWidth == 0) return;
  uint8_t w = __ui_nodes[i].outlineWidth;
  ui_draw_rect_outline(__ui_nodes[i].box.x - w, drawY - w,
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
  // ① Advance transitions.
  for (uint8_t i = 0; i < __ui_trans_count; i++) {
    if (!__ui_trans[i].active) continue;
    __ui_trans[i].elapsed += deltaMs;
    uint16_t k = __ui_trans[i].durationMs == 0
      ? 100
      : (uint16_t)((uint32_t)__ui_trans[i].elapsed * 100 / __ui_trans[i].durationMs);
    uint16_t v = lerp_color(__ui_trans[i].prevValue, __ui_trans[i].targetValue, (uint8_t)k);
    if (__ui_trans[i].prop == PROP_FG) {
      __ui_nodes[__ui_trans[i].node].fg = v;
    } else {
      __ui_nodes[__ui_trans[i].node].bg = v;
    }
    ui_mark_dirty(__ui_trans[i].node);
    if (k >= 100) __ui_trans[i].active = 0;
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
  // Process each dirty scroll container: mark subtree dirty, set up the
  // viewport-sized canvas for the main draw loop to redirect into.
  int8_t bufferedScrollNode = -1;
  int16_t bufferedScrollVX = 0;  // viewport origin X for coord translation
  int16_t bufferedScrollVY = 0;  // viewport origin Y
  GFXcanvas16* bufferedScrollCanvas = nullptr;
  for (uint8_t s = 0; s < __ui_node_count; s++) {
    if (!__ui_nodes[s].scrollable || !__ui_nodes[s].visible) continue;
    if (__ui_nodes[s].screenId != __ui_active_screen) continue;
    if (__ui_nodes[s].contentHeight <= __ui_nodes[s].box.h) continue;
    if (!__ui_nodes[s].dirty) continue;

    // Mark the whole subtree dirty + reset incremental redraw state.
    for (uint8_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
      ui_mark_dirty(c);
      if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
      else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
    }

    int16_t vw = __ui_nodes[s].box.w;
    int16_t vh = __ui_nodes[s].box.h;
    int16_t vox = __ui_nodes[s].box.x;
    int16_t voy = __ui_nodes[s].box.y;
    bufferedScrollCanvas = ui_get_scroll_canvas(vw, vh);
    if (bufferedScrollCanvas) {
      bufferedScrollNode = (int8_t)s;
      bufferedScrollVX = vox;
      bufferedScrollVY = voy;
      // Clear canvas (it's viewport-sized, so fillScreen is efficient).
      bufferedScrollCanvas->fillScreen(
        __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor);
    } else {
      // Fallback: clear display viewport directly.
      __ui_gfx->fillRect(__ui_nodes[s].box.x, __ui_nodes[s].box.y,
        __ui_nodes[s].box.w, __ui_nodes[s].box.h,
        __ui_nodes[s].hasBg ? __ui_nodes[s].bg : __ui_nodes[s].clearColor);
    }
    // Only one scroll container per frame (the canvas is reused for subsequent
    // ones in the next dirty frame). This matches the original design.
    break;
  }
  // Draw non-scroll dirty nodes directly to the display.
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].dirty) continue;
    if (!__ui_nodes[i].visible) continue;
    // Only draw nodes belonging to the active screen.
    if (__ui_nodes[i].screenId != __ui_active_screen) { __ui_nodes[i].dirty = 0; continue; }

    // Redirect to the scroll canvas if this node is inside the buffered container.
    uint8_t drawingBufferedScroll = bufferedScrollNode >= 0 && i > (uint8_t)bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd;
    int16_t origBoxX = __ui_nodes[i].box.x;
    int16_t origBoxY = __ui_nodes[i].box.y;
    if (drawingBufferedScroll) {
      __ui_gfx = bufferedScrollCanvas;
      // Translate display coords → canvas-local coords (subtract viewport origin).
      __ui_nodes[i].box.x = origBoxX - bufferedScrollVX;
      __ui_nodes[i].box.y = origBoxY - bufferedScrollVY;
    } else {
      __ui_gfx = &__tc_display;
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
    uint16_t tw = ui_text_width(displayText, ts, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);

    UIRect paintRect;
    ui_node_paint_rect(i, baseDrawX, baseDrawY, drawX, drawY, tw, ts, &paintRect);
    int16_t cullX = paintRect.x;
    int16_t cullY = paintRect.y;
    int16_t cullW = paintRect.w;
    int16_t cullH = paintRect.h;
    if (drawingBufferedScroll) {
      // Canvas-local clip: skip nodes fully outside the viewport (0..vw, 0..vh).
      if (cullY + cullH <= 0 || cullY >= bufferedScrollCanvas->height() ||
          cullX + cullW <= 0 || cullX >= bufferedScrollCanvas->width()) {
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
    GFXcanvas16* paintCanvas = nullptr;
    int16_t paintCanvasX = paintRect.x;
    int16_t paintCanvasY = paintRect.y;
    int16_t paintCanvasW = paintRect.w;
    int16_t paintCanvasH = paintRect.h;
    if (!drawingBufferedScroll && bufferedScrollNode < 0 && ui_should_buffer_paint(i, paintCanvasW, paintCanvasH)) {
      paintCanvas = ui_get_scroll_canvas(paintCanvasW, paintCanvasH);
      if (paintCanvas) {
        drawingPaintCanvas = 1;
        __ui_gfx = paintCanvas;
        paintCanvas->fillScreen(ui_parent_clear_color(i));
        baseDrawX -= paintCanvasX;
        baseDrawY -= paintCanvasY;
        drawX -= paintCanvasX;
        drawY -= paintCanvasY;
      }
    }
    if (!drawingPaintCanvas) {
      ui_clear_press_offset_area(i, baseDrawX, baseDrawY, drawX, drawY, tw, ts);
    }
    __ui_nodes[i].box.x = baseDrawX;
    ui_draw_shadow(i, baseDrawY, 0);
    __ui_nodes[i].box.x = drawX;

    // Compute x offset based on text-align (0=left, 1=center, 2=right).
    int16_t textX = __ui_nodes[i].box.x;
    if (__ui_nodes[i].textAlign == 1) textX = __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2;
    else if (__ui_nodes[i].textAlign == 2) textX = __ui_nodes[i].box.x + __ui_nodes[i].box.w - tw;
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
          __ui_gfx->fillRoundRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, __ui_nodes[i].bg);
        } else if (__ui_nodes[i].hasBg) {
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        }
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          uint16_t bColor = __ui_nodes[i].borderColor ? __ui_nodes[i].borderColor : __ui_nodes[i].fg;
          ui_draw_node_border(i, drawY, bColor);
        }
        break;
      case NODE_TEXT:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          // Clear height: the glyph may be taller than the box (e.g. bold text
          // bumps textSize, making ts*8 > box.h). Without clearing the full
          // glyph height, the bottom portion leaves ghost pixels on scroll.
          uint16_t clearH = __ui_nodes[i].box.h;
          uint16_t glyphH = ts * 8;
          if (glyphH > clearH) clearH = glyphH;
          // Dynamic transparent text still needs a clear, otherwise old glyph
          // pixels accumulate when only this text node is dirty.
          uint16_t clearCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, clearW, clearH, clearCol);
          __ui_nodes[i].lastTextWidth = tw;
        }
        {
          // Text shadow: draw the text in the shadow color at the offset first.
          uint16_t tsClear = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          if (__ui_nodes[i].textShadowCount > 0) {
            uint16_t tsCol = ui_blend565(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
            ui_draw_text(displayText,
              textX + __ui_nodes[i].textShadowOffsetX,
              drawY + __ui_nodes[i].textShadowOffsetY,
              tsCol, tsCol, ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
          }
          // Use transparent bg (fg as bg) when no own background, so the parent's
          // gradient/background shows through instead of an opaque clear rect.
          uint16_t textBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].fg;
          ui_draw_text(displayText, textX, drawY, __ui_nodes[i].fg,
            textBg, ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
        }
        if (__ui_nodes[i].underline)
          __ui_gfx->drawFastHLine(textX, drawY + ui_text_height(ts, __ui_nodes[i].fontFace) - 1, tw, __ui_nodes[i].fg);
        break;
      case NODE_BUTTON:
        if (__ui_nodes[i].borderRadius > 0 && __ui_nodes[i].hasBg)
          __ui_gfx->fillRoundRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].borderRadius, __ui_nodes[i].bg);
        else if (__ui_nodes[i].hasBg)
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, __ui_nodes[i].box.w, __ui_nodes[i].box.h, __ui_nodes[i].bg);
        ui_draw_shadow(i, drawY, 1);
        if (__ui_nodes[i].borderStyle != 0) {
          ui_draw_node_border(i, drawY, bColor);
        }
        ui_draw_text(displayText,
          __ui_nodes[i].box.x + (__ui_nodes[i].box.w - tw) / 2,
          drawY + (__ui_nodes[i].box.h - ui_text_height(ts, __ui_nodes[i].fontFace)) / 2,
          __ui_nodes[i].fg,
          __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
          ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
        break;
      case NODE_CHECK:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
        }
        {
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
          if (__ui_nodes[i].value) {
            __ui_gfx->fillRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
            uint16_t inv = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
#ifdef UI_AA
            {
              // Draw the checkmark to a 16×16 AA canvas for smooth diagonals.
              GFXcanvas16* c = ui_aa_begin(16, 16, __ui_nodes[i].fg);
              // First stroke: down-left (3,8 → 7,12)
              ui_aa_line(c, 4.0f, 8.0f, 7.0f, 12.0f, inv);
              ui_aa_line(c, 5.0f, 8.0f, 8.0f, 12.0f, inv);
              // Second stroke: up-right (7,11 → 13,4)
              ui_aa_line(c, 7.0f, 11.0f, 13.0f, 4.0f, inv);
              ui_aa_line(c, 8.0f, 11.0f, 14.0f, 4.0f, inv);
              ui_aa_push(c, cbX, cbY);
            }
#else
            __ui_gfx->drawLine(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
            __ui_gfx->drawLine(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
            __ui_gfx->drawLine(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
            __ui_gfx->drawLine(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
            __ui_gfx->drawLine(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
            __ui_gfx->drawLine(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
#endif
          } else {
            __ui_gfx->drawRect(cbX, cbY, 16, 16, __ui_nodes[i].fg);
          }
        }
        ui_draw_text(displayText, __ui_nodes[i].box.x + 22, drawY, __ui_nodes[i].fg,
          __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
          ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
        break;
      case NODE_RADIO:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > (int16_t)clearW) {
            clearW = (uint16_t)__ui_nodes[i].lastTextWidth;
          }
          __ui_gfx->fillRect(__ui_nodes[i].box.x, drawY, clearW, __ui_nodes[i].box.h,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          __ui_nodes[i].lastTextWidth = tw;
          int16_t cbX = __ui_nodes[i].box.x;
          int16_t cbY = drawY;
#ifdef UI_AA
          {
            // Render the radio circle to a 16×16 AA canvas, then push.
            uint16_t radioBg = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
            GFXcanvas16* c = ui_aa_begin(16, 16, radioBg);
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
            __ui_gfx->fillCircle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
            __ui_gfx->fillCircle(cbX + 8, cbY + 8, 3, __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor);
          } else {
            __ui_gfx->drawCircle(cbX + 8, cbY + 8, 7, __ui_nodes[i].fg);
          }
#endif
        }
        ui_draw_text(displayText, __ui_nodes[i].box.x + 22, drawY, __ui_nodes[i].fg,
          __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
          ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
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
            __ui_gfx->drawRect(bx, by, bw, bh, fgCol);
            __ui_gfx->fillRect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
            if (fillW > 0) {
              __ui_gfx->fillRect(bx + 1, by + 1, fillW, bh - 2, fgCol);
            }
          } else if (fillW > prevW) {
            // Value increased: draw new fill segment on top (no clear needed)
            __ui_gfx->fillRect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
          } else if (fillW < prevW) {
            // Value decreased: clear the removed portion
            __ui_gfx->fillRect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
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
            __ui_gfx->drawFastHLine(bx, trackY, bw, dimFg);
            __ui_gfx->drawFastHLine(bx + 4, trackY, fillW, fgCol);
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
            __ui_gfx->fillRect(left, trackY - 5, right - left, 10, bgCol);
            // Restore the track line over the wiped strip: bright up to the
            // current fill end, dim beyond it.
            int16_t fillEnd = bx + 4 + fillW;
            if (right <= fillEnd) {
              __ui_gfx->drawFastHLine(left, trackY, right - left, fgCol);
            } else if (left >= fillEnd) {
              __ui_gfx->drawFastHLine(left, trackY, right - left, dimFg);
            } else {
              __ui_gfx->drawFastHLine(left, trackY, fillEnd - left, fgCol);
              __ui_gfx->drawFastHLine(fillEnd, trackY, right - fillEnd, dimFg);
            }
          }

          // Thumb: small filled rectangle at the current position.
          if (newThumbX < bx + 1) newThumbX = bx + 1;
          if (newThumbX > bx + bw - 7) newThumbX = bx + bw - 7;
          __ui_gfx->fillRect(newThumbX, trackY - 5, 6, 10, fgCol);

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
            __ui_gfx->fillRoundRect(bx, by, bw, bh, __ui_nodes[i].borderRadius, bgCol);
          } else {
            __ui_gfx->fillRect(bx, by, bw, bh, bgCol);
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
          __ui_gfx->setCursor(bx + 4, by + (bh - ts * 8) / 2);
          __ui_gfx->setTextColor(textCol, bgCol);
          __ui_gfx->setTextSize(ts);
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
        if (__ui_nodes[i].imgDataId < __ui_image_count) {
          const UIImage* img = &__ui_images[__ui_nodes[i].imgDataId];
          __ui_gfx->drawRGBBitmap(__ui_nodes[i].box.x, drawY,
                                   img->data, img->w, img->h);
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
        GFXcanvas16* lc = ui_get_scroll_canvas(bw, bh);
        if (lc) {
          lc->fillScreen(clearCol);
          // Compute visible range.
          uint16_t first = ls->scrollY / ih;
          uint16_t last = (ls->scrollY + bh - 1) / ih + 1;
          if (ls->itemCount > 0 && last >= ls->itemCount) last = ls->itemCount - 1;
          // Draw each visible item (canvas-local coords: 0,0 = viewport top).
          char listBuf[UI_TEXT_BUF + 1];
          lc->setTextWrap(false);
          for (uint16_t idx = first; idx <= last; idx++) {
            int16_t itemY = (int16_t)(idx * ih) - ls->scrollY;
            ls->itemFn(idx, listBuf, UI_TEXT_BUF + 1);
            listBuf[UI_TEXT_BUF] = 0;
            lc->setCursor(4, itemY + (ih - 16) / 2);
            lc->setTextColor(__ui_nodes[i].fg);
            lc->setTextSize(2);
            lc->print(listBuf);
          }
          // Scrollbar (canvas-local coords).
          if (ls->contentHeight > (uint16_t)bh) {
            int16_t tx = bw - 4;
            uint16_t thumbH = (uint32_t)bh * bh / ls->contentHeight;
            if (thumbH < 8) thumbH = 8;
            uint16_t thumbY = (uint32_t)(bh - thumbH) * ls->scrollY / (ls->contentHeight - bh);
            uint16_t dimFg = ((__ui_nodes[i].fg >> 1) & 0x7BEF);
            lc->fillRect(tx, 0, 3, bh, dimFg);
            lc->fillRect(tx, thumbY, 3, thumbH, __ui_nodes[i].fg);
          }
          // Push canvas to display at viewport position.
          __ui_gfx = &__tc_display;
          ui_push_canvas_rect(lc, bx, by, bw, bh);
        }
        break;
      }
    }
    ui_draw_node_outline(i, drawY);
    if (drawingPaintCanvas) {
      __ui_gfx = &__tc_display;
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
    __ui_gfx = bufferedScrollCanvas;
    uint8_t si = (uint8_t)bufferedScrollNode;
    int16_t vw = __ui_nodes[si].box.w;
    int16_t vh = __ui_nodes[si].box.h;
    int16_t tx = vw - 4;
    uint16_t thumbH = (uint32_t)vh * vh / __ui_nodes[si].contentHeight;
    if (thumbH < 8) thumbH = 8;
    int16_t maxScroll = __ui_nodes[si].contentHeight - vh;
    uint16_t thumbY = (uint32_t)(vh - thumbH) * __ui_nodes[si].scrollY / (maxScroll > 0 ? maxScroll : 1);
    uint16_t dimFg = ((__ui_nodes[si].fg >> 1) & 0x7BEF);
    __ui_gfx->fillRect(tx, 0, 3, vh, dimFg);
    __ui_gfx->fillRect(tx, thumbY, 3, thumbH, __ui_nodes[si].fg);
    // Push the canvas to the display at the viewport position.
    __ui_gfx = &__tc_display;
    ui_push_canvas_rect(bufferedScrollCanvas,
      bufferedScrollVX, bufferedScrollVY,
      vw, vh);
  }
  __ui_gfx = &__tc_display;
  // ③ Flush — ILI9341 is immediate, no separate flush needed.
}

// ── Antialiasing subsystem (offscreen canvas + coverage blending) ──────────
// Enabled via #define UI_AA 1 (from display profile antialias:true).
// Shapes are rendered to a GFXcanvas16, edges blended via getPixel read-back,
// then pushed to the display. The ILI9341 has no efficient SPI read-back, so
// all blending happens in RAM.
#ifdef UI_AA

static GFXcanvas16* __ui_aa_canvas = nullptr;

// Get (or allocate) a canvas sized to the element being drawn.
static inline GFXcanvas16* ui_aa_begin(int16_t w, int16_t h, uint16_t bg) {
  if (!__ui_aa_canvas || __ui_aa_canvas->width() < w || __ui_aa_canvas->height() < h) {
    delete __ui_aa_canvas;
    __ui_aa_canvas = new GFXcanvas16(w > 0 ? w : 1, h > 0 ? h : 1);
  }
  if (!__ui_aa_canvas || !__ui_aa_canvas->getBuffer()) return nullptr;
  __ui_aa_canvas->fillScreen(bg);
  return __ui_aa_canvas;
}

// Push the canvas rect to the display at (dx, dy).
static inline void ui_aa_push(GFXcanvas16* c, int16_t dx, int16_t dy) {
  if (!c || !c->getBuffer()) return;
  int16_t w = c->width(), h = c->height();
  // Push via __ui_gfx so the AA output goes to the scroll canvas when active,
  // or the display directly when not. Row-by-row drawRGBBitmap (no transparent
  // alpha — the AA canvas already has the blended pixels).
  for (int16_t row = 0; row < h; row++) {
    __ui_gfx->drawRGBBitmap(dx, dy + row, c->getBuffer() + (int32_t)row * w, w, 1);
  }
}

// Blend a pixel at integer coords with a coverage fraction (0-255).
static inline void ui_aa_pixel(GFXcanvas16* c, int16_t x, int16_t y, uint16_t color, uint8_t cov) {
  if (!c || !c->getBuffer()) return;
  if (cov == 0) return;
  if (x < 0 || y < 0 || x >= c->width() || y >= c->height()) return;
  if (cov >= 255) { c->drawPixel(x, y, color); return; }
  uint16_t bg = c->getPixel(x, y);
  uint8_t op = (uint8_t)((uint16_t)cov * 100 / 255);
  c->drawPixel(x, y, ui_blend565(color, bg, op));
}

// Xiaolin Wu antialiased line. Coordinates are in canvas-local space.
static inline void ui_aa_line(GFXcanvas16* c, float x0, float y0, float x1, float y1, uint16_t color) {
  if (!c || !c->getBuffer()) return;
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
static inline void ui_aa_circle(GFXcanvas16* c, int16_t cx, int16_t cy, float r, uint16_t color) {
  if (!c || !c->getBuffer()) return;
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
      if (x >= 0 && x < c->width()) c->drawPixel(x, y, color);
    }
  }
}

// Antialiased filled circle.
static inline void ui_aa_fill_circle(GFXcanvas16* c, int16_t cx, int16_t cy, float r, uint16_t color) {
  if (!c || !c->getBuffer()) return;
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
      if (x >= 0 && x < c->width() && y >= 0 && y < c->height()) c->drawPixel(x, y, color);
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
  __tc_display.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, bg);
  __tc_display.drawRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, border);
  __tc_display.setTextColor(fg, bg);
  __tc_display.setTextSize(1);
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
  __tc_display.setCursor(cx, cy);
  __tc_display.print(labelStr);
}

// Redraw only the text display row (top of keyboard box). Used when a char is
// inserted/deleted without changing key highlights.
static inline void ui_kb_draw_text_row() {
  // Clear the text row area (top UI_KB_TEXT_H px of the keyboard box).
  __tc_display.fillRect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, UI_KB_TEXT_H, __ui_kb_bg);
  __tc_display.setCursor(__ui_kb_box.x + 4, __ui_kb_box.y + 4);
  __tc_display.setTextColor(0xFFFF, 0x0000);
  __tc_display.setTextSize(2);
  __tc_display.print(__ui_kb_buffer);
  __tc_display.print("_");  // cursor
}

// Draw the full keyboard overlay (background + text row + all keys).
static inline void ui_kb_draw() {
  // Opaque background over the keyboard box.
  __tc_display.fillRect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, __ui_kb_box.h, __ui_kb_bg);
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
