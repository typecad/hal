// Slice of the C++ runtime header (original source lines 4234-5278).
// refresh begin, kb dirty flush, scroll Mode B/C, fb target, stacking draw loop.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickDirtyDrawPhase(): string {
  return `

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
      // Buffer the targeted update through the keyboard canvas too — drawing
      // the text row directly to the display (fill_rect clear + text redraw)
      // flashes on SPI TFTs because the clear is visible for one frame.
      // Re-render into the canvas and push in one transaction. The canvas
      // already holds the last full-keyboard frame, so we only need to redraw
      // the text row + the single changed key on top of it.
      // (__ui_kb_canvas is declared static in the keyboard slice, earlier in
      // this same translation unit — no extern needed.)
      if (__ui_kb_canvas && display_canvasBuffer(__ui_kb_canvas)) {
        int16_t kw = __ui_kb_box.w;
        int16_t saveBoxX = __ui_kb_box.x;
        int16_t saveBoxY = __ui_kb_box.y;
        CuttlefishDisplayTarget* __kb_prev = ui_display_get_target();
        ui_display_set_target(__ui_kb_canvas);
        __ui_kb_box.x = 0;
        __ui_kb_box.y = 0;
        ui_kb_draw_text_row();
        uint8_t has_key_repaint = (__ui_kb_repaint_key >= 0 && __ui_kb_keys[__ui_kb_repaint_key].special != 255) ? 1 : 0;
        if (has_key_repaint) {
          ui_kb_draw_key(static_cast<uint8_t>(__ui_kb_repaint_key));
        }
        __ui_kb_box.x = saveBoxX;
        __ui_kb_box.y = saveBoxY;
        ui_display_set_target(__kb_prev);
        // Push only the changed region: text row alone (UI_KB_TEXT_H) when no
        // key highlight changed, or the full canvas when a key was repainted
        // (the key could be anywhere in the keyboard grid).
        display_startWrite();
        if (has_key_repaint) {
          display_setAddrWindow(saveBoxX, saveBoxY, kw, __ui_kb_box.h);
          display_writePixels(display_canvasBuffer(__ui_kb_canvas), static_cast<uint32_t>(kw) * __ui_kb_box.h);
        } else {
          display_setAddrWindow(saveBoxX, saveBoxY, kw, UI_KB_TEXT_H);
          display_writePixels(display_canvasBuffer(__ui_kb_canvas), static_cast<uint32_t>(kw) * UI_KB_TEXT_H);
        }
        display_endWrite();
      } else {
        // No canvas — fall back to direct draw (slow but correct).
        ui_kb_draw_text_row();
        if (__ui_kb_repaint_key >= 0 && __ui_kb_keys[__ui_kb_repaint_key].special != 255) {
          ui_kb_draw_key(static_cast<uint8_t>(__ui_kb_repaint_key));
        }
      }
    }
    __ui_kb_dirty = 0;
    __ui_kb_repaint_key = -1;
    return;
  }
#endif
  // Select and seed the framebuffer before scroll compositors run. Band/list
  // renderers can then composite into this same off-screen target instead of
  // pushing their bands to the live panel before the main draw pass starts.
  // This prevents intermediate software-rendering seams; the final SPI transfer
  // remains sequential on panels without TE/vblank synchronization.
  CuttlefishCanvas16* __ui_fb = ui_get_framebuffer();
  CuttlefishDisplayTarget* __ui_draw_target = __ui_fb ? (CuttlefishDisplayTarget*)__ui_fb : display_defaultTarget();
  ui_fb_begin_frame();
  // A retained framebuffer only needs an SPI transfer when composition changed.
  // Avoid pushing a full frame on idle ticks; this is the main steady-state cost
  // of the PSRAM path on otherwise static screens.
  uint8_t __ui_fb_frame_dirty = 0;
  // Whether any node painted this tick. The select overlay below re-stamps
  // only when it or the frame beneath changed; an unconditional stamp pushes
  // the modal region over SPI every frame, which reads as constant
  // refreshing/tearing on no-TE TFT panels.
  uint8_t __ui_frame_painted = 0;
  if (__ui_fb && __ui_fb_needs_compose) {
    UI_COLOR_T fbBg = (UI_COLOR_T)0;
    if (__ui_active_screen_bg_node < __ui_node_count) {
      fbBg = __ui_nodes[__ui_active_screen_bg_node].hasBg
        ? __ui_nodes[__ui_active_screen_bg_node].bg
        : __ui_nodes[__ui_active_screen_bg_node].clearColor;
    }
    display_canvasFillScreen(__ui_fb, fbBg);
    ui_fb_add_rect(0, 0, display_width(), display_height());
    // A retained framebuffer cannot reuse the previous screen's pixels. Mark
    // every node on the active screen dirty for one coherent composition.
    for (uint16_t f = 0; f < __ui_node_count; f++) {
      if (__ui_nodes[f].screenId == __ui_active_screen) {
        __ui_nodes[f].dirty = 1;
        __ui_nodes[f].lastTextHeight = 0;
        __ui_nodes[f].layoutCacheKey = 0;
        if (__ui_nodes[f].kind == NODE_PROGRESS || __ui_nodes[f].kind == NODE_RANGE) __ui_nodes[f].lastTextWidth = -1;
        else __ui_nodes[f].lastTextWidth = 0;
      }
    }
    __ui_fb_needs_compose = 0;
    __ui_fb_frame_dirty = 1;
  }

  if (__ui_scroll_render_locked) {
    for (uint16_t lock = 0; lock < __ui_node_count; lock++) __ui_scroll_render_locked[lock] = 0;
  }

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
  // Kept as a compatibility flag for the old compositor state machine. It is
  // never enabled: direct per-node SPI drawing is a visible tearing path, so a
  // missing canvas freezes the affected viewport instead.
  uint8_t bufferedScrollDirectFull = 0;
  // Local retained-canvas repair: dirty descendants draw directly into the
  // full-frame framebuffer while the existing scroll canvas is invalidated for
  // the next actual scroll. This avoids copying an unchanged viewport.
  uint8_t bufferedScrollLocalRepair = 0;
  // Band renderer pending: like bufferedScrollDirectFull but the actual paint
  // is deferred to the scroll owner's z-order slot in the main draw loop. The
  // band composites the whole subtree at once, so it must paint AFTER lower-z
  // nodes (e.g. the screen background fill) but BEFORE higher-z ones (header).
  // Painting it here (before the main loop) lets the bg fill overwrite it.
  uint8_t bufferedScrollBands = 0;
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
      // Virtualized lists manage their own rendering (NODE_LIST case in
      // ui_draw_node_body). Skip them in the scroll dispatch — the band
      // renderer walks their subtree (which is empty for virtualized lists),
      // leaving the list node itself unpainted.
      if (__ui_nodes[s].virtualized) continue;
    // The retained framebuffer only needs the full viewport for actual scroll
    // movement or the first composition. A local child update is repaired in
    // the existing scroll canvas and contributes its own paint rect later;
    // pushing the whole viewport here is the Forms-screen flash.
    if (__ui_fb) __ui_fb_frame_dirty = 1;

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
      bufferedScrollNode = static_cast<int16_t>(s);
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
          UIRect exposed = { vox, static_cast<int16_t>(voy + exposedY), vw, exposedH };
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
        // A zero-delta dirty scroll owner is usually a local child update (a
        // form binding, button transition, or animation). Keep the retained
        // canvas and its existing pixels in that case; the dirty descendants
        // will redraw in place and the final framebuffer union stays local.
        uint8_t localRepair = __ui_fb && deltaY == 0 &&
          __ui_nodes[s].lastPaintedScrollY == __ui_nodes[s].scrollY &&
          ui_scroll_subtree_has_dirty(s);
        if (localRepair) {
          // The framebuffer is already the authoritative composition surface for
          // this zero-delta update. Let dirty descendants draw there directly;
          // invalidate the retained scroll canvas after each child draw so it is
          // rebuilt before the next scroll gesture.
          bufferedScrollLocalRepair = 1;
          bufferedScrollCanvas = nullptr;
          bufferedScrollRepaintCanvas = nullptr;
        } else {
          // Initial composition, a large jump, or an owner-only invalidation:
          // seed the whole viewport and repaint its complete stacking subtree.
          for (uint16_t c = s; c < __ui_nodes[s].subtreeEnd; c++) {
            __ui_nodes[c].dirty = 1;
            if (__ui_nodes[c].kind == NODE_PROGRESS) __ui_nodes[c].lastTextWidth = -1;
            else if (__ui_nodes[c].kind == NODE_RANGE) __ui_nodes[c].lastTextWidth = -1;
            __ui_nodes[c].lastTextHeight = 0;
          }
          display_canvasFillScreen(bufferedScrollCanvas, scrollBg);
          if (__ui_fb) ui_fb_add_rect(__ui_nodes[s].box.x, __ui_nodes[s].box.y,
            __ui_nodes[s].box.w, __ui_nodes[s].box.h);
        }
      } else if (__ui_fb) {
        // Shift-and-repair changes the entire viewport's visible mapping.
        ui_fb_add_rect(__ui_nodes[s].box.x, __ui_nodes[s].box.y,
          __ui_nodes[s].box.w, __ui_nodes[s].box.h);
      }
      // The scroll owner is represented by bufferedScrollCanvas this frame.
      // Drawing it directly first clears the live display and makes scrolling
      // visibly flash before the canvas is pushed.
      __ui_nodes[s].dirty = 0;
    } else {
      // Canvas won't fit (no PSRAM / over budget). The band renderer composes the
      // whole visible subtree into a short horizontal band canvas (vw ×
      // UI_STRIP_BAND_HEIGHT) and pushes one band at a time, so each band
      // completes before it touches the panel — tear-free, with ~10KB of SRAM
      // regardless of program size. If the band canvas also cannot allocate,
      // the viewport is retained rather than using direct per-node SPI draws.
      if (__ui_scroll_canvas_ok) __ui_scroll_canvas_ok[s] = 0;
      // Defer the band render to the scroll owner's z-order slot in the main
      // draw loop (see bufferedScrollBands handling below). Painting here would
      // let lower-z nodes (screen bg fill) draw over the bands afterward. The
      // owner stays dirty so the main loop reaches its z-slot and triggers the
      // render; the band code clears it once painted. The subtree children are
      // cleared now so the main loop never draws them directly — the band path
      // is the sole renderer for the subtree this frame.
      bufferedScrollNode = static_cast<int16_t>(s);
      bufferedScrollVX = vox;
      bufferedScrollVY = voy;
      bufferedScrollBands = 1;
      for (uint16_t c = s + 1; c < __ui_nodes[s].subtreeEnd; c++) {
        __ui_nodes[c].dirty = 0;
      }
      break;
    }  // Only one scroll container per frame (the canvas is reused for subsequent
  // ones in the next dirty frame). This matches the original design.
  break;
}
  // The framebuffer target was selected and seeded before scroll compositors;
  // the stacking draw pass below uses the same __ui_draw_target. The retained
  // single buffer is a composition surface, not a synchronized panel swap.

  // Draw dirty nodes in stacking order: lower z-index first, then source order.
  // __ui_draw_order is built once in ui_init so each frame is O(N).
  for (uint16_t __ui_draw_pass = 0; __ui_draw_pass < __ui_node_count; ) {
    int16_t i;
    if (__ui_draw_order) {
      i = static_cast<int16_t>(__ui_draw_order[__ui_draw_pass++]);
      if (!__ui_nodes[i].dirty) continue;
      if (__ui_fb) __ui_fb_frame_dirty = 1;
      if (!ui_is_effectively_visible(i)) { __ui_nodes[i].dirty = 0; continue; }
      if (__ui_nodes[i].screenId != __ui_active_screen) { __ui_nodes[i].dirty = 0; continue; }
    } else {
      // malloc failed at startup: preserve correct z-order via selection sort.
      i = -1;
      for (uint16_t candidate = 0; candidate < __ui_node_count; candidate++) {
        if (!__ui_nodes[candidate].dirty) continue;
        if (__ui_fb) __ui_fb_frame_dirty = 1;
        if (!ui_is_effectively_visible(candidate)) { __ui_nodes[candidate].dirty = 0; continue; }
        if (__ui_nodes[candidate].screenId != __ui_active_screen) { __ui_nodes[candidate].dirty = 0; continue; }
        if (i < 0 || ui_node_draws_before(candidate, static_cast<uint16_t>(i))) i = static_cast<int16_t>(candidate);
      }
      if (i < 0) break;
      __ui_draw_pass++;
    }

    // Open-drawer overlap classification: the drawer subtree draws above other
    // content (z-order + later draw slot). A dirty node underneath would
    // paint its clear+redraw over the panel's pixels — a bound text behind an
    // open drawer erases the drawer's buttons on repaint. Fully covered by an
    // opaque open drawer → none of it is visible; skip the repaint entirely.
    // Partially covered → re-dirty that drawer's subtree so it re-stamps on
    // top later in this same pass (its z sorts it after the covered node).
    if (__ui_drawer_slots > 0) {
      for (uint8_t dslot = 0; dslot < __ui_drawer_slots; dslot++) {
        if (__ui_drawer_idx[dslot] < 0) continue;
        uint16_t droot = static_cast<uint16_t>(__ui_drawer_idx[dslot]);
        if (static_cast<uint16_t>(i) == droot ||
            (i > static_cast<int16_t>(droot) && static_cast<uint16_t>(i) < __ui_nodes[droot].subtreeEnd)) continue;
        if (__ui_drawer_progress[dslot] < 255) continue;  // closed or sliding
        int16_t dX = ui_draw_x_for_node(droot);
        int16_t dY = ui_draw_y_for_node(droot);
        int16_t nX = ui_draw_x_for_node(static_cast<uint16_t>(i));
        int16_t nY = ui_draw_y_for_node(static_cast<uint16_t>(i));
        if (!ui_rects_intersect(nX, nY, __ui_nodes[i].box.w, __ui_nodes[i].box.h,
                                dX, dY, __ui_nodes[droot].box.w, __ui_nodes[droot].box.h)) continue;
        uint8_t fullyCovered = (nX >= dX && nY >= dY &&
          nX + __ui_nodes[i].box.w <= dX + __ui_nodes[droot].box.w &&
          nY + __ui_nodes[i].box.h <= dY + __ui_nodes[droot].box.h) ? 1 : 0;
        if (fullyCovered && __ui_nodes[droot].hasBg && __ui_nodes[droot].opacity >= 100) {
          __ui_nodes[i].dirty = 0;
        } else {
          __ui_nodes[droot].dirty = 1;
          __ui_nodes[droot].lastTextHeight = 0;
          for (uint16_t c = droot + 1; c < __ui_nodes[droot].subtreeEnd; c++) {
            __ui_nodes[c].dirty = 1;
            __ui_nodes[c].lastTextHeight = 0;
          }
        }
        break;
      }
      if (!__ui_nodes[i].dirty) continue;
    }

    // Defer direct display draws for overflow scroll subtrees not composited this
    // frame (Mode B canvas, Mode C strip, direct-full fallback, or band render).
    // Drawing them directly clears the live viewport and produces sequential
    // flashes (AGENTS.md) — except in direct-full mode, where there is no canvas
    // and direct draw is the only way to show content.
    {
      int16_t scrollComp = ui_overflow_scroll_compositor(static_cast<uint16_t>(i));
      if (scrollComp >= 0) {
        uint8_t compositing = scrollComp == bufferedScrollNode &&
          (bufferedScrollCanvas || bufferedScrollDirectFull || bufferedScrollBands || bufferedScrollLocalRepair);
        if (!compositing) {
          if (static_cast<uint16_t>(i) == static_cast<uint16_t>(scrollComp)) break;
          // Not composited this frame. A child FULLY inside its scroll
          // viewport repaints directly through its own buffered paint (paint
          // canvas or bands — a single atomic push; the epilogue invalidates
          // the retained scroll canvas so the next scroll recomposes). Only
          // partially/fully clipped children defer: their edge pixels must
          // come from the composited canvas, and drawing them directly would
          // paint outside the viewport.
          if (ui_is_rect_clipped_by_scroll(static_cast<uint16_t>(i),
              ui_draw_x_for_node(static_cast<uint16_t>(i)),
              ui_draw_y_for_node(static_cast<uint16_t>(i)),
              __ui_nodes[i].box.w, __ui_nodes[i].box.h)) {
            __ui_nodes[i].dirty = 0;
            continue;
          }
        }
      }
    }

    // Band renderer: paint the whole subtree at the scroll owner's z-order slot.
    // This must run AFTER lower-z nodes (e.g. the screen background fill, which
    // has lower source order) have been drawn, so they don't overwrite the bands.
    // When the main loop reaches the scroll owner itself, render the bands now
    // (its z-position), mark the owner handled, and continue.
    if (bufferedScrollBands && bufferedScrollNode >= 0 &&
        static_cast<uint16_t>(i) == static_cast<uint16_t>(bufferedScrollNode)) {
      if (ui_render_scroll_bands(static_cast<uint16_t>(bufferedScrollNode))) {
        __ui_frame_painted = 1;
        bufferedScrollBands = 0;
        bufferedScrollNode = -1;
        __ui_nodes[i].dirty = 0;
        continue;
      }
      // Band canvas allocation failed. Retain the existing viewport pixels rather
      // than falling back to direct-full SPI primitives; direct-full is the
      // tearing path this compositor is designed to prevent.
      bufferedScrollBands = 0;
      if (__ui_scroll_render_locked) __ui_scroll_render_locked[static_cast<uint16_t>(bufferedScrollNode)] = 1;
      __ui_nodes[static_cast<uint16_t>(bufferedScrollNode)].dirty = 0;
      bufferedScrollNode = -1;
    }    // Band renderer early-push: if we're about to draw a node that comes AFTER
    // the scroll owner in draw order (e.g. a header with higher source order)
    // and the bands haven't rendered yet, render them first so they land below
    // that higher-z node. Mirrors the Mode B canvas early-push below.
    if (bufferedScrollBands && bufferedScrollNode >= 0 &&
        !(i > bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd) &&
        ui_node_draws_before(static_cast<uint16_t>(bufferedScrollNode), static_cast<uint16_t>(i))) {
      if (ui_render_scroll_bands(static_cast<uint16_t>(bufferedScrollNode))) {
        __ui_frame_painted = 1;
        bufferedScrollBands = 0;
        bufferedScrollNode = -1;
      } else {
        // Band alloc failed — retain the previous viewport rather than exposing
        // a direct-full per-primitive SPI repaint.
        bufferedScrollBands = 0;
        if (__ui_scroll_render_locked) __ui_scroll_render_locked[static_cast<uint16_t>(bufferedScrollNode)] = 1;
        __ui_nodes[static_cast<uint16_t>(bufferedScrollNode)].dirty = 0;
        bufferedScrollNode = -1;
      }
    }

    // Mode C strip / direct-full: scroll owner is not drawn directly (would fill
    // the viewport); its children are drawn directly below.
    if ((bufferedScrollDirectFull || bufferedScrollLocalRepair) && bufferedScrollNode >= 0 &&
        static_cast<uint16_t>(i) == static_cast<uint16_t>(bufferedScrollNode)) {
      __ui_nodes[i].dirty = 0;
      continue;
    }

    if (bufferedScrollNode >= 0 && bufferedScrollCanvas &&
        !(i > bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd) &&
        ui_node_draws_before(static_cast<uint16_t>(bufferedScrollNode), static_cast<uint16_t>(i)) &&
        !ui_scroll_subtree_has_dirty(static_cast<uint16_t>(bufferedScrollNode))) {
      ui_push_buffered_scroll_canvas(bufferedScrollCanvas, bufferedScrollRepaintCanvas,
        bufferedScrollNode, bufferedScrollVX, bufferedScrollVY,
        bufferedScrollRepaintY, bufferedScrollRepaintH, __ui_draw_target);
      __ui_frame_painted = 1;
      bufferedScrollNode = -1;
      bufferedScrollCanvas = nullptr;
      bufferedScrollRepaintCanvas = nullptr;
    }

    // Redirect to the scroll canvas if this node is inside the buffered container
    // AND a real canvas is active this frame (Mode B only). Direct-strip and
    // direct-full have no canvas — their children must draw to the display target
    // (and thus qualify for the per-node paint-canvas optimization), not redirect
    // to a null scroll canvas. Without this, a strip-drag frame sets
    // drawingBufferedScroll=1, which skips the paint canvas and forces the
    // repainting children to direct-draw per-pixel to SPI (~100ms/text node).
    uint8_t drawingBufferedScroll = !bufferedScrollDirectFull &&
      (bufferedScrollCanvas != nullptr) && bufferedScrollNode >= 0 &&
      i > bufferedScrollNode && i < __ui_nodes[bufferedScrollNode].subtreeEnd;
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
    if (__ui_nodes[i].kind == NODE_TEXT || __ui_nodes[i].kind == NODE_SELECT) {
      uint16_t hInset = static_cast<uint16_t>(__ui_nodes[i].paddingLeft) + static_cast<uint16_t>(__ui_nodes[i].paddingRight) + static_cast<uint16_t>(__ui_nodes[i].borderWidth) * 2;
      uint16_t vInset = static_cast<uint16_t>(__ui_nodes[i].paddingTop) + static_cast<uint16_t>(__ui_nodes[i].paddingBottom) + static_cast<uint16_t>(__ui_nodes[i].borderWidth) * 2;
      paintTextW = static_cast<uint16_t>(tw + hInset);
      paintTextH = static_cast<uint16_t>(th + vInset);
    }
    if (__ui_nodes[i].kind == NODE_CHECK || __ui_nodes[i].kind == NODE_RADIO) {
      paintTextW = tw + 22;
      if (paintTextH < 16) paintTextH = 16;
    }

    UIRect paintRect;
    ui_node_paint_rect(i, baseDrawX, baseDrawY, drawX, drawY, paintTextW, paintTextH, &paintRect);
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
      // Guard against a null canvas (the subtree was flagged drawingBufferedScroll
      // but no canvas is available this frame — e.g. a second scroll owner whose
      // canvas couldn't allocate). Skip the canvas-local clip and draw the node
      // to the display target; the scroll-viewport clip below still bounds it.
      if (scrollDrawCanvas) {
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
    uint8_t wantedBuffer = !drawingBufferedScroll && !__ui_fb && ui_should_buffer_paint(i, paintCanvasW, paintCanvasH);
    // Large paint rects prefer the band renderer (small ~10KB SRAM canvas,
    // strip-at-a-time) over the repair canvas even when the repair canvas could
    // allocate (e.g. in PSRAM). A large repair canvas has higher alloc/seed/push
    // latency than banding, which shows as a press/scroll flash; the band canvas
    // lives in fast internal SRAM and pushes smaller per-band transactions.
    uint8_t preferBand = wantedBuffer && (UI_BAND_PREFER_PIXELS > 0) &&
      (static_cast<uint32_t>(paintCanvasW) * static_cast<uint32_t>(paintCanvasH) > static_cast<uint32_t>(UI_BAND_PREFER_PIXELS));
    if (wantedBuffer && !preferBand) {
      paintCanvas = ui_get_repair_canvas(paintCanvasW, paintCanvasH);
      if (paintCanvas) {
        drawingPaintCanvas = 1;
        ui_display_set_target(paintCanvas);
        ui_seed_paint_canvas_for_node(i, paintCanvas, paintCanvasX, paintCanvasY, 0);
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
      // No repair canvas this frame — either the paint rect is large enough to
      // prefer the band renderer (preferBand: lower-latency than a big PSRAM
      // repair canvas), or the repair canvas wouldn't allocate (over budget /
      // heap fragmentation). Composite the node into the ~10KB band canvas one
      // horizontal strip at a time, pushing each band tear-free. Avoids the
      // direct clear→redraw-to-SPI that visibly flashes on press/scroll.
      if (wantedBuffer && ui_render_node_bands(static_cast<uint16_t>(i), paintCanvasX, paintCanvasY, paintCanvasW, paintCanvasH)) {
        __ui_frame_painted = 1;
        if (!drawingBufferedScroll) {
          ui_invalidate_scroll_canvas_for_node(i);
        }
        __ui_nodes[i].box.x = origBoxX;
        __ui_nodes[i].box.y = origBoxY;
        __ui_nodes[i].dirty = 0;
        ui_refresh_add_rect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
        continue;
      }
      // Band canvas also failed — last resort: retry the repair canvas (it
      // might fit when the band canvas is contended). If both allocations fail,
      // lock this scroll owner for the frame and retain its previous pixels;
      // never fall through to direct primitive SPI draws, which visibly tear.
      if (wantedBuffer && preferBand) {
        paintCanvas = ui_get_repair_canvas(paintCanvasW, paintCanvasH);
        if (paintCanvas) {
          drawingPaintCanvas = 1;
          ui_display_set_target(paintCanvas);
          ui_seed_paint_canvas_for_node(i, paintCanvas, paintCanvasX, paintCanvasY, 0);
          baseDrawX -= paintCanvasX;
          baseDrawY -= paintCanvasY;
          drawX -= paintCanvasX;
          drawY -= paintCanvasY;
        }
      }
      if (!drawingPaintCanvas) {
        if (wantedBuffer && preferBand && __ui_scroll_render_locked &&
            __ui_nodes[i].scrollable) {
          __ui_scroll_render_locked[i] = 1;
          __ui_nodes[i].dirty = 0;
          __ui_nodes[i].box.x = origBoxX;
          __ui_nodes[i].box.y = origBoxY;
          continue;
        }
        ui_clear_press_offset_area(i, baseDrawX, baseDrawY, drawX, drawY, paintTextW, paintTextH);
      }
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
    // ── Per-kind draw dispatch ─────────────────────────────────────────────
    // The kind switch lives in ui_draw_node_body (node-draw-body slice) so the
    // strip/band renderer can reuse it. The ctx carries the draw state both
    // paths share; the list case may return 1 (it handled canvas push,
    // decoration, coord restore, and dirty-clear itself) in which case this
    // node is done — skip the post-switch epilogue exactly as the old inline
    // 'continue;' did.
    UINodeDrawCtx __ui_ctx;
    __ui_ctx.drawY = drawY;
    __ui_ctx.bColor = bColor;
    __ui_ctx.fillBg = fillBg;
    __ui_ctx.ts = ts;
    __ui_ctx.textMaxW = textMaxW;
    __ui_ctx.tw = tw;
    __ui_ctx.th = th;
    __ui_ctx.paintTextW = paintTextW;
    __ui_ctx.paintTextH = paintTextH;
    __ui_ctx.displayText = displayText;
    __ui_ctx.drawingBufferedScroll = drawingBufferedScroll;
    __ui_ctx.drawTarget = __ui_draw_target;
    __ui_ctx.origBoxX = origBoxX;
    __ui_ctx.origBoxY = origBoxY;
    __ui_frame_painted = 1;
    if (ui_draw_node_body(i, &__ui_ctx)) {
      continue;
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
    if (__ui_fb) ui_fb_add_rect(paintRect.x, paintRect.y, paintRect.w, paintRect.h);
    ui_refresh_add_rect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h);
  }

  // Modal <select> list: stamp the overlay after the dirty pass so tree
  // redraws never bury it. Stamped only when the overlay itself is dirty
  // (open) or something painted beneath it this frame; the close path marks
  // the whole tree dirty for the erase repaint.
  if (__ui_select_menu >= 0 && (__ui_select_menu_dirty || __ui_frame_painted)) {
    ui_select_menu_draw();
  }`;
}
