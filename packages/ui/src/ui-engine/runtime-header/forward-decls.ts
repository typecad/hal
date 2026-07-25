// Slice of the C++ runtime header (original source lines 622-752).
// navigate, canvas/scroll/text/paint/clip/AA/image forward declarations, persistent canvas globals.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
//
// EMIT BOUNDARY: This file is the structural head of the UI runtime header
// surface (C) — every partial emitter in this directory produces bytes that are
// assembled into the C++ header inlined into user sketches. The emitted bytes
// are covered by the TypeCAD Runtime Exception (see RUNTIME_EXCEPTION.md at the
// repository root) and are not subject to the license of this tool source.
export function emitForwardDecls(): string {
  return `
// Early forward declaration: ui_navigate (below) calls ui_release_canvas_state
// and ui_set_pressed (defined later) during screen changes. Needed on native
// (single TU, no Arduino auto-prototyper).
static inline void ui_release_canvas_state();
static inline void ui_set_pressed(uint16_t nodeIdx, uint8_t pressed);
static inline void ui_refresh_active_screen_bg_node();

// Navigate to a screen by index. Marks the new screen's nodes dirty, releases
// persistent canvas state, and optionally clears the display.
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
#ifdef UI_AA
static inline CuttlefishCanvas16* ui_aa_begin(int16_t w, int16_t h, UI_COLOR_T bg);
static inline void ui_aa_end(CuttlefishCanvas16* c);
static inline void ui_aa_push(CuttlefishCanvas16* c, int16_t dx, int16_t dy);
static inline void ui_aa_line(CuttlefishCanvas16* c, float x0, float y0, float x1, float y1, UI_COLOR_T color);
static inline void ui_aa_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color);
static inline void ui_aa_fill_circle(CuttlefishCanvas16* c, int16_t cx, int16_t cy, float r, UI_COLOR_T color);
#endif
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
static CuttlefishCanvas16* __ui_kb_canvas = nullptr;         // on-screen keyboard overlay
static int16_t __ui_canvas_fallback_w = 0;                   // dimensions for direct <canvas> fallback
static int16_t __ui_canvas_fallback_h = 0;
// Draw offset: normally zero. The <canvas> allocation fallback sets it so
// callback-local coordinates draw into the node's current display/canvas target.
static int16_t __ui_draw_off_x = 0;
static int16_t __ui_draw_off_y = 0;

// Release every persistent canvas so the next screen allocates into a clean`;
}
