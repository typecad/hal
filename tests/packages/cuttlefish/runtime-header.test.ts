import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "../../../packages/ui/src/ui-engine/runtime-header";
import { deriveCapabilities } from "../../../packages/cuttlefish/src/api/shared/display-capabilities";

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
    expect(header).toMatch(/static_cast<int16_t>\(br\)\s*-\s*static_cast<int16_t>\(ar\)/);
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

  it("applies animated transforms by repairing the old+new footprint before falling back to clears", () => {
    expect(header).toContain("ui_clear_current_node_paint");
    expect(header).toMatch(/sLo->props\s*&\s*UI_KF_TRANSFORM/);
    expect(header).toContain("ui_try_repair_geometry_fill");
    expect(header).toMatch(/ui_node_current_paint_rect\(n,\s*&oldGeometryRect\)[\s\S]*transformOffsetX\s*=\s*nextTransformX/);
    expect(header).toMatch(/repairedGeometry\s*=\s*ui_try_repair_geometry_fill\(n,\s*&oldGeometryRect\)/);
    expect(header).toMatch(/if\s*\(geometryChanged && !repairedGeometry\)[\s\S]*ui_clear_node_paint_rect\(n,\s*&oldGeometryRect\)[\s\S]*if\s*\(!repairedGeometry\)\s*ui_mark_dirty\(n\)/);
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
    expect(header).toMatch(/for\s*\(int16_t ty = tyStart; ty < tyEnd; ty\+\+\)/);
    expect(header).toMatch(/dx = targetH - 1 - ty/);
    expect(header).toMatch(/ui_display_draw_pixel\(x \+ rdx, y \+ rdy, color\)/);
    expect(header).toMatch(/case\s+NODE_IMG:[\s\S]*ui_draw_image_with_fit/);
    expect(header).toMatch(/case\s+NODE_IMG:[\s\S]*imgBg[\s\S]*ui_display_fill_rect[\s\S]*ui_draw_image_with_fit[\s\S]*ui_draw_rect_outline/);
  });

  it("uses 32-bit keyframe animation timers so redraw throttling survives long runs", () => {
    expect(header).toMatch(/struct\s+UIAnimation[\s\S]*uint32_t\s+elapsed/);
    expect(header).toMatch(/struct\s+UIAnimation[\s\S]*uint32_t\s+lastUpdateMs/);
    expect(header).toMatch(/uint32_t\s+elapsedNoDelay\s*=\s*__ui_anims\[i\]\.elapsed/);
  });

  it("carries a timingFunction field on UIAnimation and applies it to the lerp factor", () => {
    // animation-timing-function lives on the animation (not per-stop) and shapes
    // the lerp factor BETWEEN stops. Must be a field on the struct, fed through
    // ui_ease_lerp_k right after lerpK is computed.
    expect(header).toMatch(/struct\s+UIAnimation[\s\S]*uint8_t\s+timingFunction/);
    expect(header).toContain("ui_ease_lerp_k");
    expect(header).toMatch(/uint8_t\s+lerpK\s*=[\s\S]*lerpK\s*=\s*ui_ease_lerp_k\(__ui_anims\[i\]\.timingFunction,\s*lerpK\)/);
  });

  it("does not throttle geometry-animation redraws (60fps) while keeping color at ~10fps", () => {
    // ada49b4 throttled all animation redraws to 10fps to avoid ILI9341 tearing
    // for a color indicator. Spatial transforms are exempt — at 10fps a small
    // moving dot reads as a jump, and only its own tiny footprint repaints.
    // The throttle gate must be gated on !geometryChanged; color/opacity-only
    // animations still honor the 100ms gate.
    expect(header).toMatch(/uint8_t\s+throttleRedraw\s*=\s*!geometryChanged/);
    expect(header).toMatch(/!throttleRedraw\)\s*\{/);
    // The 100ms gate survives for the color-only path.
    expect(header).toMatch(/completing\s*\|\|\s*__ui_anims\[i\]\.elapsed\s*-\s*__ui_anims\[i\]\.lastUpdateMs\s*>=\s*100/);
  });

  it("ease helper solves the cubic-bezier by bisection in pure integer math (no floats)", () => {
    // Newton-Raphson diverged for ease-out (x1=0 → X'(0)=0), snapping animated
    // dots to the wrong keyframe stop and making transforms appear to jump out
    // of bounds. Bisection over t∈[0,1000] always converges (X is monotonic for
    // valid CSS points). int64 accumulation avoids overflow (3e12 > INT32_MAX).
    expect(header).toMatch(/static inline uint8_t ui_ease_lerp_k\s*\(uint8_t timing,\s*uint8_t k\)/);
    expect(header).toMatch(/case\s+UI_TIMING_EASE_IN_OUT:\s*x1\s*=\s*420;\s*y1\s*=\s*0;\s*x2\s*=\s*580;\s*y2\s*=\s*1000/);
    expect(header).toMatch(/int32_t lo\s*=\s*0,\s*hi\s*=\s*1000/);
    expect(header).toMatch(/int64_t termX1\s*=\s*static_cast<int64_t>\(3\)\s*\*\s*mt\s*\*\s*mt\s*\*\s*t\s*\*\s*x1/);
    // The helper body (signature → closing brace) must not use floating-point types.
    const helperBody = header.match(/static inline uint8_t ui_ease_lerp_k[\s\S]*?\n}/)?.[0] ?? "";
    expect(helperBody).not.toMatch(/\b(float|double)\b/);
  });

  it("contains press/release entry points", () => {
    expect(header).toContain("ui_on_press");
    expect(header).toContain("ui_on_release");
  });

  it("repairs pressed-offset clears with the parent-seeded local canvas", () => {
    expect(header).toMatch(/ui_clear_press_offset_area[\s\S]*ui_repair_current_node_paint_with_parent\(nodeIdx,\s*&r\)[\s\S]*ui_display_fill_rect/);
  });

  it("routes runtime display operations through TypeCAD display shims", () => {
    expect(header).toContain("ui_display_draw_pixel");
    expect(header).toContain("ui_display_set_target");
    expect(header).toContain("ui_display_target_width");
    expect(header).toContain("ui_display_target_height");
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

  it("emits a UI_BATCH_SPI_WRITES branch that wraps the frame in startWrite/endWrite", () => {
    // TFT batching path: when UI_BATCH_SPI_WRITES is defined (and neither
    // UI_REQUIRES_BACKING_STORE nor the no-op default applies), begin_frame
    // opens the SPI transaction and flush closes it. add_rect is a no-op
    // (TFT has no partial-refresh concept; the per-node draws already target
    // the right pixels).
    expect(header).toMatch(/#elif\s+defined\(UI_BATCH_SPI_WRITES\)[\s\S]*?ui_refresh_begin_frame\(\)\s*\{\s*display_startWrite\(\);\s*\}/);
    expect(header).toMatch(/#elif\s+defined\(UI_BATCH_SPI_WRITES\)[\s\S]*?ui_refresh_flush\(\)\s*\{\s*display_endWrite\(\);\s*\}/);
  });

  it("e-ink UI_REQUIRES_BACKING_STORE branch is unchanged (rect accumulator + partial refresh)", () => {
    // The e-ink branch must still define the rect accumulator, the add_rect
    // recording, and the union+display_partial_refresh flush — byte-identical
    // to before the three-branch reorganization.
    expect(header).toMatch(/#if\s+defined\(UI_REQUIRES_BACKING_STORE\)[\s\S]*?UI_REFRESH_MAX_RECTS\s+16/);
    expect(header).toMatch(/ui_refresh_begin_frame\(\)\s*\{\s*__ui_refresh_rect_n\s*=\s*0;\s*\}/);
    expect(header).toMatch(/display_partial_refresh\(x0,\s*y0/);
  });

  it("default branch (no flags) keeps the no-op stubs", () => {
    // When neither UI_REQUIRES_BACKING_STORE nor UI_BATCH_SPI_WRITES is defined,
    // all three must be no-op macros (the SDL native host path).
    expect(header).toMatch(/#else[\s\S]*?#define\s+ui_refresh_begin_frame\(\)\s+\(\(void\)0\)/);
    expect(header).toMatch(/#define\s+ui_refresh_flush\(\)\s+\(\(void\)0\)/);
  });

  it("emitter does NOT define UI_BATCH_SPI_WRITES (reverted — library incompatibility)", () => {
    // The batching branch was reverted: the Adafruit_GFX version in this repo
    // does NOT reference-count startWrite/endWrite, so wrapping the frame in
    // startWrite/endWrite causes inner draws to close the transaction mid-frame
    // → black screen. The dispatch branch is retained for a future ref-counted
    // library, but the emitter must NOT define the flag for TFT by default.
    const tft = deriveCapabilities({ colorFormat: "rgb565" });
    expect(tft.refreshModel).toBe("immediate");
    expect(tft.requiresBackingStore).toBe(false);
    // Capabilities qualify, but the emitter's batching emission was removed.
    // The runtime-header default (no-op stubs) applies.
  });

  it("rebuilds the retained framebuffer after navigation", () => {
    // Navigation must not clear the physical TFT before the next frame is ready.
    // Instead it requests a background seed + active-screen full repaint, then
    // the flush phase submits that composed frame in one bulk transfer.
    expect(header).toContain("__ui_fb_needs_compose = 1;");
    expect(header).toMatch(/if\s*\(__ui_fb && __ui_fb_needs_compose\)[\s\S]*display_canvasFillScreen\(__ui_fb, fbBg\);/);
    expect(header).toMatch(/__ui_fb_needs_compose\s*=\s*0;/);
    expect(header).toMatch(/ui_get_framebuffer\(\)[\s\S]*ui_refresh_active_screen_bg_node[\s\S]*__ui_fb_needs_compose/);
    expect(header).toContain("display_fillScreen(navBg)");
    expect(header).toMatch(/static inline void ui_navigate[\s\S]*ui_get_framebuffer\(\)[\s\S]*display_fillScreen\(navBg\)/);
  });

  it("selects the framebuffer before scroll compositing so bands can stay off-screen", () => {
    const fbSelect = header.indexOf("CuttlefishCanvas16* __ui_fb = ui_get_framebuffer();");
    const scrollLoop = header.indexOf("Process each dirty scroll container");
    expect(fbSelect).toBeGreaterThan(-1);
    expect(scrollLoop).toBeGreaterThan(-1);
    expect(fbSelect).toBeLessThan(scrollLoop);
    expect(header).toMatch(/ui_push_canvas_rect[\s\S]*if \(__ui_fb\)[\s\S]*ui_display_draw_rgb_bitmap/);
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

  it("ui_tick text-binding dispatch compares by content without overwriting the old value", () => {
    // Generate into a bounded temporary, compare against the node buffer, and
    // copy only when changed so a callback cannot destroy the old value first.
    expect(header).toMatch(/char\s+nextBuf\[UI_TEXT_BUF\s*\+\s*1\]/);
    expect(header).toMatch(/textFn\(\s*nextBuf,\s*UI_TEXT_BUF\s*\+\s*1\s*\)/);
    expect(header).toMatch(/strcmp\(\s*nextBuf,\s*__ui_nodes\[.*?\]\.textBuffer\s*\)\s*!=\s*0/);
    expect(header).toMatch(/strncpy\(\s*__ui_nodes\[.*?\]\.textBuffer,\s*nextBuf,\s*UI_TEXT_BUF\s*\)/);
  });

  it("draw dispatch selects displayText by hasTextBinding (textBuffer vs text)", () => {
    // The dirty-node loop must declare a displayText local and read from it.
    expect(header).toMatch(/const char\*\s+displayText\s*=\s*__ui_nodes\[i\]\.hasTextBinding\s*\?\s*__ui_nodes\[i\]\.textBuffer\s*:\s*__ui_nodes\[i\]\.text/);
    // And the text draw must use displayText, not __ui_nodes[i].text.
    expect(header).toMatch(/ui_draw_wrapped_text\(\s*displayText/);
  });

  it("draws NODE_TEXT inside its CSS padding content box", () => {
    expect(header).toContain("ui_node_text_max_width");
    expect(header).toMatch(/case NODE_TEXT:[\s\S]*int16_t insetL = static_cast<int16_t>\(__ui_nodes\[i\]\.borderWidth\) \+ static_cast<int16_t>\(__ui_nodes\[i\]\.paddingLeft\)/);
    expect(header).toMatch(/case NODE_TEXT:[\s\S]*int16_t textX = __ui_nodes\[i\]\.box\.x \+ insetL/);
    expect(header).toMatch(/case NODE_TEXT:[\s\S]*ui_draw_node_border\(i, __ui_nodes\[i\]\.box\.x, drawY, bColor\)[\s\S]*case NODE_BUTTON:/);
    expect(header).toMatch(/case NODE_TEXT:[\s\S]*ui_draw_wrapped_text\(displayText, textX, textY, static_cast<uint16_t>\(textW\)/);
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

  it("clips loop-heavy render helpers to the active display target before inner work", () => {
    expect(header).toContain("ui_clip_rect_to_display_target");
    expect(header).toMatch(/ui_draw_wrapped_text[\s\S]*ui_display_target_bounds\(&targetLeft[\s\S]*lineBottom <= targetTop \|\| lineY >= targetBottom[\s\S]*ui_copy_text_span/);
    expect(header).toMatch(/ui_draw_asset_text[\s\S]*ui_display_target_bounds\(&targetLeft[\s\S]*glyphX \+ static_cast<int16_t>\(glyph->width\) <= targetLeft[\s\S]*for \(int16_t gy = gyStart; gy < gyEnd; gy\+\+\)/);
    expect(header).toMatch(/ui_draw_aa_text[\s\S]*ui_clip_rect_to_display_target\(&clipX,\s*&clipY,\s*&clipW,\s*&clipH\)[\s\S]*for \(int16_t yy = localY; yy < localY \+ clipH; yy\+\+\)/);
    expect(header).toMatch(/ui_draw_image_with_fit[\s\S]*ui_clip_rect_to_display_target\(&clipX,\s*&clipY,\s*&clipW,\s*&clipH\)[\s\S]*for \(int16_t ty = tyStart; ty < tyEnd; ty\+\+\)/);
    expect(header).toMatch(/ui_draw_gradient_fill[\s\S]*ui_clip_rect_to_display_target\(&clipX,\s*&clipY,\s*&clipW,\s*&clipH\)[\s\S]*for \(int16_t y = yStart; y < yEnd; y\+\+\)/);
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
    expect(header).toMatch(/uint16_t\s+parent/);
    expect(header).toMatch(/uint16_t\s+subtreeEnd/);
    expect(header).toContain("ui_draw_y_for_node");
    // The unified scroll-scan keys on scrollable nodes; lists are scrollable.
    expect(header).toMatch(/for \(uint16_t i = 0; i < __ui_node_count; i\+\+\)[\s\S]*!__ui_nodes\[i\]\.scrollable/);
    expect(header).toContain("ui_mark_scroll_subtree_dirty");
  });

  it("marks a scroll subtree with one container-level overlap check, not per-child", () => {
    // The scroll overlap-repair optimization: instead of calling ui_mark_dirty
    // (which runs an O(n) overlap scan) on every child, scroll marking sets the
    // dirty flags directly and runs a single overlap check at the container.
    expect(header).toContain("ui_mark_subtree_dirty_local");
    // The scroll-tree dirty loop must set dirty directly (not call ui_mark_dirty),
    // otherwise the per-child O(n) overlap repair is reintroduced.
    expect(header).toMatch(/ui_mark_subtree_dirty_local\(uint16_t scrollNode\)[\s\S]*?__ui_nodes\[c\]\.dirty = 1/);
    // ui_mark_scroll_subtree_dirty delegates to the local mark + ONE overlap check
    // (tolerant of the explanatory comments in the body).
    expect(header).toMatch(/ui_mark_scroll_subtree_dirty\(uint16_t scrollNode\) \{[\s\S]*ui_mark_subtree_dirty_local\(scrollNode\);[\s\S]*ui_mark_overlapping_higher_layers_dirty\(scrollNode\);[\s\S]*\}/);
    // And it must NOT loop calling ui_mark_dirty per child (the old O(K·n) form).
    expect(header).not.toMatch(/ui_mark_scroll_subtree_dirty\(uint8_t scrollNode\) \{[\s\S]*?for[\s\S]*?ui_mark_dirty\(c\)/);
  });

  it("keeps normal dirty marking local while repairing overlapping higher z-index layers", () => {
    expect(header).toMatch(/int16_t\s+zIndex/);
    expect(header).toContain("ui_node_draws_before");
    expect(header).toContain("ui_mark_overlapping_higher_layers_dirty");
    // Fully-contained dirty nodes stay local: dirty flag + overlap repair.
    // Clipped scroll descendants are promoted separately below so they render
    // through the scroll canvas instead of being skipped by direct-display cull.
    expect(header).toMatch(/static inline void ui_mark_dirty\(uint16_t nodeIdx\) \{\s*if \(nodeIdx >= __ui_node_count\) return;\s*__ui_nodes\[nodeIdx\]\.dirty = 1;/);
    expect(header).toMatch(/ui_mark_dirty\(uint16_t nodeIdx\)[\s\S]*ui_mark_overlapping_higher_layers_dirty\(nodeIdx\);\s*\}/);
    expect(header).not.toContain("ui_invalidate_scroll_cache_for_node");
    expect(header).not.toContain("for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1; // z-index repair");
  });

  it("promotes clipped dirty descendants to a generic scroll viewport repaint", () => {
    expect(header).toMatch(/static inline void ui_mark_dirty\(uint16_t nodeIdx\)[\s\S]*ui_node_current_paint_rect\(nodeIdx,\s*&r\)/);
    expect(header).toMatch(/while \(p != UI_NO_PARENT && p < __ui_node_count\)[\s\S]*__ui_nodes\[p\]\.scrollable[\s\S]*!__ui_nodes\[p\]\.virtualized[\s\S]*contentHeight > __ui_nodes\[p\]\.box\.h/);
    expect(header).toMatch(/if \(!ui_rects_intersect\(r\.x,\s*r\.y,\s*r\.w,\s*r\.h,\s*clip\.x,\s*clip\.y,\s*clip\.w,\s*clip\.h\)\)[\s\S]*__ui_nodes\[nodeIdx\]\.dirty = 0;[\s\S]*return;/);
    expect(header).toMatch(/r\.x < clip\.x[\s\S]*r\.y \+ r\.h > clip\.y \+ clip\.h[\s\S]*ui_mark_scroll_view_dirty\(p\);\s*return;/);
  });

  it("every subtree renderer draws outset shadows (scroll bands included)", () => {
    // The scroll band renderer skipped ui_draw_shadow, so band-composited
    // viewports lost theme shadows on device while the preview showed them.
    const between = (a: string, b: string): string => {
      const i = header.indexOf(a);
      const j = header.indexOf(b, i);
      return i >= 0 && j > i ? header.slice(i, j) : "";
    };
    expect(between("ui_render_scroll_bands(uint16_t s)", "static inline uint8_t ui_render_screen_bands")).toContain("ui_draw_shadow");
    expect(between("static inline uint8_t ui_render_screen_bands", "static inline uint8_t ui_render_node_bands")).toContain("ui_draw_shadow");
    expect(between("ui_render_node_bands(uint16_t i,", "static inline uint8_t ui_render_list_bands")).toContain("ui_draw_shadow");
  });

  it("emits the rasterized-glyph coverage cache for classic-font AA text", () => {
    // The AA pass neighbor-counts per pixel of the whole line canvas on every
    // repaint; per-(char, ts) coverage cells are cached instead (direct-mapped,
    // color-independent), with a per-cell fast path in ui_draw_aa_text.
    expect(header).toContain("ui_aa_glyph_coverage");
    expect(header).toContain("struct UIGlyphCovEntry");
    expect(header).toContain("Fast path (rasterized-glyph cache)");
    // AVR disables the cache (2KB SRAM budget); everything else defaults on.
    expect(header).toContain("#if defined(__AVR__)");
    expect(header).toContain("#define UI_AA_GLYPH_CACHE_SLOTS 0");
  });

  it("centered dialogs gate their whole subtree while closed (children have drawerSide -1)", () => {
    // Dialog children (scrim, card, buttons) carry no drawerSide and get no
    // offsets (travel 0) — only the ancestor walk hides them while closed.
    // Without it the dialog painted on screen entry and its close buttons
    // appeared dead (closing an already-closed slot changes nothing).
    expect(header).toContain("descendants via a side-4 ancestor");
    expect(header).toContain("__ui_nodes[a].drawerSide == 4");
  });

  it("drawer slide frames repaint the SUBTREE extent; centered dialogs snap", () => {
    // A <dialog> root with absolutely positioned children lays out at h=0 —
    // the old root-rect union was an empty band (a no-op "success"), so the
    // dialog never repainted on open or close on hardware. The preview
    // already used its subtree rect.
    expect(header).toMatch(/SUBTREE extent, not the root's paint rect/);
    expect(header).toMatch(/ui_subtree_current_paint_rect\(di, &oldRect\)/);
    expect(header).toContain("if (__ui_nodes[di].drawerSide == 4) next = target;");
  });

  it("centered dialogs compose tear-free and close taps hit-test the subtree rect", () => {
    // A modal toggle composes through the band renderer like every drawer
    // slide: mark-all's per-node direct clears flashed the whole screen on
    // no-fb SPI targets (significant flashing on open/close). The rect-union
    // inputs must be neutralized when a side has no on-screen extent — a
    // dialog snapping open from fully-closed has no old rect, and the
    // unwritten x/y mixed stack garbage into the band region. The
    // outside-tap close uses the SUBTREE rect — the dialog root lays out at
    // h=0, so the root box closed it on every tap.
    expect(header).toMatch(/if \(!ui_get_framebuffer\(\)\) \{/);
    expect(header).not.toMatch(/drawerSide != 4[\s\S]{0,120}ui_render_screen_bands/);
    expect(header).toMatch(/if \(!hasOld\) oldRect = newRect;/);
    expect(header).toContain("Hit-test the SUBTREE rect");
    expect(header).toMatch(/ui_subtree_current_paint_rect\(di, &panelRect\)/);
  });

  it("edge panels slide fully off the display (no peek after close)", () => {
    // Regression: travel == box.h left a bottom:0 panel's top rows parked
    // exactly at the display bottom — a sliver of title stayed visible after
    // close (toast auto-dismiss first, then the drawer). The seeded closed
    // state never showed the sliver before the first open, and a closed
    // panel can't be tapped open, so it read as an artifact, not an
    // affordance. ALL edge panels (drawers and toasts) now clear the
    // display edge; only centered dialogs (side 4) keep travel 0.
    expect(header).toMatch(/if \(d->drawerSide == 4\) travel = 0;[\s\S]{0,1300}ui_display_target_bounds/);
    expect(header).toMatch(/if \(need > travel\) travel = need;/);
    expect(header).not.toMatch(/d->toastDuration > 0\) \{[\s\S]{0,300}ui_display_target_bounds/);
  });

  it("ladder-drawing a container re-marks its descendants (merge clearing can't strand them)", () => {
    // Regression: a press inside an open drawer marked the whole subtree,
    // but the merge pass composed the small children (texts/buttons) and
    // CLEARED their flags, leaving the too-big panel for the per-node
    // ladder — its clear+fill erased the merge-composed children and
    // nothing re-drew them (drawer content vanished on Tap me). The draw
    // pass re-marks descendants of any ladder-drawn container; they sort
    // after it and restore their pixels in the same pass.
    expect(header).toMatch(
      /Ladder-drawing a CONTAINER[\s\S]{0,1000}for \(uint16_t c = static_cast<uint16_t>\(i\) \+ 1;[\s\S]{0,400}__ui_nodes\[c\]\.dirty = 1;/);
  });

  it("the screen-band compositor clips scrolled children to their scroll viewport", () => {
    // Regression: the compositor painted scroll-subtree candidates at their
    // absolute faces, unclipped — a whole-screen compose left stale button
    // rows below the fold, and composes over the header region smeared
    // scrolled content into the header: bars of previously-scrolled pixels
    // that nothing repaints. Candidates now carry absolute clip bounds from
    // their scroll ancestor's viewport, and the band loop clamps each face
    // to them (box geometry restored after the draw).
    expect(header).toMatch(/Scrolled children clip to their scroll viewport \(CSS overflow\)/);
    expect(header).toMatch(/Clamp the face to the scroll viewport/);
    expect(header).toContain("int16_t clipTop;");
    expect(header).toMatch(/__ui_nodes\[c\]\.box\.w = origBoxW;/);
    // The band-local conversion must stay int32: the ±32767 unclipped
    // sentinels wrap in int16 arithmetic once region/band offsets are
    // subtracted, and the wrapped-positive clip dropped whole candidates
    // (the main screen's header card vanished over the dark background).
    expect(header).toMatch(/int32 math: the unclipped sentinels are ±32767/);
    expect(header).toMatch(/int32_t clipTopL = static_cast<int32_t>\(__ui_scroll_candidates\[ci\]\.clipTop\) - ry - bandTop;/);
  });

  it("checked-state pair: check/radio/select draw paths swap to checkedBg/checkedFg with the value", () => {
    // The kit's :checked rules (switch track, checkbox face, radio dot →
    // --primary; the select list's selected row → --accent) bake a
    // checked-state color pair into the node; the runtime swaps the pair
    // onto the indicator when the value flips. Without the swap the ON
    // state stayed foreground-colored (no primary/accent theming).
    expect(header).toContain("uint32_t checkedBg;");
    expect(header).toContain("uint8_t hasCheckedBg;");
    expect(header).toMatch(
      /\(__ui_nodes\[i\]\.value && __ui_nodes\[i\]\.hasCheckedBg\) \? __ui_nodes\[i\]\.checkedBg : fillBg/);
    expect(header).toMatch(/hasCheckedFg \? __ui_nodes\[i\]\.checkedFg : __ui_nodes\[i\]\.fg/);
    expect(header).toMatch(/n->hasCheckedBg \? static_cast<UI_COLOR_T>\(n->checkedBg\) : n->fg/);
  });

  it("a partially-covered node under an open drawer defers to the drawer's compose (no content bar)", () => {
    // Regression: the under-node's own ladder painted its FULL rect —
    // including the part covered by the open panel — straight onto the
    // display, flashing underlying content as a horizontal bar until the
    // drawer's compose re-stamped over it. The classification now skips
    // its direct repaint and inflates the drawer's subtree compose region
    // to reach its uncovered sliver; the compose paints it under the panel
    // in stacking order.
    expect(header).toMatch(/flashing underlying content as a bar[\s\S]{0,700}__ui_drawer_inflate_used\[dslot\] = 1;/);
    expect(header).toMatch(/compose region reaches the nodes the overlap[\s\S]{0,500}__ui_drawer_inflate_used\[islot\]/);
    expect(header).toContain("static UIRect   __ui_drawer_inflate_rect[UI_DRAWER_MAX];");
  });

  it("a container's ladder turn composes its subtree region tear-free (no erase + re-pop)", () => {
    // The re-mark fallback alone repaints the container face first (erasing
    // its children) and then pops each child back one ladder at a time —
    // the eye reads that erase/re-pop as a flash when pressing a button
    // inside an open drawer. The container's ladder turn instead composes
    // its whole subtree REGION through the band renderer (one pass, correct
    // stacking, no intermediate state) and clears the dirty flags inside
    // the region. The merge pass also skips nodes a dirty ancestor owns,
    // so it can't compose-and-clear children the ancestor will repaint.
    expect(header).toMatch(
      /A container with descendants reaches its ladder turn[\s\S]{0,2400}ui_render_screen_bands\(subtreeRegion\.x, subtreeRegion\.y, subtreeRegion\.w, subtreeRegion\.h\)/);
    expect(header).toMatch(/A dirty ancestor's ladder turn owns this node's repaint/);
  });

  it("z-index raises the whole subtree (CSS stacking context), in draw order AND hit-test", () => {
    // Regression: a flat (zIndex, index) sort painted a dialog's scrim (z30)
    // and card (z31) over the card's own z0 children — the band compositor
    // erased the content it had just drawn (dialog showed only its topmost
    // child), and hit-testing saw the card as "topmost" so its buttons could
    // never receive taps. Effective z = the nearest ancestor-or-self with a
    // non-zero zIndex; descendants stack WITH their raised ancestor.
    expect(header).toMatch(/static inline int16_t ui_stacking_z\(uint16_t nodeIdx\)/);
    const cmp = header.match(/static inline uint8_t ui_node_draws_before\(uint16_t a, uint16_t b\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(cmp).toMatch(/ui_stacking_z\(a\)/);
    expect(cmp).toMatch(/ui_stacking_z\(b\)/);
    expect(cmp).not.toMatch(/__ui_nodes\[a\]\.zIndex != __ui_nodes\[b\]\.zIndex/);
  });

  it("marking an overlapping higher layer dirty also marks its descendants", () => {
    // Regression: a press under a dialog marked the scrim and card dirty
    // (overlapping higher layers) but not the card's children — the ladder
    // repainted the container faces alone and erased the just-composed
    // dialog content. Repainting a container must repaint what lives inside
    // it.
    expect(header).toMatch(
      /ui_rects_intersect[\s\S]{0,200}__ui_nodes\[c\]\.dirty = 1;[\s\S]{0,600}for \(uint16_t k = c \+ 1; k < __ui_nodes\[c\]\.subtreeEnd/);
  });

  it("a successful drawer band compose clears the dirty flags it satisfies", () => {
    // Regression: the open frame composed the dialog through the band
    // renderer, then the dirty pass repainted the scrim DIRECTLY (a
    // viewport-sized overlay is too big for the repair canvas) — one flat
    // full-screen fill erasing the composed frame, then the card/title/
    // buttons re-popped band by band. That erase + re-layer sequence was the
    // modal-toggle flash on hardware. The compose is authoritative for its
    // region: clear dirty flags of nodes fully inside it. Bindings run after
    // the drawer tick, so same-frame binding dirt still repaints.
    expect(header).toMatch(
      /ui_render_screen_bands\(ux0, uy0[\s\S]{0,1400}for \(uint16_t q = 0; q < __ui_node_count; q\+\+\) \{[\s\S]{0,600}__ui_nodes\[q\]\.dirty = 0;/);
  });

  it("hit-test targets the topmost node and bubbles to ancestors only", () => {
    // Regression: hit-test picked the topmost HANDLER-BEARING node, so a tap
    // on a modal card (no handler, higher z) fell through to the
    // click-to-close scrim underneath (handler) — any tap anywhere dismissed
    // the dialog. The DOM rule: the click targets the topmost element at the
    // point, then bubbles to ANCESTORS only — never sideways to a covered
    // sibling.
    const fn = header.match(/int16_t ui_hit_test\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toMatch(/Phase 2 — bubbling/);
    expect(fn).toMatch(/__ui_nodes\[u\]\.parent/);
    expect(fn).toMatch(/__ui_nodes\[u\]\.kind == NODE_RANGE/);
    expect(fn).toMatch(/NODE_BUTTON/);
  });

  it("partial drawer overlap inside a non-composited scroll subtree skips instead of re-dirtying", () => {
    // Re-dirtying the drawer sent its subtree through the defer fall-through
    // (direct band/canvas pushes over a scroll viewport) — on hardware the
    // drawer's text and buttons vanished while staying tappable. The sliver
    // of an uncovered label is not worth the unsafe redraw; when the scroll
    // owner is composited (dirty this frame) the full re-dirty stays safe.
    expect(header).toMatch(/Partial coverage, but the drawer sits inside an overflow scroll/);
  });

  it("keeps fully-contained dirty descendants local (buffered direct repaint, no viewport promotion)", () => {
    // Fully-inside children keep their own dirty flag — the dirty loop's
    // scroll defer lets them repaint through the paint canvas/bands. The old
    // promotion recomposed the whole viewport per dirty tick, which keyframe
    // animations turned into constant full-screen pushes (unusable tearing).
    expect(header).toMatch(/Fully inside the viewport: leave the CHILD dirty/);
    // Only partially/fully clipped children defer to the composited canvas.
    expect(header).toMatch(/Not composited this frame\.[\s\S]*ui_is_rect_clipped_by_scroll/);
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
    expect(header).toMatch(/for \(uint16_t c = nodeIdx; c < end; c\+\+\)[\s\S]*__ui_nodes\[c\]\.dirty = 1/);
  });

  it("draws dirty nodes in z-index order", () => {
    expect(header).toContain("ui_build_draw_order");
    expect(header).toContain("__ui_draw_order");
    expect(header).toMatch(/ui_build_draw_order\(\)/);
    expect(header).toMatch(/i = static_cast<int16_t>\(__ui_draw_order\[__ui_draw_pass\+\+\]\)/);
    expect(header).toMatch(/ui_node_draws_before\(candidate,\s*static_cast<uint16_t>\(i\)\)/);
  });

  it("buffers pixel-heavy images and generated-font text through the RAM paint canvas", () => {
    expect(header).toContain("ui_pixel_heavy_node");
    expect(header).toMatch(/ui_pixel_heavy_node\(nodeIdx\)\) return 1/);
    expect(header).toMatch(/NODE_IMG\) return 1/);
    // All NODE_TEXT is pixel-heavy: even the classic bitmap font renders via
    // drawPixel per font pixel, which is a full SPI transaction per pixel on an
    // SPI TFT. Forcing every text node through the paint canvas turns that into
    // one RAM render + one push.
    expect(header).toMatch(/NODE_TEXT\) return 1/);
    expect(header).toMatch(/!drawingBufferedScroll && !__ui_fb && ui_should_buffer_paint/);
    expect(header).not.toMatch(/bufferedScrollNode < 0 && ui_should_buffer_paint/);
  });

  it("caches text layout metrics per node and invalidates on text or geometry changes", () => {
    expect(header).toContain("ui_node_text_layout_metrics");
    expect(header).toContain("ui_invalidate_text_layout_cache");
    expect(header).toContain("layoutCacheKey");
    expect(header).toMatch(/ui_invalidate_text_layout_cache\(n\)/);
    expect(header).toMatch(/ui_node_text_layout_metrics\(nodeIdx, textMaxW/);
  });

  it("consolidates per-tick node scans via scroll-owner table and cached screen bg", () => {
    expect(header).toContain("ui_build_scroll_owner_table");
    expect(header).toContain("__ui_scroll_owners");
    expect(header).toContain("__ui_active_screen_bg_node");
    expect(header).toContain("ui_refresh_active_screen_bg_node");
    expect(header).toMatch(/ui_scroll_motion_active\(settlingOnActiveScreen\)/);
    expect(header).toMatch(/__ui_active_screen_bg_node < __ui_node_count/);
    expect(header).not.toMatch(/for \(uint16_t s = 0; s < __ui_node_count; s\+\+\)[\s\S]*screenId == __ui_active_screen && __ui_nodes\[s\]\.kind == NODE_FILL/);
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
    expect(header).toContain("#ifndef UI_SCROLL_DRAG_SCALE_X10");
    expect(header).toContain("#ifndef UI_SCROLL_SETTLE_MS");
    expect(header).toContain("UI_SCROLL_INPUT_TIER_");
    expect(header).toContain("UI_SCROLL_RENDER_TIER_");
    expect(header).toContain("UI_SCROLL_HAS_TOUCH");
    expect(header).toContain("UI_SCROLL_ELASTIC");
  });

  it("hides the on-screen keyboard draw block when UI_HIDE_OSK is defined (desktop targets)", () => {
    // The OSK editing session (buffer, target, commit-on-close) must keep
    // running so typing works — only the *draw* of the 6×4 grid is suppressed,
    // because a desktop window has a real keyboard. Gated on UI_HIDE_OSK so
    // hardware targets (which don't define it) render the grid unchanged.
    expect(header).toMatch(/#if\s+!defined\(UI_HIDE_OSK\)[\s\S]*ui_kb_draw\(\)/);
  });

  it("ui_kb_insert/delete sync the buffer to the edited input's textBuffer + mark it dirty (live update when OSK hidden)", () => {
    // On hardware the OSK draws its own text row showing __ui_kb_buffer, so the
    // input field only updates at close. With UI_HIDE_OSK there's no text row —
    // the input field itself must repaint on each keystroke, or typing appears
    // to do nothing until Enter. So ui_kb_insert/delete must propagate the
    // buffer into the target node's textBuffer and mark that node dirty when
    // the OSK is hidden. Match the definition body (the prototype ends with ';').
    const insertMatch = header.match(/static inline void ui_kb_insert\(char c\) \{[\s\S]*?\n\}/);
    expect(insertMatch).not.toBeNull();
    expect(insertMatch![0]).toContain("UI_HIDE_OSK");
    expect(insertMatch![0]).toContain("textBuffer");
    expect(insertMatch![0]).toMatch(/dirty|mark_dirty/);
    const deleteMatch = header.match(/static inline void ui_kb_delete\(\) \{[\s\S]*?\n\}/);
    expect(deleteMatch).not.toBeNull();
    expect(deleteMatch![0]).toContain("UI_HIDE_OSK");
    expect(deleteMatch![0]).toContain("textBuffer");
  });

  it("draws a blinking caret on the edited input field when UI_HIDE_OSK is defined", () => {
    // Without the OSK grid there's no visual focus indicator. A caret at the
    // end of the typed text tells the user which input is active. Blink so a
    // static caret doesn't look like a stuck cursor.
    expect(header).toMatch(/#if\s+defined\(UI_HIDE_OSK\)[\s\S]*__ui_kb_target[\s\S]*caret/);
  });

  it("hides the placeholder on the input being edited when UI_HIDE_OSK is defined", () => {
    // On focus the editing buffer is loaded from the input's (empty) textBuffer,
    // so textBuffer stays empty until the first keystroke. The draw path falls
    // back to the placeholder (.text) when textBuffer is empty — which would
    // render "enter name" with the caret at its end on focus. When the OSK is
    // hidden AND this node is the active edit target, suppress the placeholder
    // so the caret shows on a clean field at position 0.
    const inputDrawIdx = header.indexOf("case NODE_INPUT:");
    const inputDrawBlock = header.slice(inputDrawIdx, inputDrawIdx + 2600);
    expect(inputDrawBlock).toMatch(/#if\s+defined\(UI_HIDE_OSK\)[\s\S]*__ui_kb_target[\s\S]*(empty|\"\"|disp)/);
  });

  it("marks the target input dirty on ui_kb_open when UI_HIDE_OSK is defined (caret appears on focus)", () => {
    // On hardware the OSK covers the app, so ui_kb_open deliberately does NOT
    // mark the tree dirty (a dirty flag would survive and flash on close). With
    // the OSK hidden the draw pass runs normally and the input field must
    // repaint on focus so the caret shows BEFORE the first keystroke — otherwise
    // the caret only appears once the user starts typing. Match the definition
    // body (the prototype ends with ';', the definition opens with '{').
    const openMatch = header.match(/static inline void ui_kb_open\([^)]*\) \{[\s\S]*?\n\}/);
    expect(openMatch).not.toBeNull();
    expect(openMatch![0]).toContain("UI_HIDE_OSK");
    expect(openMatch![0]).toMatch(/ui_mark_dirty|\.dirty\s*=\s*1/);
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

  it("stores node-index owners in int16_t, not int8_t (index >= 128 regression)", () => {
    // Node tables can hold 144+ nodes (the demo has 144), so any holder of a
    // node index must be wide enough for 0..254. int8_t wraps negative at 128
    // and silently breaks taps/presses/range-drag/scroll for high-index nodes.
    expect(header).toMatch(/int16_t ui_hit_test\(/);
    expect(header).toMatch(/int16_t __ui_touch_node\s*=\s*-1/);
    expect(header).toMatch(/int16_t __ui_range_node\s*=\s*-1/);
    expect(header).toMatch(/volatile\s+int16_t\s+__ui_tap_node\s*=\s*-1/);
    expect(header).toMatch(/int16_t __ui_scroll_node\s*=\s*-1/);
    expect(header).toMatch(/void ui_dispatch\([\s\S]*int16_t node\)/);
    // No int8_t node-index owner remains.
    expect(header).not.toMatch(/int8_t __ui_(touch|range|tap|scroll)_node/);
  });

  it("stores radio group member node indexes as uint16_t", () => {
    // Showcase radios live past node 255. A uint8_t group member truncates 275
    // to 19, so radio auto-click clears the wrong nodes and both options stay
    // selected.
    expect(header).toMatch(/struct\s+UIRadioGroup\s*\{\s*uint16_t\s+nodeIndices\[8\];\s*uint8_t\s+count;/);
    expect(header).not.toMatch(/struct\s+UIRadioGroup\s*\{\s*uint8_t\s+nodeIndices/);
  });

  it("widens node-index storage past 255 (uint16_t count/parent/subtreeEnd, 0xFFFF sentinel)", () => {
    // Node tables can grow beyond 255 (the demo has 144); the count, parent, and
    // subtreeEnd fields plus their loop counters must be uint16_t, and the
    // no-parent sentinel must be out of uint16_t range (not 255, which collides
    // with a valid node index once >255 nodes exist).
    expect(header).toMatch(/extern const uint16_t __ui_node_count/);
    expect(header).toMatch(/uint16_t parent;/);
    expect(header).toMatch(/uint16_t subtreeEnd;/);
    expect(header).toMatch(/#define UI_NO_PARENT 0xFFFF/);
    // Node-count-bounded loops must use uint16_t counters (a uint8_t counter
    // would wrap at 255 and never reach higher indices).
    expect(header).toMatch(/for \(uint16_t i = 0; i < __ui_node_count; i\+\+\)/);
    expect(header).not.toMatch(/for \(uint8_t i = 0; i < __ui_node_count/);
  });

  it("does not truncate high node indexes in draw-order or decoration helpers", () => {
    expect(header).toMatch(/ui_node_draws_before\(uint16_t a,\s*uint16_t b\)/);
    expect(header).not.toMatch(/ui_node_draws_before\(uint8_t a,\s*uint8_t b\)/);
    expect(header).toMatch(/ui_is_ancestor_of\(uint16_t candidate,\s*uint16_t nodeIdx\)/);
    expect(header).toMatch(/ui_draw_gradient_fill\(uint16_t i,\s*int16_t drawY\)/);
    expect(header).toMatch(/ui_draw_shadow\(uint16_t i,\s*int16_t drawY,\s*uint8_t insetOnly\)/);
    expect(header).toMatch(/ui_draw_node_border\(uint16_t i,\s*int16_t drawX,\s*int16_t drawY,\s*UI_COLOR_T color\)/);
    expect(header).toMatch(/ui_draw_node_outline\(uint16_t i,\s*int16_t drawX,\s*int16_t drawY\)/);
  });

  it("widens every *_count past 255 (uint16_t counts + loops; demo has 128 click handlers)", () => {
    // The binding/handler counts scale with UI complexity (the demo already has
    // __ui_click_handler_count = 128, ~half the uint8_t ceiling). All counts and
    // their bounded loops must be uint16_t, or a UI with >255 of any kind silently
    // drops the overflow.
    for (const c of [
      "__ui_trans_count", "__ui_binding_count", "__ui_screen_count", "__ui_image_count",
      "__ui_keyframe_set_count", "__ui_anim_count", "__ui_list_binding_count",
      "__ui_canvas_binding_count", "__ui_input_binding_count", "__ui_font_face_count",
      "__ui_pin_watch_count", "__ui_radio_group_count", "__ui_click_handler_count",
      "__ui_rangechange_handler_count", "__ui_kb_loader_count",
    ]) {
      expect(header).toMatch(new RegExp(`extern\\s+const\\s+uint16_t\\s+${c}`));
    }
    // No count remains uint8_t; no count-bounded loop uses a uint8_t counter.
    expect(header).not.toMatch(/extern const uint8_t __ui_[a-z_]*_count/);
    expect(header).not.toMatch(/for \(uint8_t [a-z]+ = 0; [a-z]+ < __ui_[a-z_]*_count/);
    // ui_dispatch's count param must be wide enough for >255 handlers.
    expect(header).toMatch(/void ui_dispatch\([\s\S]*uint16_t count, int16_t node\)/);
  });

  it("releases via ui_scroll_release and advances the settle in ui_tick", () => {
    expect(header).toContain("ui_scroll_release");
    expect(header).toContain("ui_scroll_advance_settle");
    expect(header).toContain("ui_scroll_overscroll_for");
    expect(header).toMatch(/ui_scroll_release\(__ui_scroll_node\)/);
    expect(header).toMatch(/ui_scroll_advance_settle\(i,\s*deltaMs\)/);
  });

  it("keeps range gestures out of the scroll drag path and avoids generic touch redraws", () => {
    const touchDown = header.match(/static void ui_touch_down[\s\S]*?static void ui_touch_up/)?.[0] ?? "";
    expect(touchDown).toMatch(/if \(__ui_nodes\[node\]\.kind == NODE_RANGE\) \{[\s\S]*__ui_range_node = node;[\s\S]*__ui_scroll_node = -1;/);
    expect(header).toMatch(/if \(__ui_range_node < 0 && !__ui_is_dragging && __ui_scroll_node >= 0\)/);
    expect(header).toMatch(/if \(__ui_range_node < 0 && __ui_is_dragging && __ui_scroll_node >= 0\)/);
    expect(touchDown).toMatch(/kind == NODE_BUTTON\)\s*\{[\s\S]*ui_set_pressed\(static_cast<uint16_t>\(node\), 1\)/);
    // Non-mutating touch-downs must not trigger a redundant clear/redraw.
    expect(touchDown).not.toContain("handledTouchTarget");
    const touchDownVisualComment = touchDown.match(/Only controls with a visual state change[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(touchDownVisualComment).not.toContain("ui_mark_dirty(node);");

    const touchUp = header.match(/static void ui_touch_up[\s\S]*?static inline void ui_handle_touch/)?.[0] ?? "";
    expect(touchUp).toMatch(/kind == NODE_CHECK[\s\S]*kind == NODE_RADIO[\s\S]*kind == NODE_SELECT[\s\S]*ui_mark_dirty/);
    expect(touchUp).toMatch(/Buttons are already dirty from releasing/);
    expect(touchUp).not.toMatch(/ui_dispatch\(__ui_release_handlers[\s\S]*ui_mark_dirty\(clickedNode\);/);
  });

  it("publishes only changed retained-framebuffer bounds after local repaints", () => {
    expect(header).toContain("__ui_fb_dirty_x0");
    expect(header).toContain("ui_fb_begin_frame();");
    expect(header).toContain("ui_fb_add_rect(paintRect.x, paintRect.y, paintRect.w, paintRect.h)");
    const framebufferPush = header.match(/static inline void ui_push_framebuffer[\s\S]*?\n}\n\nstatic inline uint8_t ui_rotation_quadrant/)?.[0] ?? "";
    expect(framebufferPush).toContain("display_startWrite();");
    expect(framebufferPush).toContain("display_writePixels");
    expect(framebufferPush).not.toContain("ui_display_draw_rgb_bitmap");
    expect(header).toContain("wider stride than the panel window");
    expect(header).toMatch(/if \(__ui_fb\) \{[\s\S]*ui_fb_add_rect\(x, y, w, h\)/);
  });

  it("repairs local scroll-child updates without repainting the whole viewport", () => {
    // Form bindings and animated children live inside scrollBody. A zero-delta
    // invalidation should retain the viewport canvas and draw only dirty children;
    // full viewport repainting was the source of whole-screen flashes.
    expect(header).toMatch(/uint8_t localRepair = __ui_fb && deltaY == 0/);
    expect(header).toMatch(/localRepair[\s\S]*ui_scroll_subtree_has_dirty\(s\)/);
    expect(header).toMatch(/if \(localRepair\) \{[\s\S]*bufferedScrollLocalRepair = 1;[\s\S]*bufferedScrollCanvas = nullptr/);
    expect(header).toMatch(/else \{[\s\S]*display_canvasFillScreen\(bufferedScrollCanvas, scrollBg\)/);
    expect(header).toMatch(/else if \(__ui_fb\) \{[\s\S]*ui_fb_add_rect\(__ui_nodes\[s\]\.box\.x/);
    expect(header).toMatch(/__ui_nodes\[i\]\.lastPaintedScrollY[\s\S]*__ui_nodes\[i\]\.box\.h/);
    expect(header).toMatch(/bufferedScrollCanvas \|\| bufferedScrollDirectFull \|\| bufferedScrollBands \|\| bufferedScrollLocalRepair/);
  });

  it("routes animation geometry repair into the retained framebuffer", () => {
    // Transform animation cleanup must never clear the live panel between frames.
    expect(header).toMatch(/\(void\)ui_get_framebuffer\(\);[\s\S]*① Advance transitions/);
    expect(header).toMatch(/ui_repair_current_node_paint_with_parent[\s\S]*if \(__ui_fb\) ui_display_set_target\(\(CuttlefishDisplayTarget\*\)__ui_fb\)/);
    expect(header).toMatch(/ui_try_repair_geometry_fill[\s\S]*Keep geometry repair off the physical panel/);
    expect(header).toMatch(/if \(__ui_fb && \(__ui_fb_frame_dirty \|\| __ui_fb_dirty\)\)/);
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

  it("keeps the buffered scroll owner out of the direct display draw pass", () => {
    // Mode B: the scroll owner is represented by the viewport canvas.
    // Direct-full: the scroll owner must not draw directly (would fill the
    // viewport); its children are drawn below.
    // Non-composited overflow scroll containers defer entirely until Mode B.
    expect(header).toMatch(/if \(bufferedScrollCanvas\) \{[\s\S]*__ui_nodes\[s\]\.dirty = 0;[\s\S]*\} else \{/);
    expect(header).toMatch(/\(bufferedScrollDirectFull \|\| bufferedScrollLocalRepair\) && bufferedScrollNode >= 0 &&[\s\S]*continue;/);
    expect(header).toContain("ui_overflow_scroll_compositor");
    // drawingBufferedScroll is only true in genuine Mode B (a real canvas is
    // active). Direct-full has no canvas, so its children draw to the display
    // target and qualify for the per-node paint canvas.
    expect(header).toMatch(/uint8_t drawingBufferedScroll = !bufferedScrollDirectFull &&[\s\S]*\(bufferedScrollCanvas != nullptr\)[\s\S]*i > bufferedScrollNode/);
  });

  it("falls back to the band renderer when viewport canvas won't allocate", () => {
    // When Mode B canvas allocation fails (no PSRAM), the no-canvas dispatch
    // defers to the band renderer (bufferedScrollBands): it composites the
    // whole visible subtree into a ~10KB band canvas strip-by-strip and pushes
    // one band at a time at the owner's z-order slot. Direct-full remains only
    // as the band-canvas-failure fallback (rare).
    expect(header).toContain("ui_draw_scrollbar_direct");
    expect(header).toContain("ui_overflow_scroll_compositor");
    expect(header).toContain("Retain the existing viewport pixels");
    expect(header).toMatch(/bufferedScrollCanvas = ui_get_container_canvas\(vw, vh\)/);
    // The no-canvas branch: mark the canvas-unavailable flag + defer to bands.
    expect(header).toMatch(/if \(__ui_scroll_canvas_ok\) __ui_scroll_canvas_ok\[s\] = 0;[\s\S]*bufferedScrollBands = 1/);
    expect(header).toMatch(/} else if \(bufferedScrollNode >= 0 && bufferedScrollDirectFull\) \{[\s\S]*__ui_scroll_render_locked/);
  });

  it("defers non-composited overflow scroll subtrees from the direct display pass", () => {
    expect(header).toMatch(/ui_overflow_scroll_compositor[\s\S]*if \(!compositing\)[\s\S]*break;/);
  });

  it("constrained render tier does not full-viewport clear on scroll drag", () => {
    expect(header).toContain("UI_SCROLL_RENDER_TIER_CONSTRAINED");
    const directPrepare = header.match(/static inline void ui_scroll_direct_prepare[\s\S]*?^}/m);
    expect(directPrepare).not.toBeNull();
    const body = directPrepare![0];
    expect(body).toMatch(/ui_display_fill_rect\(vox,[\s\S]*absDelta, scrollBg\)/);
    expect(body).not.toMatch(/ui_mark_subtree_dirty_local/);
    expect(body).not.toMatch(/ui_display_fill_rect\(vox, voy, vw, vh/);
    // Mode C must only mark descendants that intersect the exposed strip dirty
    // (AGENTS.md: keep scroll drag invalidation small). A drag that exposes a
    // small band must not repaint the whole visible subtree — gate the dirty
    // flag on ui_rects_intersect against the exposed rect, like Mode B does.
    expect(body).toMatch(/UIRect exposed = \{ vox,[\s\S]*stripY[\s\S]*absDelta \}/);
    expect(body).toMatch(/ui_node_current_paint_rect\(c, &cr\)[\s\S]*ui_rects_intersect\(/);
  });

  it("pushes buffered scroll canvases before later outside layers can be repaired", () => {
    expect(header).toContain("ui_push_buffered_scroll_canvas");
    expect(header).toContain("ui_scroll_subtree_has_dirty");
    expect(header).toMatch(/!ui_scroll_subtree_has_dirty\(static_cast<uint16_t>\(bufferedScrollNode\)\)\) \{[\s\S]*ui_push_buffered_scroll_canvas/);
    expect(header).toMatch(/if \(bufferedScrollNode >= 0 && bufferedScrollCanvas\) \{[\s\S]*ui_push_buffered_scroll_canvas/);
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

  it("scrolls virtualized lists by shifting cached pixels and repainting only the exposed strip", () => {
    expect(header).toContain("__ui_list_canvas_node");
    expect(header).not.toContain("ui_push_canvas_rect_rows");
    // Repair canvas reallocates on exact-size mismatch (not just when growing).
    // A reused larger canvas keeps its old stride, corrupting the push.
    expect(header).toMatch(/ui_get_repair_canvas[\s\S]*display_canvasWidth\(__ui_repair_canvas\) != w[\s\S]*display_canvasHeight\(__ui_repair_canvas\) != h/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*deltaY\s*=\s*listScrollY\s*-\s*__ui_nodes\[i\]\.lastPaintedScrollY/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*canShiftList[\s\S]*ui_shift_container_canvas\(lc,\s*deltaY,\s*clearCol,\s*&repaintY,\s*&repaintH\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_get_repair_canvas\(bw,\s*repaintH\)[\s\S]*listTextOffsetY\s*=\s*repaintY/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_draw_list_text\(listBuf,[\s\S]*clearCol,\s*2,\s*__ui_nodes\[i\]\.fontFace/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*__ui_draw_off_x\s*=\s*0;[\s\S]*__ui_draw_off_y\s*=\s*0;[\s\S]*ui_draw_list_text\(listBuf/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_draw_canvas_rect\(listTextCanvas,\s*0,\s*repaintY,\s*bw,\s*repaintH\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_render_list_bands\(static_cast<uint16_t>\(i\)\)[\s\S]*ui_render_list_direct\(static_cast<uint16_t>\(i\)\)/);
    expect(header).toMatch(/ui_render_list_direct\(uint16_t i\)[\s\S]*ui_display_fill_rect\(bx, by, bw, bh, bg\)[\s\S]*ui_draw_list_text_direct/);
    expect(header).toMatch(/ui_draw_list_text[\s\S]*CUTTLEFISH_GFX_DEFINED[\s\S]*cuttlefish_glcdfont[\s\S]*ui_display_fill_rect/);
    expect(header).toMatch(/ui_draw_list_text_direct[\s\S]*ui_draw_bitmap_text/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_render_list_direct\(static_cast<uint16_t>\(i\)\)[\s\S]*__ui_nodes\[i\]\.box\.x\s*=\s*origBoxX[\s\S]*__ui_nodes\[i\]\.box\.y\s*=\s*origBoxY/);
    expect(header).toMatch(/ui_render_list_direct[\s\S]*if \(!__ui_fb\) display_startWrite\(\)[\s\S]*if \(!__ui_fb\) display_endWrite\(\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_draw_list_text\(listBuf/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*uint16_t first\s*=\s*\(listScrollY \+ repaintY\) \/ ih/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*__ui_nodes\[i\]\.lastPaintedScrollY\s*=\s*listScrollY/);
    expect(header).toMatch(/newCount != __ui_nodes\[i\]\.listCount[\s\S]*lastPaintedScrollY\s*=\s*__ui_nodes\[i\]\.scrollY\s*-/);
  });

  it("does not repaint static list shadows on small scroll frames", () => {
    expect(header).toMatch(/skipListOutsetShadow\s*=[\s\S]*__ui_nodes\[i\]\.kind == NODE_LIST[\s\S]*!drawingBufferedScroll[\s\S]*!__ui_fb/);
    expect(header).toMatch(/if \(!skipListOutsetShadow\) \{[\s\S]*ui_draw_shadow\(i,\s*baseDrawY,\s*0\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*if \(!drawingBufferedScroll && !__ui_fb && !canShiftList\) \{[\s\S]*ui_draw_shadow\(i,\s*by,\s*0\)/);
    expect(header).toMatch(/case\s+NODE_LIST:[\s\S]*ui_push_canvas_rect\(lc,\s*bx,\s*by,\s*bw,\s*bh\)[\s\S]*ui_draw_shadow\(i,\s*by,\s*1\)[\s\S]*ui_draw_node_border\(i,\s*bx,\s*by,\s*bColor\)[\s\S]*ui_draw_node_outline\(i,\s*bx,\s*by\)/);
    expect(header).not.toMatch(/case\s+NODE_LIST:[\s\S]*ui_draw_node_border\(i,\s*0,\s*0,\s*bColor\)/);
  });

  it("exposes ui_scroll_node_at(x,y): finds the scrollable container whose box contains a point (for wheel scroll)", () => {
    // The wheel handler needs the scroll owner for the cursor position. The
    // fragile approach (hit-test the topmost node, then walk parents for a
    // scrollable ancestor) misses when the cursor is over a non-child node
    // (text, a sibling, padding) — giving "works on some screens, needs two
    // attempts" behavior. The robust approach mirrors the touch path: scan
    // scrollable nodes directly for one whose box contains the point.
    expect(header).toMatch(/int16_t ui_scroll_node_at\(\s*int16_t\s+\w+\s*,\s*int16_t\s+\w+\s*\)/);
    // The body must check scrollable + visible + active-screen + overflow.
    const fnIdx = header.indexOf("ui_scroll_node_at(");
    const fnBlock = header.slice(fnIdx, header.indexOf("\n}", fnIdx) + 1);
    expect(fnBlock).toMatch(/scrollable/);
    expect(fnBlock).toMatch(/contentHeight\s*<=\s*__ui_nodes/);
    expect(fnBlock).toMatch(/screenId\s*!=\s*__ui_active_screen/);
  });

  it("invalidates buffered scroll viewports for animated geometry inside overflowing scroll containers", () => {
    expect(header).toContain("ui_scroll_ancestor_for_node");
    expect(header).toContain("ui_mark_scroll_view_dirty");
    expect(header).toContain("ui_repair_current_node_paint_with_parent");
    expect(header).toContain("ui_fill_rect_clipped");
    expect(header).toContain("ui_draw_node_decoration_clipped");
    expect(header).toMatch(/static inline uint8_t ui_repair_current_node_paint_with_parent\(uint16_t nodeIdx,\s*UIRect\* r\);/);
    expect(header).toMatch(/ui_clear_node_paint_rect[\s\S]*scrollParent\s*=\s*ui_scroll_ancestor_for_node\(nodeIdx\)/);
    expect(header).toMatch(/if\s*\(scrollParent\s*>=\s*0\)[\s\S]*ui_repair_current_node_paint_with_parent\(nodeIdx,\s*&clipped\)/);
    expect(header).toMatch(/if\s*\(scrollParent\s*>=\s*0\)[\s\S]*ui_draw_node_decoration_clipped/);
    expect(header).toMatch(/ui_try_repair_geometry_fill[\s\S]*if\s*\(scrollParent >= 0\) ui_invalidate_scroll_canvas_for_node\(nodeIdx\)/);
    expect(header).toMatch(/if\s*\(bufferedScrollRepaintCanvas\)\s*\{[\s\S]*scrollDrawW\s*=\s*__ui_nodes\[bufferedScrollNode\]\.box\.w;[\s\S]*scrollDrawH\s*=\s*bufferedScrollRepaintH/);
    expect(header).toMatch(/if\s*\(geometryChanged && !repairedGeometry\)[\s\S]*ui_invalidate_scroll_canvas_for_node\(n\)/);
    expect(header).toMatch(/__ui_nodes\[n\]\.box\.h = nextHeight;[\s\S]*ui_invalidate_text_layout_cache\(n\);[\s\S]*if\s*\(!repairedGeometry\)\s*ui_mark_dirty\(n\);/);
    expect(header).not.toMatch(/if\s*\(geometryScrollParent\s*>=\s*0\)\s*\{[\s\S]*ui_mark_scroll_view_dirty\(static_cast<uint16_t>\(geometryScrollParent\)\)/);
    expect(header).not.toMatch(/if\s*\(geometryChanged\)[\s\S]*ui_mark_scroll_subtree_dirty\(static_cast<uint8_t>\(scrollParent\)\)[\s\S]*__ui_nodes\[n\]\.transformOffsetX = nextTransformX/);
  });

  it("pauses geometry keyframe animations while scroll motion is active", () => {
    expect(header).toContain("ui_scroll_motion_active");
    expect(header).toContain("ui_keyframe_set_has_scroll_sensitive_geometry");
    expect(header).toMatch(/__ui_scroll_node >= 0 && __ui_is_dragging/);
    expect(header).toMatch(/settlingOnActiveScreen = 1/);
    expect(header).toMatch(/ks->stops\[s\]\.props & \(UI_KF_TRANSFORM \| UI_KF_SIZE\)/);
    expect(header).toMatch(/uint8_t scrollMotionActive = ui_scroll_motion_active\(settlingOnActiveScreen\);[\s\S]*if \(scrollMotionActive &&[\s\S]*ui_keyframe_set_has_scroll_sensitive_geometry\(__ui_anims\[i\]\.keyframeSet\)[\s\S]*continue;[\s\S]*__ui_anims\[i\]\.elapsed \+=/);
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

  it("buffers progress and range paints as full local-canvas updates", () => {
    expect(header).not.toMatch(/kind == NODE_PROGRESS \|\| __ui_nodes\[nodeIdx\]\.kind == NODE_RANGE\)\s*return 0/);
    expect(header).toMatch(/if \(__ui_nodes\[i\]\.kind == NODE_PROGRESS \|\| __ui_nodes\[i\]\.kind == NODE_RANGE\) \{[\s\S]*__ui_nodes\[i\]\.lastTextWidth = -1;/);
  });

  it("invalidates stale scroll backing canvases after direct child repaints", () => {
    expect(header).toContain("ui_invalidate_scroll_canvas_for_node");
    expect(header).toMatch(/ui_invalidate_scroll_canvas_for_node\(uint16_t nodeIdx\)[\s\S]*scrollParent\s*=\s*ui_scroll_ancestor_for_node\(nodeIdx\)[\s\S]*contentHeight\s*<=\s*__ui_nodes\[scrollParent\]\.box\.h[\s\S]*lastPaintedScrollY\s*=\s*__ui_nodes\[scrollParent\]\.scrollY\s*-\s*span/);
    expect(header).toMatch(/if\s*\(!drawingBufferedScroll\)\s*\{[\s\S]*ui_invalidate_scroll_canvas_for_node\(i\);[\s\S]*\}/);
  });

  it("seeds buffered child repaints with rounded parent decoration", () => {
    expect(header).toContain("ui_seed_paint_canvas_for_node");
    expect(header).toMatch(/ui_seed_paint_canvas_for_node[\s\S]*fillRoundRect/);
    expect(header).toMatch(/ui_seed_paint_canvas_for_node\(i,\s*paintCanvas,\s*paintCanvasX,\s*paintCanvasY,\s*0\)/);
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

  it("ui_kb_close scopes the post-keyboard dirty to the keyboard box, not the whole tree", () => {
    // Flashing root cause: ui_kb_close() must NOT mark every node dirty. The
    // keyboard draws an opaque background over __ui_kb_box on the live display,
    // so only nodes whose paint rect intersects that box need repainting. A
    // blanket full-tree dirty causes a full-screen flash on SPI TFTs.
    // Match the DEFINITION (header line ends with `{`), not the forward
    // declaration (which ends with `;`). Capture to the closing brace at
    // column 0.
    const closeBody = header.match(/static inline void ui_kb_close\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(closeBody).not.toBe("");  // sanity: function body captured
    // The whole-tree dirty loop must be gone from ui_kb_close. (Looser match:
    // any loop over __ui_node_count that sets .dirty = 1 inside close.)
    expect(closeBody).not.toMatch(/for\s*\(\s*uint16_t\s+i\s*=\s*0\s*;\s*i\s*<\s*__ui_node_count[\s\S]*?\.dirty\s*=\s*1/);
    // Instead, close must dirty only nodes whose paint rect intersects the
    // keyboard box, via the standard ui_mark_dirty primitive (which also
    // handles overlap repair + scroll clipping). The keyboard box is read
    // from __ui_kb_box (captured into a local before visibility is cleared).
    expect(closeBody).toMatch(/ui_node_current_paint_rect/);
    expect(closeBody).toMatch(/__ui_kb_box/);
    expect(closeBody).toMatch(/ui_rects_intersect/);
    expect(closeBody).toMatch(/ui_mark_dirty/);
  });

  it("ui_kb_open does not pre-mark the whole tree dirty", () => {
    // The draw pass is skipped while the keyboard is visible (its opaque
    // background covers app nodes), so any dirty flags set on open are never
    // consumed/cleared during the keyboard-up period. If open marks the whole
    // tree dirty, those flags survive until close, and the first post-close
    // frame repaints the ENTIRE screen -> full-screen flash on SPI TFTs.
    // Close already does the scoped dirty (intersect with __ui_kb_box), so
    // open must NOT pre-mark — that pre-mark is the actual flash trigger.
    const openBody = header.match(/static inline void ui_kb_open\(uint16_t nodeIdx, uint8_t inputPosition\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(openBody).not.toBe("");
    expect(openBody).not.toMatch(/for\s*\(\s*uint16_t\s+i\s*=\s*0\s*;\s*i\s*<\s*__ui_node_count[\s\S]*?\.dirty\s*=\s*1/);
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
    expect(header).toMatch(/extern\s+const\s+uint16_t\s+__ui_canvas_binding_count/);
  });

  it("has a NODE_CANVAS draw case that sets the canvas target and blits", () => {
    expect(header).toMatch(/case\s+NODE_CANVAS:/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*ui_display_set_target/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*ui_draw_canvas_rect/);
  });

  it("falls back to drawing canvas callbacks directly when the node canvas buffer is unavailable", () => {
    expect(header).toContain("__ui_canvas_fallback_w");
    expect(header).toContain("__ui_canvas_fallback_h");
    expect(header).toMatch(/ui_display_fill_rect\(int16_t x[\s\S]*x \+ __ui_draw_off_x/);
    expect(header).toMatch(/ui_display_set_cursor\(int16_t x[\s\S]*x \+ __ui_draw_off_x/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*uint8_t\s+__ui_canvas_drawn\s*=\s*0/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*if\s*\(ui_display_is_default_target\(\)\)[\s\S]*display_createCanvas/);
    expect(header).toMatch(/case\s+NODE_CANVAS:[\s\S]*if\s*\(!__ui_canvas_drawn\)[\s\S]*__ui_draw_off_x = static_cast<int16_t>\(__ui_prev_off_x \+ __ui_nodes\[i\]\.box\.x\)[\s\S]*__ui_canvas_fn\(nullptr\)[\s\S]*__ui_draw_off_x = __ui_prev_off_x/);
  });
});

describe("text-overflow: clip rendering", () => {
  const header = emitRuntimeHeader();

  it("declares a ui_truncate_clip helper that trims a span to maxWidth without dots", () => {
    // text-overflow: clip must cut overflowing text at the box edge (no "...").
    // The helper trims trailing chars until the prefix fits maxWidth, then NUL-
    // terminates — mirroring ui_truncate_ellipsis minus the appended dots.
    expect(header).toMatch(/ui_truncate_clip\s*\(/);
    expect(header).toMatch(/ui_text_span_width/);
  });

  it("ui_draw_wrapped_text clips the line when textOverflow==0 and it overflows", () => {
    // The overflow guard runs first (line.width > maxWidth), then branches:
    // ellipsis when textOverflow is truthy, clip when it is falsy (!textOverflow).
    // The clip branch must be reachable so text-overflow: clip actually cuts.
    expect(header).toMatch(/line\.width[\s\S]*?maxWidth[\s\S]*?if\s*\(textOverflow\)[\s\S]*?ui_truncate_ellipsis[\s\S]*?else[\s\S]*?ui_truncate_clip/);
  });
});

describe("overflow: hidden clips a node's own text", () => {
  const header = emitRuntimeHeader();

  it("bounds the NODE_TEXT clear rect to box.w when the node is scrollable", () => {
    // Regression: a nowrap text node whose text was wider than its box cleared
    // and drew across box.w, erasing the parent's border. overflow:hidden
    // (scrollable==1) must cap the clear at the node's own box width so it
    // never repaints past its edge. The cap must be a conditional on scrollable
    // right where clearW is finalized, not just any loose co-occurrence.
    expect(header).toMatch(/clearW[\s\S]*?scrollable[\s\S]*?clearW\s*=\s*__ui_nodes\[i\]\.box\.w/);
  });
});

describe("opacity blends the background fill", () => {
  const header = emitRuntimeHeader();

  it("NODE_FILL draws a blended bg when opacity < 100", () => {
    // Regression: the opacity block blended only the border color (bColor)
    // toward clearColor, but the NODE_FILL fill_rect call used the raw,
    // unmodified __ui_nodes[i].bg — so opacity had no visible effect on a
    // filled element's background. Worse, blending toward the node's own
    // clearColor is a no-op for a filled node (its clearColor == its bg, so
    // red-toward-red = red). The fix blends bg toward the PARENT's clear color
    // (the actual backdrop) and passes that to fill_rect / fill_round_rect.
    expect(header).toMatch(/ui_blend\([^)]*bg[^)]*backdrop[^)]*\)/);
    expect(header).toMatch(/ui_parent_clear_color/);
    expect(header).toMatch(/fill_rect\([^,]*,[^,]*,[^,]*,[^,]*,\s*fillBg\s*\)/);
  });
});

describe("touch hit-test supports node indices > 127", () => {
  const header = emitRuntimeHeader();

  it("ui_hit_test returns int16_t (not int8_t, which truncates indices >127)", () => {
    // Regression: ui_hit_test did `return (int8_t)best;`. A back link at node
    // 150 (the flex screen) wrapped to -106, so its tap never fired — back
    // buttons on screens 4-9 (nodes 150/210/236/272/296/304) were dead while
    // screens 1-3 (nodes 22/61/102) worked. The return must be int16_t.
    expect(header).not.toMatch(/ui_hit_test[\s\S]*?return \(int8_t\)/);
    expect(header).toMatch(/int16_t ui_hit_test\([\s\S]*?int16_t target = -1;/);
  });

  it("does not cast a node index to int8_t anywhere it could truncate", () => {
    // Other node-index int8 truncations found alongside: ui_scroll_max arg and
    // the keyboard target. None of these should narrow a node index to int8_t.
    expect(header).not.toMatch(/ui_scroll_max\(\(int8_t\)node\)/);
    expect(header).not.toMatch(/__ui_kb_target\s*=\s*\(int8_t\)nodeIdx/);
  });

  it("ui_open_keyboard_for_input counts NODE_INPUTs with a uint16_t loop (inputs past node 255)", () => {
    // Regression: the input-position scan used `uint8_t j < nodeIdx`. demo-ui's
    // inputs live at node indices 263/265/309 (> 255). A uint8_t counter wraps
    // 255→0 and can never reach nodeIdx, so the loop never terminates — tapping
    // an <input> froze the device (no further touches accepted, hard reset only).
    // The scan counter must be uint16_t to cover the full node-index range.
    const fn = header.match(/ui_open_keyboard_for_input[\s\S]*?\{[\s\S]*?\}/)?.[0] ?? "";
    expect(fn).toMatch(/uint16_t\s+j\s*=\s*0;\s*j\s*<\s*nodeIdx/);
    expect(fn).not.toMatch(/uint8_t\s+j\s*=\s*0;\s*j\s*<\s*nodeIdx/);
  });
});

describe("touch hit-test clips the tap point, not the whole node box", () => {
  const header = emitRuntimeHeader();

  it("provides a point-in-scroll-viewport helper (ui_is_point_clipped_by_scroll)", () => {
    // Regression: ui_hit_test used ui_is_clipped_by_scroll, which tests the
    // node's whole bounding box against the scroll viewport. A wrapped rich-text
    // paragraph is taller than the viewport, so its box overflows below the
    // fold and the whole-box check rejected it — yet an inline <a href> link
    // segment can sit in the visible portion. The fix tests the tap POINT.
    expect(header).toMatch(/ui_is_point_clipped_by_scroll\s*\(/);
  });

  it("ui_hit_test checks the tap point (not the whole box) against scroll parents", () => {
    // The hit-test body must use ui_is_point_clipped_by_scroll on the touch
    // coordinates, and must NOT short-circuit with ui_is_clipped_by_scroll.
    const fn = header.match(/int16_t ui_hit_test\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toMatch(/ui_is_point_clipped_by_scroll\(/);
    expect(fn).not.toMatch(/ui_is_clipped_by_scroll\(/);
  });
});

describe("button press feedback without a click handler", () => {
  const header = emitRuntimeHeader();

  it("ui_hit_test treats NODE_BUTTON as a tappable target even with no handler", () => {
    // Regression: hit_test skipped any node lacking a click/hold/release handler
    // (except RANGE/INPUT/LIST). A pure-CSS button (no JS onClick, relies on
    // :pressed/transition for feedback) was therefore not tappable at all — its
    // :pressed state never armed. NODE_BUTTON must be in the always-interactive
    // list so a button gets press feedback regardless of a wired handler.
    const m = header.match(/int16_t n = target;[\s\S]*?kind == NODE_RANGE[\s\S]*?return n;/);
    expect(m).toBeTruthy();
    expect(m![0]).toMatch(/NODE_BUTTON/);
  });
});

// Phase 1 of the display-agnostic refactor widens color *storage* from
// uint16_t (RGB565) to uint32_t (RGB888-ready) across the node/runtime structs,
// while keeping every value and all blend math in 565 so TFT output is
// byte-identical. These guards lock that invariant: the fields are wide, the
// 565 blend path is still active, and the 888 blend/lerp sit alongside unused.
// See docs/superpowers/specs/2026-07-02-display-agnostic-core-design.md.
describe("Phase 1 color storage widen (byte-identity)", () => {
  const header = emitRuntimeHeader();

  it("UINode color fields are uint32_t (888-ready storage)", () => {
    expect(header).toMatch(/uint32_t bg;/);
    expect(header).toMatch(/uint32_t fg;/);
    expect(header).toMatch(/uint32_t borderColor;/);
    expect(header).toMatch(/uint32_t clearColor;/);
    expect(header).toMatch(/uint32_t gradientColor1;/);
    expect(header).toMatch(/uint32_t gradientColor2;/);
    expect(header).toMatch(/uint32_t outlineColor;/);
    expect(header).toMatch(/uint32_t shadowColor\[4\];/);
    expect(header).toMatch(/uint32_t textShadowColor;/);
  });

  it("UIRichRun/UIKeyframeStop/UIKeyStyle color fields are uint32_t", () => {
    expect(header).toMatch(/struct UIRichRun[\s\S]*?uint32_t fg;/);
    expect(header).toMatch(/struct UIKeyframeStop[\s\S]*?uint32_t bg;[\s\S]*?uint32_t fg;/);
    expect(header).toMatch(/struct UIKeyStyle { uint32_t bg, fg, borderColor; }/);
  });

  it("UITransition keeps color values wide for RGB888 targets", () => {
    expect(header).toMatch(/struct UITransition[\s\S]*?uint32_t pressedTarget;/);
    expect(header).toMatch(/struct UITransition[\s\S]*?uint32_t baseTarget;/);
    expect(header).toMatch(/struct UITransition[\s\S]*?uint32_t prevValue;/);
    expect(header).toMatch(/struct UITransition[\s\S]*?uint32_t targetValue;/);
  });

  it("keeps ui_blend565 + lerp_color defined for the TFT (565) path", () => {
    // Phase 3 routes blend/lerp through ui_blend/UI_LERP_COLOR macros selected
    // by UI_COLOR_DEPTH. The 565 variants remain defined and are selected when
    // UI_COLOR_DEPTH != 888 (the TFT default), so 565 output is byte-identical.
    expect(header).toMatch(/static inline uint16_t ui_blend565/);
    expect(header).toMatch(/static inline uint16_t lerp_color/);
  });

  it("defines ui_blend888 + lerp_color_888 for the rgb666 path", () => {
    expect(header).toMatch(/static inline uint32_t ui_blend888/);
    expect(header).toMatch(/static inline uint32_t lerp_color_888/);
  });

  it("routes blend/lerp through UI_COLOR_DEPTH-selected macros", () => {
    expect(header).toMatch(/#define UI_COLOR_DEPTH/);
    expect(header).toMatch(/#define ui_blend\(fg, bg, op\)/);
    expect(header).toMatch(/#define UI_LERP_COLOR\(a, b, k\)/);
    // Call sites use the macros, not the raw functions.
    expect(header).toMatch(/\bui_blend\(/);
    expect(header).toMatch(/\bUI_LERP_COLOR\(/);
  });

  it("binding fn pointer widened to uint32_t return", () => {
    expect(header).toMatch(/uint32_t \(\*fn\)\(void\)/);
  });

  it("565 color literals and sentinels unchanged (not widened to 888)", () => {
    // UI_NO_PARENT is a node-index sentinel that happens to equal 565 white;
    // it must stay 0xFFFF, not become 0xFFFFFF (it's compared to node indices).
    expect(header).toMatch(/UI_NO_PARENT\s+0xFFFF/);
    // Navigation skips the live clear only when a framebuffer is available;
    // constrained-memory targets retain the stale-screen cleanup fallback.
    expect(header).toContain("display_fillScreen(navBg)");
  });

  it("defines UI_COLOR_T as uint32_t under 888 and uint16_t otherwise", () => {
    expect(header).toMatch(/#define UI_COLOR_T uint32_t\b[\s\S]*?#else[\s\S]*?#define UI_COLOR_T uint16_t/);
  });
  it("widens ui_display_fill_rect color param to UI_COLOR_T", () => {
    expect(header).toMatch(/ui_display_fill_rect\([^)]*UI_COLOR_T color\)/);
  });
  it("widens ui_display_draw_pixel color param to UI_COLOR_T", () => {
    expect(header).toMatch(/ui_display_draw_pixel\([^)]*UI_COLOR_T color\)/);
  });
  it("does not narrow node bg/borderColor/shadow/gradient into a uint16_t local", () => {
    // locals must be UI_COLOR_T so the upper 16 bits of an 888 value survive.
    // (the uint16_t dimFg locals are handled separately — depth-aware math.)
    expect(header).not.toMatch(/uint16_t fillBg = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t bColor = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t shadowCol = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t c1 = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t c2 = __ui_nodes/);
    expect(header).not.toMatch(/uint16_t textBg;/);
    expect(header).not.toMatch(/uint16_t textCol = fgCol/);
  });
  it("keeps text, rich text, keyboard, and scroll canvas helpers depth-aware", () => {
    expect(header).toMatch(/ui_draw_rich_text\([^)]*UI_COLOR_T bg[\s\S]*?UI_COLOR_T fgOverride[\s\S]*?uint16_t maxWidth/);
    expect(header).toMatch(/ui_text_fg_neighbors\([^)]*UI_COLOR_T fg/);
    expect(header).toMatch(/ui_kb_add_key\([^)]*UI_COLOR_T bg[\s\S]*?UI_COLOR_T fg[\s\S]*?UI_COLOR_T borderColor/);
    expect(header).toContain("sizeof(UI_COLOR_T)");
  });
  it("uses the text content width for rich-text alignment and padded link hit tests", () => {
    expect(header).toMatch(/uint16_t alignWidth = maxWidth \? maxWidth : n->box\.w/);
    expect(header).toMatch(/ui_rich_link_hit[\s\S]*localX = px - insetL[\s\S]*localY = py - insetT/);
  });
  it("defines a depth-aware dim mask (0x7F7F7F under 888, 0x7BEF under 565)", () => {
    // Under 888, dimming halves each 8-bit channel independently (0x7F7F7F).
    // The 565 mask 0x7BEF must still exist for the 565 path.
    expect(header).toMatch(/0x7F7F7F/);
    expect(header).toContain("UI_DIM_MASK");
  });
  it("extracts the per-node kind switch into ui_draw_node_body (reusable by the band renderer)", () => {
    // The kind switch is callable from both the main draw loop and the band
    // renderer. The ctx carries the shared draw state; NODE_LIST returns 1
    // (handled) so the caller skips its post-switch epilogue — preserving the
    // old inline 'continue;' semantics.
    // The ctx parameter is const void* (cast back inside) so the emitter's
    // auto-inserted prototype — placed before the struct definition — only
    // involves primitive types and stays valid.
    expect(header).toMatch(/static inline uint8_t ui_draw_node_body\(int16_t i, const void\* rawCtx\)/);
    expect(header).toMatch(/const UINodeDrawCtx\* ctx = static_cast<const UINodeDrawCtx\*>\(rawCtx\);/);
    expect(header).toMatch(/struct UINodeDrawCtx \{[\s\S]*?int16_t drawY;[\s\S]*?const char\* displayText;[\s\S]*?uint8_t drawingBufferedScroll;[\s\S]*?CuttlefishDisplayTarget\* drawTarget;[\s\S]*?int16_t origBoxX;[\s\S]*?int16_t origBoxY;/);
    // The main loop fills the ctx and delegates, branching on the return value.
    expect(header).toMatch(/UINodeDrawCtx __ui_ctx;[\s\S]*?__ui_ctx\.drawY = drawY;[\s\S]*?if \(ui_draw_node_body\(i, &__ui_ctx\)\) \{[\s\S]*?continue;/);
    // NODE_LIST still owns its canvas push / decoration / coord restore and now
    // signals completion via return 1 (not continue;).
    expect(header).toMatch(/case NODE_LIST:[\s\S]*ui_display_set_target\(__ui_draw_target\);[\s\S]*__ui_nodes\[i\]\.box\.x = origBoxX;[\s\S]*__ui_nodes\[i\]\.box\.y = origBoxY;[\s\S]*return 1;.*list handled/);
  });
  it("renders tear-free scroll bands when no viewport canvas fits (no PSRAM)", () => {
    // The band renderer composes the subtree into a short band canvas and pushes
    // one band at a time, so each band completes before it touches the panel.
    expect(header).toMatch(/#ifndef UI_STRIP_BAND_HEIGHT[\s\S]*#define UI_STRIP_BAND_HEIGHT 32/);
    expect(header).toMatch(/static inline uint8_t ui_render_scroll_bands\(uint16_t s\)/);
    // Band canvas is persistent (released on navigation, like the other slots).
    expect(header).toMatch(/display_deleteCanvas\(__ui_band_canvas\);.*__ui_band_canvas = nullptr/);
    // The canvas-fail dispatch defers the band render to a flag (NOT an immediate
    // paint) — the bands must render at the scroll owner's z-order slot so the
    // screen background fill (lower source order) doesn't draw over them.
    expect(header).toMatch(/bufferedScrollBands = 1;[\s\S]*for \(uint16_t c = s \+ 1; c < __ui_nodes\[s\]\.subtreeEnd/);
    // The main draw loop triggers the band render at the owner's z-slot, falling
    // back to direct-full only if the band canvas can't allocate.
    expect(header).toMatch(/if \(bufferedScrollBands && bufferedScrollNode >= 0 &&[\s\S]*ui_render_scroll_bands\(static_cast<uint16_t>\(bufferedScrollNode\)\)[\s\S]*bufferedScrollNode = -1/);
    // Phase 2b fallback renders pending bands if the main loop never hit the slot.
    expect(header).toMatch(/bufferedScrollBands\)[\s\S]*ui_render_scroll_bands\(static_cast<uint16_t>\(bufferedScrollNode\)\)/);
    // Each band pushes the FULL viewport width in one SPI transaction (w == stride,
    // the single-write fast path). The scrollbar slice is composited into each
    // band's gutter before the push — so it's part of the atomic band push, not a
    // separate erase/redraw cycle that would flash it during scroll. The band
    // function does NOT call ui_draw_scrollbar_direct (that would reintroduce the
    // erase/redraw flash); it composites the slice itself. Bound the function by
    // its signature to the end of its emitted slice (the closing backtick).
    const bandFnStart = header.indexOf("static inline uint8_t ui_render_scroll_bands");
    const bandFn = header.slice(bandFnStart, header.length);
    expect(bandFn).toMatch(/display_canvasFillRect\(band, contentW,[\s\S]*sbTrackCol\)[\s\S]*ui_push_canvas_rect\(band, vox, static_cast<int16_t>\(voy \+ bandTop\), vw, thisH\)/);
    // The band function ends with "return 1;" then "return 0;" — neither path
    // calls ui_draw_scrollbar_direct (the slice is composited inline instead).
    const bandFnBody = bandFn.slice(0, bandFn.indexOf("return 0;"));
    expect(bandFnBody).not.toMatch(/ui_draw_scrollbar_direct/);
  });
});
