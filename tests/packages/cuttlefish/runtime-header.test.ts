import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "@typecad/cuttlefish/ui/runtime-header";

describe("C++ reactive runtime header", () => {
  const header = emitRuntimeHeader();

  it("declares the UINode, UITransition, and UIBinding structs", () => {
    expect(header).toMatch(/struct\s+UINode/);
    expect(header).toMatch(/struct\s+UITransition/);
    expect(header).toMatch(/struct\s+UIBinding/);
  });

  it("declares ui_mark_dirty for marking nodes dirty", () => {
    expect(header).toContain("ui_mark_dirty");
  });

  it("declares the per-frame ui_tick driver", () => {
    expect(header).toContain("ui_tick");
  });

  it("contains a color lerp helper for transitions", () => {
    expect(header).toContain("lerp_color");
    expect(header).toMatch(/\(int16_t\)br\s*-\s*\(int16_t\)ar/);
  });

  it("declares property-aware keyframe animation structs", () => {
    expect(header).toMatch(/struct\s+UIKeyframeStop/);
    expect(header).toMatch(/uint8_t\s+props/);
    expect(header).toContain("#define UI_KF_BG 1");
    expect(header).toContain("#define UI_KF_FG 2");
    expect(header).toContain("#define UI_KF_OPACITY 4");
    expect(header).toContain("#define UI_KF_TRANSFORM 8");
    expect(header).toContain("#define UI_KF_SIZE 16");
    expect(header).toMatch(/int16_t\s+transformOffsetX/);
    expect(header).toMatch(/int16_t\s+transformOffsetY/);
    expect(header).toMatch(/int16_t\s+translatePctX/);
    expect(header).toMatch(/int16_t\s+translatePctY/);
    expect(header).toMatch(/int16_t\s+scaleX/);
    expect(header).toMatch(/int16_t\s+scaleY/);
    expect(header).toMatch(/int16_t\s+rotateDeg/);
    expect(header).toMatch(/int16_t\s+width/);
    expect(header).toMatch(/int16_t\s+height/);
  });

  it("applies animated transforms by clearing the previous paint before moving the node", () => {
    expect(header).toContain("ui_clear_current_node_paint");
    expect(header).toMatch(/sLo->props\s*&\s*UI_KF_TRANSFORM/);
    expect(header).toMatch(/ui_clear_current_node_paint\(n\)[\s\S]*transformOffsetX\s*=\s*nextTransformX/);
    expect(header).toMatch(/sLo->props\s*&\s*UI_KF_SIZE/);
    expect(header).toMatch(/box\.w\s*=\s*nextWidth/);
  });

  it("supports percentage translate, scale, origin, and quarter-turn image rotation in keyframes", () => {
    expect(header).toMatch(/baseWidth/);
    expect(header).toMatch(/originX/);
    expect(header).toMatch(/translatePctX/);
    expect(header).toMatch(/scaleOffsetX/);
    expect(header).toContain("ui_draw_image_rotated");
    expect(header).toContain("ui_draw_image_with_fit");
    expect(header).toMatch(/for\s*\(int16_t ty = 0; ty < targetH; ty\+\+\)/);
    expect(header).toMatch(/dx = targetH - 1 - ty/);
    expect(header).toMatch(/ui_display_draw_pixel\(x \+ rdx, y \+ rdy, color\)/);
    expect(header).toMatch(/case\s+NODE_IMG:[\s\S]*ui_draw_image_with_fit/);
  });

  it("uses 32-bit keyframe animation timers so redraw throttling survives long runs", () => {
    expect(header).toMatch(/struct\s+UIAnimation[\s\S]*uint32_t\s+elapsed/);
    expect(header).toMatch(/struct\s+UIAnimation[\s\S]*uint32_t\s+lastUpdateMs/);
    expect(header).toMatch(/uint32_t\s+elapsedNoDelay\s*=\s*__ui_anims\[i\]\.elapsed/);
  });

  it("contains press/release entry points", () => {
    expect(header).toContain("ui_on_press");
    expect(header).toContain("ui_on_release");
  });

  it("repairs pressed-offset clears with the parent-seeded local canvas", () => {
    expect(header).toMatch(/ui_clear_press_offset_area[\s\S]*ui_repair_current_node_paint_with_parent\(nodeIdx,\s*&r\)[\s\S]*ui_display_fill_rect/);
  });

  it("routes runtime display operations through Cuttlefish display shims", () => {
    expect(header).toContain("ui_display_draw_pixel");
    expect(header).toContain("ui_display_set_target");
    expect(header).toContain("display_canvasBuffer");
    expect(header).not.toMatch(/__ui_gfx->/);
    expect(header).not.toMatch(/__tc_display\./);
    expect(header).not.toMatch(/Adafruit_GFX\*/);
    expect(header).not.toMatch(/GFXcanvas16\*/);
  });

  it("declares the draw dispatch (NODE_FILL / NODE_TEXT)", () => {
    expect(header).toContain("NODE_FILL");
    expect(header).toContain("NODE_TEXT");
  });

  it("is wrapped in an include guard", () => {
    expect(header).toMatch(/#ifndef\s+__TC_UI_RUNTIME/);
    expect(header).toMatch(/#define\s+__TC_UI_RUNTIME/);
    expect(header).toContain("#endif");
  });

  it("defines UI_TEXT_BUF as 32", () => {
    expect(header).toMatch(/#define\s+UI_TEXT_BUF\s+32/);
  });

  it("keeps full-screen framebuffer rendering opt-in", () => {
    expect(header).toMatch(/#ifndef\s+UI_USE_FULL_FRAMEBUFFER[\s\S]*#define\s+UI_USE_FULL_FRAMEBUFFER\s+0/);
    expect(header).toMatch(/#if\s+UI_USE_FULL_FRAMEBUFFER\s*&&\s*defined\(ESP32\)\s*&&\s*defined\(BOARD_HAS_PSRAM\)/);
  });

  it("snaps very short color transitions to avoid repeated hardware redraws", () => {
    expect(header).toMatch(/#ifndef\s+UI_TRANSITION_SNAP_MS[\s\S]*#define\s+UI_TRANSITION_SNAP_MS\s+100/);
    expect(header).toMatch(/durationMs > 0 && __ui_trans\[i\]\.durationMs <= UI_TRANSITION_SNAP_MS\) k = 100/);
  });

  it("UINode has a mutable textBuffer and hasTextBinding field", () => {
    expect(header).toMatch(/char\s+textBuffer\[UI_TEXT_BUF\s*\+\s*1\]/);
    expect(header).toMatch(/uint8_t\s+hasTextBinding/);
  });

  it("UIBinding textFn signature is void fill-style (char*, uint8_t)", () => {
    expect(header).toMatch(/void\s+\(\*textFn\)\(char\*\s*buf,\s*uint8_t\s*size\)/);
  });

  it("ui_init seeds textBuffer from the flash literal for PROP_TEXT bindings", () => {
    // ui_init must: set hasTextBinding=1, strncpy text→textBuffer, NUL-terminate.
    expect(header).toMatch(/ui_init[\s\S]*hasTextBinding\s*=\s*1/);
    expect(header).toMatch(/ui_init[\s\S]*strncpy\(\s*__ui_nodes\[n\]\.textBuffer,\s*__ui_nodes\[n\]\.text\s*\?\s*__ui_nodes\[n\]\.text\s*:\s*"",\s*UI_TEXT_BUF\s*\)/);
    expect(header).toMatch(/ui_init[\s\S]*textBuffer\[UI_TEXT_BUF\]\s*=\s*'\\0'/);
  });

  it("ui_tick text-binding dispatch compares by content (strcmp), not pointer", () => {
    // Must: save oldBuf, call textFn(buf,size), strcmp to decide dirty.
    expect(header).toMatch(/char\s+oldBuf\[UI_TEXT_BUF\s*\+\s*1\]/);
    expect(header).toMatch(/strncpy\(\s*oldBuf,\s*__ui_nodes\[.*?\]\.textBuffer,\s*UI_TEXT_BUF\s*\)/);
    expect(header).toMatch(/textFn\(\s*__ui_nodes\[.*?\]\.textBuffer,\s*UI_TEXT_BUF\s*\+\s*1\s*\)/);
    expect(header).toMatch(/strcmp\(\s*oldBuf,\s*__ui_nodes\[.*?\]\.textBuffer\s*\)\s*!=\s*0/);
  });

  it("draw dispatch selects displayText by hasTextBinding (textBuffer vs text)", () => {
    // The dirty-node loop must declare a displayText local and read from it.
    expect(header).toMatch(/const char\*\s+displayText\s*=\s*__ui_nodes\[i\]\.hasTextBinding\s*\?\s*__ui_nodes\[i\]\.textBuffer\s*:\s*__ui_nodes\[i\]\.text/);
    // And the text draw must use displayText, not __ui_nodes[i].text.
    expect(header).toMatch(/ui_draw_wrapped_text\(\s*displayText/);
  });

  it("supports wrapped text layout without heap allocation", () => {
    expect(header).toMatch(/uint8_t\s+lineHeight/);
    expect(header).toMatch(/uint8_t\s+whiteSpaceMode/);
    expect(header).toMatch(/int16_t\s+lastTextHeight/);
    expect(header).toContain("ui_text_next_line");
    expect(header).toContain("ui_text_layout_metrics");
    expect(header).toContain("char lineBuf[UI_TEXT_LINE_BUF]");
    expect(header).not.toMatch(/new\s+char/);
  });

  it("decodes UTF-8 before generated font glyph lookup", () => {
    expect(header).toContain("ui_next_utf8_codepoint");
    expect(header).toMatch(/ui_asset_text_width[\s\S]*ui_next_utf8_codepoint\(&p\)[\s\S]*ui_font_glyph\(face,\s*codepoint\)/);
    expect(header).toMatch(/ui_draw_asset_text[\s\S]*ui_next_utf8_codepoint\(&p\)[\s\S]*ui_font_glyph\(face,\s*codepoint\)/);
  });

  it("keeps generated font glyph lookup syntactically balanced", () => {
    expect(header).toMatch(/ui_font_glyph[\s\S]*if \(face->glyphs\[i\]\.codepoint == codepoint\)[\s\S]*return nullptr;\n}\n\nstatic inline uint8_t ui_font_alpha_at/);
    expect(header).not.toMatch(/ui_font_glyph[\s\S]*return nullptr;\n}\n\s*return nullptr;\n}/);
  });

  it("uses tree metadata for scroll ownership", () => {
    expect(header).toMatch(/uint8_t\s+parent/);
    expect(header).toMatch(/uint8_t\s+subtreeEnd/);
    expect(header).toContain("ui_draw_y_for_node");
    // The unified scroll-scan keys on scrollable nodes; lists are scrollable.
    expect(header).toMatch(/for \(uint8_t i = 0; i < __ui_node_count; i\+\+\)[\s\S]*!__ui_nodes\[i\]\.scrollable/);
    expect(header).toContain("ui_mark_scroll_subtree_dirty");
  });

  it("marks a scroll subtree with one container-level overlap check, not per-child", () => {
    // The scroll overlap-repair optimization: instead of calling ui_mark_dirty
    // (which runs an O(n) overlap scan) on every child, scroll marking sets the
    // dirty flags directly and runs a single overlap check at the container.
    expect(header).toContain("ui_mark_subtree_dirty_local");
    // The scroll-tree dirty loop must set dirty directly (not call ui_mark_dirty),
    // otherwise the per-child O(n) overlap repair is reintroduced.
    expect(header).toMatch(/ui_mark_subtree_dirty_local\(uint8_t scrollNode\)[\s\S]*?__ui_nodes\[c\]\.dirty = 1/);
    // ui_mark_scroll_subtree_dirty delegates to the local mark + ONE overlap check
    // (tolerant of the explanatory comments in the body).
    expect(header).toMatch(/ui_mark_scroll_subtree_dirty\(uint8_t scrollNode\) \{[\s\S]*ui_mark_subtree_dirty_local\(scrollNode\);[\s\S]*ui_mark_overlapping_higher_layers_dirty\(scrollNode\);[\s\S]*\}/);
    // And it must NOT loop calling ui_mark_dirty per child (the old O(K·n) form).
    expect(header).not.toMatch(/ui_mark_scroll_subtree_dirty\(uint8_t scrollNode\) \{[\s\S]*?for[\s\S]*?ui_mark_dirty\(c\)/);
  });

  it("keeps normal dirty marking local while repairing overlapping higher z-index layers", () => {
    expect(header).toMatch(/int16_t\s+zIndex/);
    expect(header).toContain("ui_node_draws_before");
    expect(header).toContain("ui_mark_overlapping_higher_layers_dirty");
    // ui_mark_dirty no longer touches a scroll cache (the cache was deleted); it
    // sets dirty + repairs overlapping higher-z neighbors.
    expect(header).toMatch(/static inline void ui_mark_dirty\(uint8_t nodeIdx\) \{\s*if \(nodeIdx >= __ui_node_count\) return;\s*__ui_nodes\[nodeIdx\]\.dirty = 1;\s*ui_mark_overlapping_higher_layers_dirty\(nodeIdx\);\s*\}/);
    expect(header).not.toContain("ui_invalidate_scroll_cache_for_node");
    expect(header).not.toContain("for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1; // z-index repair");
  });

  it("applies visible bindings by clearing hidden branches and repainting shown subtrees", () => {
    expect(header).toContain("PROP_VISIBLE");
    expect(header).toContain("ui_is_effectively_visible");
    expect(header).toContain("ui_set_visible");
    expect(header).toContain("ui_subtree_current_paint_rect");
    expect(header).toContain("ui_clear_subtree_current_paint");
    expect(header).toContain("ui_mark_overlapping_higher_layers_dirty_for_rect");
    expect(header).toMatch(/__ui_bindings\[i\]\.prop == PROP_VISIBLE[\s\S]*ui_set_visible\(__ui_bindings\[i\]\.node,\s*nextVisible\)/);
    expect(header).toMatch(/if \(!visible\)[\s\S]*ui_clear_subtree_current_paint\(nodeIdx\)/);
    expect(header).toMatch(/ui_subtree_current_paint_rect[\s\S]*ui_expand_rect/);
    expect(header).toMatch(/hasSubtreeRect[\s\S]*ui_mark_overlapping_higher_layers_dirty_for_rect\(nodeIdx,\s*&subtreeRect\)/);
    expect(header).toMatch(/for \(uint8_t c = nodeIdx; c < end; c\+\+\)[\s\S]*__ui_nodes\[c\]\.dirty = 1/);
  });

  it("draws dirty nodes in z-index order", () => {
    expect(header).toMatch(/for \(uint8_t __ui_draw_pass = 0; __ui_draw_pass < __ui_node_count; __ui_draw_pass\+\+\)/);
    expect(header).toMatch(/ui_node_draws_before\(candidate,\s*\(uint8_t\)selected\)/);
  });

  it("only clears a scroll viewport when the scroll container itself is dirty", () => {
    expect(header).not.toContain("hasDirtyChild");
    expect(header).toMatch(/if\s*\(!__ui_nodes\[s\]\.dirty\)\s*continue/);
  });

  it("draws scrollbars into the buffered canvas (not the display)", () => {
    // Scrollbar draws to the canvas before push — no direct-display flash.
    expect(header).toMatch(/ui_display_set_target\(bufferedScrollCanvas\)[\s\S]*ui_display_fill_rect\(tx,\s*(?:ty|0)/);
    expect(header).not.toContain("scrollbarDirty");
  });

  it("applies the smoothed scroll delta directly each frame (no accumulator/cadence)", () => {
    expect(header).toContain("ui_apply_scroll_delta");
    expect(header).toContain("ui_scroll_smooth_dy");
    // The new engine applies dy immediately via the input→physics path; there is
    // no pending-delta accumulator and no redraw-cadence gate.
    expect(header).not.toContain("UI_SCROLL_DRAG_MULTIPLIER");
    expect(header).not.toContain("__ui_scroll_pending_dy");
    expect(header).not.toContain("UI_SCROLL_STEP_PX");
    expect(header).not.toContain("UI_SCROLL_FRAME_MS");
    expect(header).toMatch(/ui_scroll_smooth_dy[\s\S]*ui_apply_scroll_delta/);
  });

  it("emits the new scroll physics + capability defines (no 3x multiplier)", () => {
    expect(header).toContain("#ifndef UI_SCROLL_MAX_OVERSCROLL");
    expect(header).toContain("#ifndef UI_SCROLL_STIFFNESS_X10");
    expect(header).toContain("#ifndef UI_SCROLL_EDGE_SNAP_PX");
    expect(header).toContain("#ifndef UI_SCROLL_SETTLE_MS");
    expect(header).toContain("UI_SCROLL_INPUT_TIER_");
    expect(header).toContain("UI_SCROLL_RENDER_TIER_");
    expect(header).toContain("UI_SCROLL_HAS_TOUCH");
    expect(header).toContain("UI_SCROLL_ELASTIC");
  });

  it("UINode carries unified scroll state on the node", () => {
    expect(header).toMatch(/uint8_t virtualized/);
    expect(header).toMatch(/int16_t overscrollPx/);
    expect(header).toMatch(/uint8_t settling/);
    expect(header).toMatch(/int16_t lastPaintedScrollY/);
    // List function pointers live on the node now, not in a side table.
    expect(header).toMatch(/uint16_t \(\*listCountFn\)\(void\)/);
    expect(header).toMatch(/void \(\*listItemFn\)\(uint16_t[^)]+\)/);
    expect(header).toMatch(/void \(\*listTapFn\)\(uint16_t[^)]*\)/);
    // The old UIListState side table + the dual gesture are gone.
    expect(header).not.toMatch(/struct UIListState/);
    expect(header).not.toContain("__ui_list_drag");
    expect(header).not.toContain("__ui_scroll_snap_top");
    expect(header).not.toContain("__ui_scroll_start_y");
    expect(header).not.toContain("ui_snap_scroll_to_top");
  });

  it("releases via ui_scroll_release and advances the settle in ui_tick", () => {
    expect(header).toContain("ui_scroll_release");
    expect(header).toContain("ui_scroll_advance_settle");
    expect(header).toContain("ui_scroll_overscroll_for");
    expect(header).toMatch(/ui_scroll_release\(__ui_scroll_node\)/);
    expect(header).toMatch(/ui_scroll_advance_settle\(i,\s*deltaMs\)/);
  });

  it("renders scroll containers via a per-container shift-and-repair canvas (Mode B)", () => {
    expect(header).toContain("ui_get_container_canvas");
    expect(header).toContain("ui_shift_container_canvas");
    expect(header).toContain("memmove");
    // The shift delta comes from the node's lastPaintedScrollY, not a global cache.
    expect(header).toMatch(/__ui_nodes\[s\]\.scrollY\s*-\s*__ui_nodes\[s\]\.lastPaintedScrollY/);
    // The old global scroll-cache machinery is gone.
    expect(header).not.toContain("__ui_scroll_cache_node");
    expect(header).not.toContain("__ui_scroll_repaint_canvas");
    expect(header).not.toContain("ui_shift_scroll_canvas");
    expect(header).not.toContain("ui_invalidate_scroll_cache");
  });

  it("drops the off-screen scroll-canvas cache compositing entirely", () => {
    // The rewrite replaced the global scroll-cache machinery with a per-container
    // canvas keyed on lastPaintedScrollY. None of the old cache symbols remain.
    expect(header).not.toContain("__ui_scroll_cache_node");
    expect(header).not.toContain("__ui_scroll_cache_valid");
    expect(header).not.toContain("__ui_scroll_repaint_canvas");
    expect(header).not.toContain("ui_get_scroll_canvas_keep_cache");
    expect(header).not.toContain("ui_get_scroll_repaint_canvas");
    expect(header).not.toContain("ui_invalidate_scroll_cache");
    // The per-container canvas + shift helper are the replacement.
    expect(header).toContain("ui_get_container_canvas");
    expect(header).toContain("ui_shift_container_canvas");
  });

  it("seeds on-node list fn pointers from the UIListBinding table in ui_init", () => {
    // ui.bindList resolves after ui.mount lowers the HTML, so the static node
    // initializer can't see the binding; ui_init copies the pointers on-node.
    expect(header).toContain("__ui_list_bindings[b].countFn");
    expect(header).toMatch(/__ui_nodes\[n\]\.listCountFn\s*=\s*__ui_list_bindings\[b\]\.countFn/);
    expect(header).toMatch(/__ui_nodes\[n\]\.listItemFn\s*=\s*__ui_list_bindings\[b\]\.itemFn/);
    // The NODE_LIST draw reads on-node state, not a UIListState side table.
    expect(header).toMatch(/case NODE_LIST:[\s\S]*if \(!__ui_nodes\[i\]\.listItemFn\) break/);
  });

  it("composites list canvases into buffered scroll containers instead of pushing at local coordinates", () => {
    expect(header).toContain("ui_draw_canvas_rect");
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*if\s*\(drawingBufferedScroll\)\s*\{[\s\S]*ui_draw_canvas_rect\(lc,\s*bx,\s*by,\s*bw,\s*bh\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*else\s*\{[\s\S]*ui_push_canvas_rect\(lc,\s*bx,\s*by,\s*bw,\s*bh\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*__ui_nodes\[i\]\.box\.x\s*=\s*origBoxX;[\s\S]*__ui_nodes\[i\]\.box\.y\s*=\s*origBoxY;[\s\S]*continue/);
  });

  it("repairs animated geometry clears inside scroll containers with a parent-seeded local canvas", () => {
    expect(header).toContain("ui_scroll_ancestor_for_node");
    expect(header).toContain("ui_repair_current_node_paint_with_parent");
    expect(header).toContain("ui_fill_rect_clipped");
    expect(header).toContain("ui_draw_node_decoration_clipped");
    expect(header).toMatch(/static inline uint8_t ui_repair_current_node_paint_with_parent\(uint8_t nodeIdx,\s*UIRect\* r\);/);
    expect(header).toMatch(/ui_clear_current_node_paint[\s\S]*scrollParent\s*=\s*ui_scroll_ancestor_for_node\(nodeIdx\)/);
    expect(header).toMatch(/if\s*\(scrollParent\s*>=\s*0\)[\s\S]*ui_repair_current_node_paint_with_parent\(nodeIdx,\s*&clipped\)/);
    expect(header).toMatch(/if\s*\(scrollParent\s*>=\s*0\)[\s\S]*ui_draw_node_decoration_clipped/);
    expect(header).toMatch(/if\s*\(geometryChanged\)[\s\S]*ui_clear_current_node_paint\(n\)[\s\S]*__ui_nodes\[n\]\.transformOffsetX = nextTransformX/);
    expect(header).not.toMatch(/if\s*\(geometryChanged\)[\s\S]*ui_mark_scroll_subtree_dirty\(\(uint8_t\)scrollParent\)[\s\S]*__ui_nodes\[n\]\.transformOffsetX = nextTransformX/);
  });

  it("does not repair rounded borders with square clipped corner segments", () => {
    expect(header).toMatch(/ui_draw_node_decoration_clipped[\s\S]*borderRadius > 0[\s\S]*ui_draw_node_border/);
    expect(header).toMatch(/ui_draw_node_decoration_clipped[\s\S]*borderRadius > 0[\s\S]*ui_draw_node_outline/);
  });

  it("closes rounded border tangent pixels so outlines do not have corner pinholes", () => {
    expect(header).toContain("ui_draw_closed_round_rect");
    expect(header).toMatch(/ui_display_draw_round_rect\(x,\s*y,\s*w,\s*h,\s*r,\s*color\)[\s\S]*ui_display_draw_pixel\(x \+ r,\s*y,\s*color\)/);
    expect(header).toMatch(/ui_draw_rect_outline[\s\S]*ui_draw_closed_round_rect/);
  });

  it("does not use the generic paint canvas for simple solid fills", () => {
    expect(header).toMatch(/kind == NODE_FILL[\s\S]*hasBg[\s\S]*gradientEnabled == 0[\s\S]*borderRadius == 0[\s\S]*return 0/);
  });

  it("does not wrap list drawing in the generic paint canvas", () => {
    expect(header).toMatch(/ui_should_buffer_paint[\s\S]*kind == NODE_LIST\)\s*return 0/);
  });

  it("seeds buffered child repaints with rounded parent decoration", () => {
    expect(header).toContain("ui_seed_paint_canvas_for_node");
    expect(header).toMatch(/ui_seed_paint_canvas_for_node[\s\S]*fillRoundRect/);
    expect(header).toMatch(/ui_seed_paint_canvas_for_node\(i,\s*paintCanvas,\s*paintCanvasX,\s*paintCanvasY\)/);
    expect(header).not.toMatch(/paintCanvas->fillScreen\(ui_parent_clear_color\(i\)\)/);
  });

  it("uses ui_is_clipped_by_scroll for scroll child clipping", () => {
    expect(header).toContain("ui_is_clipped_by_scroll");
  });

  it("declares NODE_INPUT in the UINodeKind enum", () => {
    expect(header).toMatch(/NODE_RANGE,\s*NODE_INPUT/);
  });

  it("UINode has a maxlen field", () => {
    expect(header).toMatch(/int16_t\s+maxlen/);
  });

  it("declares the keyboard subsystem structs and globals", () => {
    expect(header).toMatch(/struct\s+UIKey\s*\{\s*char\s+ch;\s*uint8_t\s+special;\s*\}/);
    expect(header).toMatch(/#define\s+UI_KB_MAX\s+48/);
    expect(header).toContain("__ui_kb_keys");
    expect(header).toContain("__ui_kb_buffer");
    expect(header).toContain("__ui_kb_visible");
    expect(header).toContain("__ui_kb_target");
  });

  it("guards keyboard key insertion against fixed array overflow", () => {
    expect(header).toContain("ui_kb_add_key");
    expect(header).toMatch(/if\s*\(__ui_kb_keyCount\s*>=\s*UI_KB_MAX\)\s*return/);
  });

  it("checks AA canvas allocation before use", () => {
    expect(header).toMatch(/if\s*\(!__ui_aa_canvas\s*\|\|\s*!display_canvasBuffer\(__ui_aa_canvas\)\)\s*return\s+nullptr/);
    expect(header).toMatch(/static inline void ui_aa_push[\s\S]*if\s*\(!c\s*\|\|\s*!display_canvasBuffer\(c\)\)\s*return/);
  });

  it("declares ui_kb_open, ui_kb_close, ui_kb_handle_touch", () => {
    expect(header).toContain("ui_kb_open");
    expect(header).toContain("ui_kb_close");
    expect(header).toContain("ui_kb_handle_touch");
  });

  it("draws the keyboard overlay when visible", () => {
    expect(header).toContain("ui_kb_draw");
    expect(header).toMatch(/if\s*\(__ui_kb_visible\)[\s\S]*ui_kb_draw/);
  });

  it("routes touch to the keyboard when visible and inside the box", () => {
    expect(header).toMatch(/__ui_kb_visible[\s\S]*ui_kb_handle_touch/);
  });

  it("opens the keyboard when a NODE_INPUT tap is released without dragging", () => {
    const touchDown = header.match(/static void ui_touch_down[\s\S]*?static void ui_touch_up/)?.[0] ?? "";
    const touchUp = header.match(/static void ui_touch_up[\s\S]*?static inline void ui_handle_touch/)?.[0] ?? "";
    expect(header).toContain("ui_open_keyboard_for_input");
    expect(touchDown).not.toContain("ui_kb_open");
    expect(touchUp).toMatch(/elapsed < UI_TOUCH_HOLD_MS[\s\S]*kind == NODE_INPUT[\s\S]*ui_open_keyboard_for_input/);
  });

  it("draws NODE_INPUT as a bordered field showing textBuffer", () => {
    expect(header).toMatch(/case\s+NODE_INPUT:/);
    expect(header).toMatch(/NODE_INPUT[\s\S]*ui_display_draw_rect/);
  });

  it("keyboard key actions: insert, shift toggle, page-swap, ok close", () => {
    expect(header).toContain("ui_kb_insert");
    expect(header).toContain("ui_kb_handle_tap");
    expect(header).toMatch(/case\s+1:[\s\S]*__ui_kb_shift/);
    expect(header).toMatch(/case\s+3:[\s\S]*ui_kb_close/);
    expect(header).toMatch(/case\s+4:[\s\S]*load_default/);
  });
});

describe("canvas runtime", () => {
  const header = emitRuntimeHeader();
  it("declares NODE_CANVAS + canvas buffer fields + canvas binding table", () => {
    expect(header).toMatch(/NODE_CANVAS/);
    expect(header).toMatch(/uint16_t\s+canvasW/);
    expect(header).toMatch(/uint16_t\s+canvasH/);
    expect(header).toMatch(/struct\s+UICanvasBinding/);
    expect(header).toMatch(/extern\s+UICanvasBinding\s+__ui_canvas_bindings/);
    expect(header).toMatch(/extern\s+const\s+uint8_t\s+__ui_canvas_binding_count/);
  });

  it("has a NODE_CANVAS draw case that sets the canvas target and blits", () => {
    expect(header).toMatch(/case\s+NODE_CANVAS:/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*ui_display_set_target/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*ui_draw_canvas_rect/);
  });
});
