// ---------------------------------------------------------------------------
// Zephyr gray UI display adapter — Stage 3's gray8 lowering target.
//
// The panel accepts PIXEL_FORMAT_L_8 (8-bit luminance; the solomon,ssd1327
// driver nibble-reduces to its 16 display levels). The adapter keeps a
// row-major L_8 backing store (one byte per pixel — 4KB at 128x64) and
// pushes the whole frame with ONE display_write, mirroring the mono
// adapter's full-frame semantic at gray fidelity. UI_COLOR_T is uint8_t and
// node values are luminance bytes, so every draw is a store.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
//
// AGENTS.md rendering guardrails honored: one static framebuffer, no
// per-frame allocation, one atomic push per frame.
// ---------------------------------------------------------------------------

import type { DisplayAdapterCode } from "@typecad/cuttlefish/api/shared";
import type { ZephyrDisplayProfile } from "./profiles.js";
import { displayFactsLine } from "./profiles.js";
import { CANVAS_LIFECYCLE_SECTION, TARGET_FORWARDERS_SECTION, profileMarkerLine } from "./ui-adapter-shared.js";

/**
 * Build the gray8 UI adapter for a profile. The profile's dtLabel must name
 * a display node bound by an L_8-capable driver (solomon,ssd1327-class —
 * the overlay generates the node; the driver self-builds from it).
 */
export function zephyrGrayDisplayAdapter(profile: ZephyrDisplayProfile): DisplayAdapterCode {
  const w = profile.width;
  const h = profile.height;
  const dtLabel = profile.dtLabel;

  const includes = [
    `// --- Zephyr gray UI display adapter (${profile.driver}, full-frame L_8) ---`,
    profileMarkerLine(profile.driver),
    displayFactsLine(profile),
    `// Gray target: the adapter's ZephyrGrayTarget (a CuttlefishGFX writing an`,
    `// L_8 backing store — one luminance byte per pixel; the driver reduces`,
    `// to the panel's 16 display levels).`,
    `#define CuttlefishDisplayTarget ZephyrGrayTarget`,
    `#include <zephyr/kernel.h>`,
    `#include <zephyr/drivers/display.h>`,
    `#include <zephyr/drivers/gpio.h>`,
  ].join("\n");

  const declaration = [
    `// CUTTLEFISH_DISPLAY_BEGIN`,
    `// The panel device: the overlay's display0 node, bound by an L_8-capable`,
    `// driver. Compile-time constant — DEVICE_DT_GET requires the driver to`,
    `// exist at build time, which the Kconfig layer guarantees.`,
    `static const struct device* __tc_zd_dev = DEVICE_DT_GET(DT_NODELABEL(${dtLabel}));`,
    `static struct display_capabilities __tc_zd_caps;`,
    `// Full-frame backing store, row-major L_8: one luminance byte per pixel`,
    `// (${w}*${h} = ${w * h} bytes).`,
    `static uint8_t __tc_gray_fb[${w} * ${h}];`,
    `// Rig diagnostics: frames pushed since boot (see display_partial_refresh).`,
    `static uint32_t __tc_gray_frames = 0;`,
    `// Gray target clip (w <= 0 ⇒ no clip). Enforced in ZephyrGrayTarget's`,
    `// drawPixel/fillRect so EVERY pixel — including ones emitted inside`,
    `// CuttlefishGFX geometry algorithms — respects it.`,
    `static int16_t __tc_mono_clip_x = 0;`,
    `static int16_t __tc_mono_clip_y = 0;`,
    `static int16_t __tc_mono_clip_w = 0;`,
    `static int16_t __tc_mono_clip_h = 0;`,
    `// CUTTLEFISH_DISPLAY_END`,
  ].join("\n");

  const functions = `
// ── Gray target ───────────────────────────────────────────────────────────
// A CuttlefishGFX whose pixels are backing-store bytes. All geometry/text
// primitives the runtime draws funnel through these two overrides.
class ZephyrGrayTarget final : public CuttlefishGFX {
 public:
  ZephyrGrayTarget() : CuttlefishGFX(nullptr, nullptr) {}
  int16_t width() const { return ${w}; }
  int16_t height() const { return ${h}; }
  void drawPixel(int16_t x, int16_t y, uint16_t color) {
    if (x < 0 || y < 0 || x >= ${w} || y >= ${h}) return;
    if (__tc_mono_clip_w > 0 &&
        (x < __tc_mono_clip_x || y < __tc_mono_clip_y ||
         x >= __tc_mono_clip_x + __tc_mono_clip_w ||
         y >= __tc_mono_clip_y + __tc_mono_clip_h)) return;
    __tc_gray_fb[static_cast<uint32_t>(y) * ${w}u + static_cast<uint32_t>(x)] =
      static_cast<uint8_t>(color);
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
static ZephyrGrayTarget __tc_display;

// ── Gray clip (the runtime's full-frame scroll clipping) ──────────────────
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
// Full-frame redraw, ALWAYS (Stage 3): the ${w * h}-byte L_8 frame is one
// display_write. The dirty-rect args are accepted and ignored — at
// ~50-100ms a frame (I2C fast mode), incremental compositing has nothing
// to optimize.
static inline void display_partial_refresh(int16_t x, int16_t y, int16_t rw, int16_t rh) {
  (void)x; (void)y; (void)rw; (void)rh;
  struct display_buffer_descriptor __desc = {};
  __desc.width = ${w}u;
  __desc.height = ${h}u;
  __desc.pitch = ${w}u;
  __desc.buf_size = sizeof(__tc_gray_fb);
  __desc.frame_incomplete = false;
  int __ret = display_write(__tc_zd_dev, 0, 0, &__desc, __tc_gray_fb);
  __tc_gray_frames++;
  if (__ret != 0) {
    printk("TC_DISPLAY: display_write failed: %d\\n", __ret);
  } else if ((__tc_gray_frames & 0x0Fu) == 1u) {
    printk("TC_DISPLAY: gray frame #%u pushed\\n", static_cast<unsigned int>(__tc_gray_frames));
  }
}

// ── display_init (called from setup) ───────────────────────────────────────

static inline void display_init() {
  printk("TC_DISPLAY: gray full-frame transport (${dtLabel}, ${w}x${h}, L_8)\\n");
  if (!device_is_ready(__tc_zd_dev)) {
    printk("TC_DISPLAY: device not ready — is the panel driver enabled?\\n");
    return;
  }
  display_get_capabilities(__tc_zd_dev, &__tc_zd_caps);
  printk("TC_DISPLAY: panel reports %ux%u fmt=%u screen_info=%u\\n",
         static_cast<unsigned int>(__tc_zd_caps.x_resolution),
         static_cast<unsigned int>(__tc_zd_caps.y_resolution),
         static_cast<unsigned int>(__tc_zd_caps.current_pixel_format),
         static_cast<unsigned int>(__tc_zd_caps.screen_info));
  // L_8 is the driver's native format (it nibble-reduces to the panel's 16
  // levels); request it in case the driver boots in something else.
  if (__tc_zd_caps.current_pixel_format != PIXEL_FORMAT_L_8) {
    if (display_set_pixel_format(__tc_zd_dev, PIXEL_FORMAT_L_8) != 0) {
      printk("TC_DISPLAY: panel refused L_8 — check the driver\\n");
    }
  }
  for (size_t i = 0; i < sizeof(__tc_gray_fb); i++) __tc_gray_fb[i] = 0u;
  (void)display_blanking_off(__tc_zd_dev);
  display_partial_refresh(0, 0, ${w}, ${h});
  printk("TC_DISPLAY: gray init done (L_8 full-frame)\\n");
}

static inline void display_fillScreen(UI_COLOR_T color) {
  for (size_t i = 0; i < sizeof(__tc_gray_fb); i++) __tc_gray_fb[i] = static_cast<uint8_t>(color);
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
static inline void display_writePixels(const UI_COLOR_T* pixels, uint32_t count) {
  (void)pixels; (void)count;
}
${CANVAS_LIFECYCLE_SECTION}${TARGET_FORWARDERS_SECTION}`;

  return { includes, declaration, functions };
}
