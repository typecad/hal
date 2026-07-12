// Slice of the C++ runtime header (original source lines 5288-5298).
// Phase 4/5: fb bulk push + refresh flush + closing brace of ui_tick.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTickFlushPhase(): string {
  return `
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
  // as one partial refresh. No-op on TFT.`;
}
