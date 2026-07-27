// Slice of the C++ runtime header (original source lines 2962-2994).
// ui_blend565/ui_blend888 bodies. Tiny slice sitting between touch and text in source.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitBlendBodies(): string {
  return `
static inline uint16_t ui_blend565(uint16_t fg, uint16_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  // Blend in 888 internally for higher precision: unpack 565→888 (replicating
  // high bits), blend at 8-bit, then re-quantize to 565. This produces smoother
  // intermediate values for AA text edges, opacity, shadows, and gradients —
  // the 565-channel blend (32 red levels) was too coarse and showed banding.
  uint8_t fr = (fg >> 11) & 0x1F, fg5 = (fg >> 5) & 0x3F, fb = fg & 0x1F;
  uint8_t br = (bg >> 11) & 0x1F, bg5 = (bg >> 5) & 0x3F, bb = bg & 0x1F;
  // Unpack to 8-bit (5-bit → 8-bit: (v << 3) | (v >> 2)).
  uint16_t fr8 = (fr << 3) | (fr >> 2), fg8 = (fg5 << 2) | (fg5 >> 4), fb8 = (fb << 3) | (fb >> 2);
  uint16_t br8 = (br << 3) | (br >> 2), bg8 = (bg5 << 2) | (bg5 >> 4), bb8 = (bb << 3) | (bb >> 2);
  uint16_t r = static_cast<uint16_t>((fr8 * opacity + br8 * (100 - opacity)) / 100);
  uint16_t g = static_cast<uint16_t>((fg8 * opacity + bg8 * (100 - opacity)) / 100);
  uint16_t b = static_cast<uint16_t>((fb8 * opacity + bb8 * (100 - opacity)) / 100);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

// Blend two RGB888 colors by opacity (0-100). Added for Phase 2 (RGB888/RGB666
// targets); unused in Phase 1, whose TFT path keeps 565 node values and blends
// via ui_blend565 above. Kept alongside so the 888 path is ready when the
// descriptor routes emit through resolveColor888.
static inline uint32_t ui_blend888(uint32_t fg, uint32_t bg, uint8_t opacity) {
  if (opacity >= 100) return fg;
  if (opacity == 0) return bg;
  uint8_t fr = (fg >> 16) & 0xff, fg8 = (fg >> 8) & 0xff, fb = fg & 0xff;
  uint8_t br = (bg >> 16) & 0xff, bg8 = (bg >> 8) & 0xff, bb = bg & 0xff;
  uint8_t r = (fr * opacity + br * (100 - opacity)) / 100;
  uint8_t g = (fg8 * opacity + bg8 * (100 - opacity)) / 100;
  uint8_t b = (fb * opacity + bb * (100 - opacity)) / 100;
  return (static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | b;
}
`;
}
