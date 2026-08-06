// Slice of the C++ runtime header (original source lines 5279-5287).
// scrollbar + buffered scroll canvas push.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickScrollCanvasPhase(): string {
  return `
  }
  // ②b Draw scrollbar + push canvas for the buffered scroll container.
  if (bufferedScrollNode >= 0 && bufferedScrollCanvas) {
    ui_push_buffered_scroll_canvas(bufferedScrollCanvas, bufferedScrollRepaintCanvas,
      bufferedScrollNode, bufferedScrollVX, bufferedScrollVY,
      bufferedScrollRepaintY, bufferedScrollRepaintH, __ui_draw_target);
  } else if (bufferedScrollNode >= 0 && bufferedScrollBands) {
    // Band render fallback: the main loop didn't trigger it at the owner's
    // z-slot (e.g. the owner was filtered out after dispatch). Render now so
    // the subtree is never left unpainted. ui_render_scroll_bands sets
    // lastPaintedScrollY itself on success; only the failure fallback (band
    // canvas wouldn't allocate) needs to record the scrollY here so the next
    // frame's delta is correct.
    if (!ui_render_scroll_bands(static_cast<uint16_t>(bufferedScrollNode))) {
      ui_draw_scrollbar_direct(bufferedScrollNode, bufferedScrollVX, bufferedScrollVY);
      __ui_nodes[bufferedScrollNode].lastPaintedScrollY = __ui_nodes[bufferedScrollNode].scrollY;
    }
  } else if (bufferedScrollNode >= 0 && (bufferedScrollDirectStrip || bufferedScrollDirectFull)) {
    ui_draw_scrollbar_direct(bufferedScrollNode, bufferedScrollVX, bufferedScrollVY);
    __ui_nodes[bufferedScrollNode].lastPaintedScrollY = __ui_nodes[bufferedScrollNode].scrollY;`;
}
