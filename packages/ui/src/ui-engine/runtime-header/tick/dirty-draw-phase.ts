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
      uint32_t scrollNeed = static_cast<uint32_t>(vw > 0 ? vw : 0) * static_cast<uint32_t>(vh > 0 ? vh : 0) * 2u;
      if (absDelta > 0 && absDelta < vh) {
        bufferedScrollNode = static_cast<int16_t>(s);
        bufferedScrollDirectStrip = 1;
        ui_warn_scroll_memory(static_cast<uint16_t>(s), 2);
        ui_scroll_direct_prepare(s, &bufferedScrollVX, &bufferedScrollVY);
        break;
      }
      ui_warn_scroll_memory(static_cast<uint16_t>(s), scrollNeed > static_cast<uint32_t>(UI_SCROLL_CANVAS_BUDGET_BYTES) ? 1 : 0);
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
      i = static_cast<int16_t>(__ui_draw_order[__ui_draw_pass++]);
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
        if (i < 0 || ui_node_draws_before(candidate, static_cast<uint16_t>(i))) i = static_cast<int16_t>(candidate);
      }
      if (i < 0) break;
      __ui_draw_pass++;
    }

    // Defer direct display draws for overflow scroll subtrees not composited this
    // frame (Mode B canvas or Mode C strip). Drawing them directly clears the live
    // viewport and produces sequential flashes (AGENTS.md).
    {
      int16_t scrollComp = ui_overflow_scroll_compositor(static_cast<uint16_t>(i));
      if (scrollComp >= 0) {
        uint8_t compositing = scrollComp == bufferedScrollNode &&
          (bufferedScrollCanvas || bufferedScrollDirectStrip);
        if (!compositing) {
          if (static_cast<uint16_t>(i) == static_cast<uint16_t>(scrollComp)) break;
          __ui_nodes[i].dirty = 0;
          continue;
        }
      }
    }

    // Mode C strip: scroll owner is not drawn directly (would fill the viewport).
    if (bufferedScrollDirectStrip && bufferedScrollNode >= 0 &&
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
          int16_t insetL = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingLeft);
          int16_t insetR = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingRight);
          int16_t insetT = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingTop);
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          int16_t textW = static_cast<int16_t>(__ui_nodes[i].box.w) - insetL - insetR;
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
            int16_t paintedTextW = static_cast<int16_t>(__ui_nodes[i].lastTextWidth) + insetL + insetR;
            if (__ui_nodes[i].lastTextWidth > 0 && paintedTextW > static_cast<int16_t>(clearW)) {
              clearW = static_cast<uint16_t>(paintedTextW);
            }
            uint16_t paddedTw = static_cast<uint16_t>(static_cast<int16_t>(tw) + insetL + insetR);
            if (paddedTw > clearW) clearW = paddedTw;
            // overflow:hidden/scroll: never clear past the node's own box. A nowrap
            // line wider than its box would otherwise erase the parent's border.
            if (__ui_nodes[i].scrollable) clearW = __ui_nodes[i].box.w;
            uint16_t clearH = __ui_nodes[i].box.h;
            int16_t paintedTextH = static_cast<int16_t>(__ui_nodes[i].lastTextHeight) + insetT + static_cast<int16_t>(__ui_nodes[i].paddingBottom) + static_cast<int16_t>(__ui_nodes[i].borderWidth);
            if (__ui_nodes[i].lastTextHeight > 0 && paintedTextH > static_cast<int16_t>(clearH)) {
              clearH = static_cast<uint16_t>(paintedTextH);
            }
            uint16_t paddedTh = static_cast<uint16_t>(static_cast<int16_t>(th) + insetT + static_cast<int16_t>(__ui_nodes[i].paddingBottom) + static_cast<int16_t>(__ui_nodes[i].borderWidth));
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
              tsClear, __ui_nodes[i].fontAntialias, 1, tsCol, static_cast<uint16_t>(textW));
          }
          ui_draw_rich_text(i, textX, textY, richTextBg, __ui_nodes[i].fontAntialias, 0, 0, static_cast<uint16_t>(textW));
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
              static_cast<uint16_t>(textW), tsCol, tsCol, ts, __ui_nodes[i].fontAntialias,
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
          ui_draw_wrapped_text(displayText, textX, textY, static_cast<uint16_t>(textW),
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
          int16_t insetL = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingLeft);
          int16_t insetR = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingRight);
          int16_t insetT = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingTop);
          int16_t insetB = static_cast<int16_t>(__ui_nodes[i].borderWidth) + static_cast<int16_t>(__ui_nodes[i].paddingBottom);
          int16_t textX = __ui_nodes[i].box.x + insetL;
          int16_t textY = drawY + insetT;
          int16_t textW = static_cast<int16_t>(__ui_nodes[i].box.w) - insetL - insetR;
          int16_t textH = static_cast<int16_t>(__ui_nodes[i].box.h) - insetT - insetB;
          if (textW < 1) textW = 1;
          if (textH < 1) textH = static_cast<int16_t>(th);
          ui_draw_wrapped_text(displayText,
            textX,
            textY + (textH - static_cast<int16_t>(th)) / 2,
            static_cast<uint16_t>(textW),
            __ui_nodes[i].fg,
            __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor,
            ts, __ui_nodes[i].fontAntialias, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing,
            __ui_nodes[i].lineHeight, __ui_nodes[i].whiteSpaceMode, __ui_nodes[i].textAlign, __ui_nodes[i].underline, __ui_nodes[i].textOverflow);
        }
        break;
      case NODE_CHECK:
        {
          uint16_t clearW = __ui_nodes[i].box.w;
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > static_cast<int16_t>(clearW)) {
            clearW = static_cast<uint16_t>(__ui_nodes[i].lastTextWidth);
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > static_cast<int16_t>(clearH)) {
            clearH = static_cast<uint16_t>(__ui_nodes[i].lastTextHeight);
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
          if (__ui_nodes[i].lastTextWidth > 0 && __ui_nodes[i].lastTextWidth > static_cast<int16_t>(clearW)) {
            clearW = static_cast<uint16_t>(__ui_nodes[i].lastTextWidth);
          }
          if (paintTextW > clearW) clearW = paintTextW;
          uint16_t clearH = __ui_nodes[i].box.h;
          if (__ui_nodes[i].lastTextHeight > 0 && __ui_nodes[i].lastTextHeight > static_cast<int16_t>(clearH)) {
            clearH = static_cast<uint16_t>(__ui_nodes[i].lastTextHeight);
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
          int16_t fillW = (static_cast<int32_t>(bw - 2) * pct) / 100;
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
          int16_t fillW = (static_cast<int32_t>(bw - 8) * pct) / range;
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
          if (__ui_kb_visible && static_cast<int16_t>(__ui_kb_target) == static_cast<int16_t>(i) && __ui_nodes[i].textBuffer[0] == 0) {
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
          int16_t len = static_cast<int16_t>(strlen(disp));
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
          if (__ui_kb_visible && static_cast<int16_t>(__ui_kb_target) == static_cast<int16_t>(i) && (__ui_kb_blink & 0x20)) {
            uint16_t caretW = ui_text_width(clipped, ts, __ui_nodes[i].fontFace, __ui_nodes[i].letterSpacing);
            int16_t caretX = bx + 4 + static_cast<int16_t>(caretW);
            int16_t caretYTop = by + (bh - ts * 8) / 2;
            // fgCol (not textCol): the placeholder-dimming path sets textCol to
            // gray, which would make the caret nearly invisible on a focused
            // empty field. The caret should always be the input's foreground.
            ui_display_fill_rect(caretX, caretYTop, static_cast<int16_t>(ts > 1 ? 2 : 1), static_cast<int16_t>(ts * 8), fgCol);
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
              __ui_draw_off_x = static_cast<int16_t>(__ui_prev_off_x + __ui_nodes[i].box.x);
              __ui_draw_off_y = static_cast<int16_t>(__ui_prev_off_y + drawY);
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
        if (__ui_list_canvas_node != static_cast<int16_t>(i)) listFullRepaint = 1;
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
            int16_t itemY = static_cast<int16_t>(idx * ih) - listScrollY - listTextOffsetY;
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
          uint16_t thumbH = static_cast<uint32_t>(bh) * bh / listContentH;
          if (thumbH < 8) thumbH = 8;
          int16_t maxScroll = listContentH - bh;
          uint16_t thumbY = maxScroll > 0 ? static_cast<uint32_t>(bh - thumbH) * listScrollY / maxScroll : 0;
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
        __ui_list_canvas_node = static_cast<int16_t>(i);
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
    ui_refresh_add_rect(__ui_nodes[i].box.x, __ui_nodes[i].box.y, __ui_nodes[i].box.w, __ui_nodes[i].box.h);`;
}
