// ---------------------------------------------------------------------------
// Zephyr mono UI display adapter — Stage 2's 1bpp lowering target.
//
// The mono panel IS a backing store: the adapter keeps a full-frame vtiled
// MONO01 framebuffer (byte = 8 vertical pixels, buf[(y>>3)*W + x], bit
// 1<<(y&7) — the layout Zephyr's ssd1306-class drivers expect from
// display_write: pitch == width, y and height multiples of 8). Every UI draw
// lands in RAM through a CuttlefishGFX subclass; ui_refresh_flush pushes the
// whole frame with ONE display_write call (full-frame redraw, always — a
// 128×64 frame is 1KB, ~25ms over I²C; incremental compositing has nothing
// to optimize).
//
// The runtime's scroll-canvas/band machinery is bypassed under
// UI_FULL_FRAME_REDRAW (see the engine's runtime header); scroll clipping
// rides this adapter's mono clip rect (display_mono_set_clip), which every
// draw primitive enforces — including pixels emitted inside the CuttlefishGFX
// geometry algorithms, which is why the clip lives here and not in the shim.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
//
// AGENTS.md rendering guardrails honored: one static framebuffer, no per-frame
// allocation, one atomic push per frame.
// ---------------------------------------------------------------------------

import type { DisplayAdapterCode } from "@typecad/cuttlefish/api/shared";
import type { ZephyrDisplayProfile } from "./profiles.js";
import { displayFactsLine } from "./profiles.js";
import { CANVAS_LIFECYCLE_SECTION, TARGET_FORWARDERS_SECTION, profileMarkerLine } from "./ui-adapter-shared.js";

/**
 * Build the mono (1bpp) UI adapter for a profile. The profile's dtLabel must
 * name a display node an in-tree mono driver binds (ssd1306-class over I²C —
 * the overlay generates the node; the driver self-builds from it).
 */
export function zephyrMonoDisplayAdapter(profile: ZephyrDisplayProfile): DisplayAdapterCode {
  const w = profile.width;
  const h = profile.height;
  const dtLabel = profile.dtLabel;
  const nativeW = profile.nativeWidth ?? w;
  const nativeH = profile.nativeHeight ?? h;

  const includes = [
    `// --- Zephyr mono UI display adapter (${profile.driver}, full-frame 1bpp) ---`,
    profileMarkerLine(profile.driver),
    displayFactsLine(profile),
    `// Mono target: the adapter's ZephyrMonoTarget (a CuttlefishGFX writing a`,
    `// vtiled MONO01 backing store), NOT the rgb565 panel-ops path.`,
    `#define CuttlefishDisplayTarget ZephyrMonoTarget`,
    `#include <zephyr/kernel.h>`,
    `#include <zephyr/drivers/display.h>`,
    `#include <zephyr/drivers/gpio.h>`,
  ].join("\n");

  const declaration = [
    `// CUTTLEFISH_DISPLAY_BEGIN`,
    `// The panel device: the overlay's display0 node, bound by an in-tree mono`,
    `// driver (ssd1306-class). Compile-time constant — DEVICE_DT_GET requires`,
    `// the driver to exist at build time, which the Kconfig layer guarantees.`,
    `static const struct device* __tc_zd_dev = DEVICE_DT_GET(DT_NODELABEL(${dtLabel}));`,
    `static struct display_capabilities __tc_zd_caps;`,
    `// Full-frame backing store, vtiled MONO01: byte = 8 vertical pixels,`,
    `// buf[(y>>3)*${w} + x], bit = 1<<(y&7). One bit per pixel ⇒ ${w}*${h}/8 = ${(w * h) / 8} bytes.`,
    `static uint8_t __tc_mono_fb[(${w} * ${h} + 7) / 8];`,
    `// Push scratch for panels that insist on MONO10 (1=black): the frame is`,
    `// complemented here, never in the backing store itself.`,
    `static uint8_t __tc_mono_inv[(${w} * ${h} + 7) / 8];`,
    `// Set when the panel insists on MONO10 (1=black): pushes invert the frame.`,
    `static bool __tc_mono_invert = false;`,
    `// Scroll-viewport clip in display coords (w <= 0 ⇒ no clip). Enforced in`,
    `// ZephyrMonoTarget's drawPixel/fillRect so EVERY pixel — including ones`,
    `// emitted inside CuttlefishGFX geometry algorithms — respects it.`,
    `static int16_t __tc_mono_clip_x = 0;`,
    `static int16_t __tc_mono_clip_y = 0;`,
    `static int16_t __tc_mono_clip_w = 0;`,
    `static int16_t __tc_mono_clip_h = 0;`,
    `// CUTTLEFISH_DISPLAY_END`,
  ].join("\n");

  const functions = `
// ── Mono target ───────────────────────────────────────────────────────────
// A CuttlefishGFX whose pixels are backing-store bits. All geometry/text
// primitives the runtime draws funnel through these two overrides.
class ZephyrMonoTarget final : public CuttlefishGFX {
 public:
  ZephyrMonoTarget() : CuttlefishGFX(nullptr, nullptr) {}
  int16_t width() const { return ${w}; }
  int16_t height() const { return ${h}; }
  void drawPixel(int16_t x, int16_t y, uint16_t color) {
    if (x < 0 || y < 0 || x >= ${w} || y >= ${h}) return;
    if (__tc_mono_clip_w > 0 &&
        (x < __tc_mono_clip_x || y < __tc_mono_clip_y ||
         x >= __tc_mono_clip_x + __tc_mono_clip_w ||
         y >= __tc_mono_clip_y + __tc_mono_clip_h)) return;
    uint8_t mask = static_cast<uint8_t>(1u << (y & 7));
    uint8_t* b = &__tc_mono_fb[(static_cast<uint32_t>(y) >> 3) * ${w}u + static_cast<uint32_t>(x)];
    if (color) *b = static_cast<uint8_t>(*b | mask);
    else       *b = static_cast<uint8_t>(*b & static_cast<uint8_t>(~mask));
  }
  void fillRect(int16_t x, int16_t y, int16_t rw, int16_t rh, uint16_t color) {
    if (rw <= 0 || rh <= 0) return;
    for (int16_t j = 0; j < rh; j++) {
      for (int16_t i = 0; i < rw; i++) {
        drawPixel(static_cast<int16_t>(x + i), static_cast<int16_t>(y + j), color);
      }
    }
  }
};
static ZephyrMonoTarget __tc_display;

// ── Mono clip (the runtime's full-frame scroll clipping) ──────────────────
static inline void display_mono_set_clip(int16_t x, int16_t y, int16_t rw, int16_t rh) {
  __tc_mono_clip_x = x;
  __tc_mono_clip_y = y;
  __tc_mono_clip_w = rw;
  __tc_mono_clip_h = rh;
}
static inline void display_mono_clear_clip() {
  __tc_mono_clip_w = 0;
  __tc_mono_clip_h = 0;
}

// ── Frame push ─────────────────────────────────────────────────────────────
// Full-frame redraw, ALWAYS (Stage 2): the 1KB frame is one display_write.
// The ssd1306-class drivers require pitch == width and (y, height) multiples
// of 8 — the full frame satisfies both by construction. The dirty-rect args
// are accepted and ignored: at ~25ms a frame, partial compositing has nothing
// to optimize.
static inline void display_partial_refresh(int16_t x, int16_t y, int16_t rw, int16_t rh) {
  (void)x; (void)y; (void)rw; (void)rh;
  struct display_buffer_descriptor __desc = {};
  __desc.width = ${w}u;
  __desc.height = ${h}u;
  __desc.pitch = ${w}u;
  __desc.buf_size = sizeof(__tc_mono_fb);
  __desc.frame_incomplete = false;
  const uint8_t* src = __tc_mono_fb;
  if (__tc_mono_invert) {
    // Panel insists on MONO10 (1=black): push the complement of the frame.
    for (size_t i = 0; i < sizeof(__tc_mono_fb); i++) {
      __tc_mono_inv[i] = static_cast<uint8_t>(~__tc_mono_fb[i]);
    }
    src = __tc_mono_inv;
  }
  (void)display_write(__tc_zd_dev, 0, 0, &__desc, src);
}

// ── display_init (called from setup) ───────────────────────────────────────

static inline void display_init() {
  printk("TC_DISPLAY: mono full-frame transport (${dtLabel}, ${w}x${h})\\n");
  if (!device_is_ready(__tc_zd_dev)) {
    printk("TC_DISPLAY: device not ready — is the panel driver enabled?\\n");
    return;
  }
  display_get_capabilities(__tc_zd_dev, &__tc_zd_caps);
  // MONO01 (0=black, 1=white) matches our packing. A MONO10 panel gets asked
  // to switch once; if it refuses, frames push bit-inverted (still correct).
  if (__tc_zd_caps.current_pixel_format == PIXEL_FORMAT_MONO10) {
    if (display_set_pixel_format(__tc_zd_dev, PIXEL_FORMAT_MONO01) == 0) {
      display_get_capabilities(__tc_zd_dev, &__tc_zd_caps);
    }
  }
  if (__tc_zd_caps.current_pixel_format == PIXEL_FORMAT_MONO10) {
    __tc_mono_invert = true;
  } else if (__tc_zd_caps.current_pixel_format != PIXEL_FORMAT_MONO01) {
    printk("TC_DISPLAY: unexpected pixel format %u (expected MONO01) — rendering best-effort\\n",
           static_cast<unsigned int>(__tc_zd_caps.current_pixel_format));
  }
  if (__tc_zd_caps.x_resolution != static_cast<uint16_t>(${nativeW})
      || __tc_zd_caps.y_resolution != static_cast<uint16_t>(${nativeH})) {
    printk("TC_DISPLAY: panel reports %ux%u, DT node carries ${nativeW}x${nativeH} — check the display node geometry\\n",
           static_cast<unsigned int>(__tc_zd_caps.x_resolution),
           static_cast<unsigned int>(__tc_zd_caps.y_resolution));
  }
  for (size_t i = 0; i < sizeof(__tc_mono_fb); i++) __tc_mono_fb[i] = 0u;
  (void)display_blanking_off(__tc_zd_dev);
  display_partial_refresh(0, 0, ${w}, ${h});
  printk("TC_DISPLAY: mono init done (1bpp full-frame)\\n");
}

static inline void display_fillScreen(UI_COLOR_T color) {
  const uint8_t fill = color ? 0xFFu : 0x00u;
  for (size_t i = 0; i < sizeof(__tc_mono_fb); i++) __tc_mono_fb[i] = fill;
}
static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }
static inline int16_t display_width() { return ${w}; }
static inline int16_t display_height() { return ${h}; }

// Immediate-push no-ops: all drawing targets the backing store; the frame
// publishes atomically in display_partial_refresh.
static inline void display_startWrite() { }
static inline void display_endWrite() { }
static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t winW, int16_t winH) {
  (void)x; (void)y; (void)winW; (void)winH;
}
static inline void display_writePixels(uint16_t* pixels, uint32_t count) {
  (void)pixels; (void)count;
}
${CANVAS_LIFECYCLE_SECTION}${TARGET_FORWARDERS_SECTION}`;

  return { includes, declaration, functions };
}
