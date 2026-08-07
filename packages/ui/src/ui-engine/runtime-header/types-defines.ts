// Slice of the C++ runtime header (original source lines 17-89).
// Guard open, includes, and #define knobs.
// See docs/superpowers/specs/2026-07-12-split-runtime-header-design.md.
export function emitTypesDefines(): string {
  return `
// ── Cuttlefish UI runtime (emit once per TU) ──────────────────────────────
#ifndef __TC_UI_RUNTIME
#define __TC_UI_RUNTIME
#include <stdint.h>
#include <cstring>
#include <new>
#define UI_TEXT_BUF 32   // max stored UI text chars, excluding the trailing NUL
#define UI_TEXT_LINE_BUF 96
#define UI_WS_NORMAL 0
#define UI_WS_NOWRAP 1
#define UI_WS_PRE 2
#define UI_WS_PRE_LINE 3
#ifndef UI_MAX_BUFFERED_PAINT_PIXELS
#define UI_MAX_BUFFERED_PAINT_PIXELS 20000
#endif
#ifndef UI_USE_FULL_FRAMEBUFFER
#define UI_USE_FULL_FRAMEBUFFER 0
#endif
#ifndef UI_TRANSITION_SNAP_MS
#define UI_TRANSITION_SNAP_MS 100
#endif
// Scroll physics + capability defaults. The per-TU #define overrides emitted
// by the UI emitter (from resolveScrollConfig) hit BEFORE this header, so these
// #ifndef guards adopt the configured values. Spec: 2026-06-28-scroll-engine-rewrite-design.md
#ifndef UI_SCROLL_MAX_OVERSCROLL
#define UI_SCROLL_MAX_OVERSCROLL 40
#endif
#ifndef UI_SCROLL_STIFFNESS_X10
#define UI_SCROLL_STIFFNESS_X10 5
#endif
#ifndef UI_SCROLL_EDGE_SNAP_PX
#define UI_SCROLL_EDGE_SNAP_PX 12
#endif
#ifndef UI_SCROLL_DRAG_SCALE_X10
#define UI_SCROLL_DRAG_SCALE_X10 10
#endif
#ifndef UI_SCROLL_SETTLE_MS
#define UI_SCROLL_SETTLE_MS 180
#endif
#ifndef UI_SCROLL_DEADBAND_PX
#define UI_SCROLL_DEADBAND_PX 2
#endif
// Capability tier flags (emitted per-TU before this header; defaults = full).
#ifndef UI_SCROLL_INPUT_TIER_CAPACITIVE
#define UI_SCROLL_INPUT_TIER_CAPACITIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_RESISTIVE
#define UI_SCROLL_INPUT_TIER_RESISTIVE 0
#endif
#ifndef UI_SCROLL_INPUT_TIER_NONE
#define UI_SCROLL_INPUT_TIER_NONE 0
#endif
#ifndef UI_SCROLL_RENDER_TIER_FULL
#define UI_SCROLL_RENDER_TIER_FULL 1
#endif
#ifndef UI_SCROLL_RENDER_TIER_CONSTRAINED
#define UI_SCROLL_RENDER_TIER_CONSTRAINED 0
#endif
#if (UI_SCROLL_INPUT_TIER_CAPACITIVE + UI_SCROLL_INPUT_TIER_RESISTIVE + UI_SCROLL_INPUT_TIER_NONE) == 0
#define UI_SCROLL_INPUT_TIER_RESISTIVE 1
#endif
#define UI_SCROLL_HAS_TOUCH (UI_SCROLL_INPUT_TIER_CAPACITIVE || UI_SCROLL_INPUT_TIER_RESISTIVE)
#define UI_SCROLL_ELASTIC (UI_SCROLL_RENDER_TIER_FULL)
// Telemetry: emits per-frame scrollY/overscrollPx/dy over Serial when defined.
#ifndef UI_SCROLL_DEBUG
#define UI_SCROLL_DEBUG 0
#endif
// Band renderer: height (px) of the horizontal band canvas used to composite
// scroll subtrees tear-free when no viewport canvas fits (no PSRAM / over
// budget). Each band is vw × UI_STRIP_BAND_HEIGHT (~10KB at RGB565 for a
// 320px viewport), so it fits internal SRAM regardless of program size. The
// whole visible subtree is rendered band-by-band, one SPI push per band.
#ifndef UI_STRIP_BAND_HEIGHT
#define UI_STRIP_BAND_HEIGHT 16
#endif
#if defined(ESP32) || defined(ESP8266)
#include <Esp.h>
#endif
`;
}
