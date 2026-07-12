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
  } else if (bufferedScrollNode >= 0 && bufferedScrollDirectStrip) {
    ui_draw_scrollbar_direct(bufferedScrollNode, bufferedScrollVX, bufferedScrollVY);
    __ui_nodes[bufferedScrollNode].lastPaintedScrollY = __ui_nodes[bufferedScrollNode].scrollY;`;
}
