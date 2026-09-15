// ---------------------------------------------------------------------------
// Zephyr UI display adapter — 'zephyr-display' transport.
//
// Emits the same display_ / display_target_ / display_canvas_ surface the UI
// runtime expects (see ui-adapter.ts), but reaches the panel through Zephyr's
// display API: display_write() with a buffer descriptor on the DT display
// device (the overlay's display0 node under the mipi-dbi-spi bridge), with
// display_get_capabilities() consulted for the panel's pixel format. An
// in-tree panel driver (e.g. ilitek,ili9341 with CONFIG_ILI9341) owns the
// init sequence, rotation, and wire format — this adapter carries no panel
// registers at all.
//
// Why this transport exists alongside 'direct-spi': the direct path is the
// escape hatch for panels the in-tree drivers cannot init (clone ST7796S —
// the generic mipi-dbi-spi bridge deasserts CS between the command byte and
// its parameters, scrambling those panels). Standard ILI9341-class SPI
// modules tolerate per-transaction CS (upstream Zephyr boards wire them this
// way), so they can ride the in-tree driver and drop the per-controller
// emitted init tables. Choose per profile via ZephyrDisplayProfile.transport;
// flip a profile here only after hardware verification on a rig.
//
// display_write() is a dirty-rect API — the descriptor's x/y/width/height
// become the controller address window — so the UI engine's
// setAddrWindow+writePixels pairs map onto it directly. Batching notes:
// display_write calls are atomic per call (the mipi-dbi layer serializes on a
// per-device mutex), so startWrite/endWrite are no-ops; solid fills tile a
// reused block buffer into multi-row display_write chunks, the same
// fewer/larger-transfers lesson the direct path learned (~40 instead of ~320
// writes on a full 480x320 clear).
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
//
// AGENTS.md rendering guardrails honored: scratch buffers are static and
// reused (no per-frame heap allocation); fills are block-buffered.
// ---------------------------------------------------------------------------

import type { DisplayAdapterCode } from "@typecad/cuttlefish/api/shared";
import type { ZephyrDisplayProfile } from "./profiles.js";
import { dbiHostFor, displayFactsLine } from "./profiles.js";
import { localHoldCsDbiHost } from "./mipi-dbi-host.js";
import { CANVAS_LIFECYCLE_SECTION, TARGET_FORWARDERS_SECTION, profileMarkerLine } from "./ui-adapter-shared.js";

/**
 * Build the display-API UI adapter for a profile. The profile's dtLabel must
 * name a display node an in-tree driver binds (the overlay generates it; the
 * Kconfig layer enables the driver symbol for the profile's controller).
 * Profiles whose dbiHost is 'local-hold-cs' additionally emit an app-local
 * CS-holding mipi-dbi host the panel driver sits on (see mipi-dbi-host.ts).
 */
export function zephyrDisplayApiAdapter(profile: ZephyrDisplayProfile): DisplayAdapterCode {
  const w = profile.width;
  const h = profile.height;
  const maxDim = Math.max(w, h);
  const dtLabel = profile.dtLabel;
  const backlightAlias = profile.backlight;
  const rbSwap = profile.channelSwapRb === true;
  const nativeW = profile.nativeWidth ?? w;
  const nativeH = profile.nativeHeight ?? h;
  const host = dbiHostFor(profile) === 'local-hold-cs' ? localHoldCsDbiHost(profile) : undefined;

  const includes = [
    `// --- Zephyr UI display adapter (${profile.driver}, zephyr-display transport) ---`,
    profileMarkerLine(profile.driver),
    displayFactsLine(profile),
    `// Native CuttlefishGFX path: do NOT #define CuttlefishCanvas16 so the`,
    `// runtime header emits the in-tree CuttlefishGFX/CuttlefishCanvas16 class.`,
    `#define CuttlefishDisplayTarget CuttlefishGFX`,
    `#include <zephyr/kernel.h>`,
    `#include <zephyr/drivers/display.h>`,
    `#include <zephyr/drivers/gpio.h>`,
    ...(host ? host.includes : []),
  ].join("\n");

  const declaration = [
    `// CUTTLEFISH_DISPLAY_BEGIN`,
    `// The panel device: the overlay's display0 node, bound by an in-tree panel`,
    `// driver (CONFIG enabled for the profile's controller). Compile-time`,
    `// constant — DEVICE_DT_GET requires the driver to exist at build time,`,
    `// which the Kconfig layer guarantees for this transport.`,
    `static const struct device* __tc_zd_dev = DEVICE_DT_GET(DT_NODELABEL(${dtLabel}));`,
    `// Panel facts from display_get_capabilities, read once in display_init.`,
    `static struct display_capabilities __tc_zd_caps;`,
    `// Zephyr pixel formats carry byte-order semantics: PIXEL_FORMAT_RGB_565`,
    `// is little-endian (Red in byte 1, Blue in byte 0) — exactly the memory`,
    `// layout of the UI's uint16_t rgb565 words on little-endian targets — and`,
    `// PIXEL_FORMAT_RGB_565X is the byte-swapped variant. Clone panels with`,
    `// crossed 16-bit channel routing (verified ST7796S quirk) additionally`,
    `// need an R/B channel swap. __tc_zd_fix_pixel applies the panel's fixup`,
    `// chain before pixels reach display_write.`,
    `static bool __tc_zd_swap = false;`,
    `static const bool __tc_zd_rb = ${rbSwap};`,
    `// Multi-row block buffer for solid fills AND the byte-swap scratch for`,
    `// 565X pixel streams (8 rows of maxDim px, rgb565 — fillRect and`,
    `// writePixels never interleave mid-call, so one buffer serves both).`,
    `// fillRect tiles it once with the color, then delivers the rect in a`,
    `// few large display_write calls instead of one per row — the same`,
    `// per-call-overhead lesson as the direct transport. Reused, not per-frame`,
    `// (AGENTS.md: no per-frame heap allocation).`,
    `#define __TC_FILL_ROWS 8`,
    `static uint16_t __tc_zd_block[${maxDim} * __TC_FILL_ROWS];`,
    `// Stashed address window from the last setAddrWindow call. The runtime`,
    `// calls setAddrWindow + writePixels as a matched pair, so we stash the rect`,
    `// here and consume it in writePixels.`,
    `static int16_t __tc_aw_x = 0;`,
    `static int16_t __tc_aw_y = 0;`,
    `static int16_t __tc_aw_w = ${w};`,
    `static int16_t __tc_aw_h = ${h};`,
    `// CUTTLEFISH_DISPLAY_END`,
  ].join("\n");

  // Backlight: same DT-alias drive as the direct transport (the overlay emits
  // the gpio-leds node + alias only when a backlight GPIO is configured).
  const blInit = backlightAlias
    ? `#if DT_HAS_ALIAS(${backlightAlias})\n    const struct gpio_dt_spec __bl = GPIO_DT_SPEC_GET(DT_ALIAS(${backlightAlias}), gpios);\n    if (device_is_ready(__bl.port)) { gpio_pin_configure_dt(&__bl, GPIO_OUTPUT_ACTIVE); }\n#endif`
    : '';

  const functions = `${host ? host.functions : ''}
// ── display-API transport ───────────────────────────────────────────────
// Every panel write is one display_write() carrying its own address window
// (the descriptor's x/y/width/height) — no CASET/RASET bookkeeping here. The
// in-tree driver beneath the device owns init, rotation, and the wire format.

static void __tc_zd_write_rect(int16_t x, int16_t y, int16_t rw, int16_t rows,
                               const uint16_t* px) {
  if (rw <= 0 || rows <= 0) return;
  struct display_buffer_descriptor __desc = {};
  __desc.width = static_cast<uint16_t>(rw);
  __desc.height = static_cast<uint16_t>(rows);
  __desc.pitch = static_cast<uint16_t>(rw);
  __desc.buf_size = static_cast<size_t>(rw) * static_cast<size_t>(rows) * 2U;
  (void)display_write(__tc_zd_dev, static_cast<uint16_t>(x), static_cast<uint16_t>(y),
                      &__desc, px);
}

// The panel's pack-time pixel fixup chain: R/B channel swap (clone panels
// whose 16-bit routing is crossed — lossless, verified equivalent to the
// direct transport's 18-bit mode), then byte swap when the panel reports
// RGB565X. No-op for well-behaved panels on little-endian targets.
static inline uint16_t __tc_zd_fix_pixel(uint16_t c) {
  if (__tc_zd_rb) {
    c = static_cast<uint16_t>(((c & 0x1Fu) << 11) | ((c >> 11) & 0x1Fu) | (c & 0x07E0u));
  }
  if (__tc_zd_swap) {
    c = static_cast<uint16_t>((c >> 8) | ((c & 0xFFu) << 8));
  }
  return c;
}

// Fix a pixel run into the block scratch (passthrough when the panel needs
// no fixup — the common case). count ≤ maxDim*__TC_FILL_ROWS — the largest
// call is a full writePixels batch.
static const uint16_t* __tc_zd_fixup_run(const uint16_t* px, uint32_t count) {
  if (!__tc_zd_rb && !__tc_zd_swap) return px;
  for (uint32_t i = 0; i < count; i++) {
    __tc_zd_block[i] = __tc_zd_fix_pixel(px[i]);
  }
  return __tc_zd_block;
}

// ── Panel-ops consumed by CuttlefishGFX ─────────────────────────────────
// startWrite/endWrite are no-ops: display_write is atomic per call (the
// mipi-dbi layer serializes on a per-device mutex), so there is no CS batch
// to bracket. The depth-counter concept from the direct transport does not
// apply.
static void __tc_op_startWrite(void* /*ctx*/) { }
static void __tc_op_endWrite(void* /*ctx*/) { }

// Stash the target rect. The runtime always follows this with writePixels
// delivering (w*h) pixels for this rect, OR fillRect/writePixel which ignore
// the stash.
static void __tc_op_setAddrWindow(void* /*ctx*/, int16_t x, int16_t y, int16_t winW, int16_t winH) {
  __tc_aw_x = x; __tc_aw_y = y; __tc_aw_w = winW; __tc_aw_h = winH;
}

// Push the stashed rect's worth of rgb565 pixels, delivered in multi-row
// display_write chunks (≤ __TC_FILL_ROWS rows per call) so a canvas push
// stays a handful of calls instead of one per row. A trailing partial row
// (count not a multiple of the window width) goes out as its own 1-row rect.
static void __tc_op_writePixels(void* /*ctx*/, const uint16_t* px, uint32_t n) {
  if (n == 0U || __tc_aw_w <= 0) return;
  const uint32_t __full = static_cast<uint32_t>(__tc_aw_w);
  uint32_t __rows = n / __full;
  int16_t __row = 0;
  const uint16_t* __p = px;
  while (__rows > 0U) {
    uint32_t __batch = (__rows > static_cast<uint32_t>(__TC_FILL_ROWS))
        ? static_cast<uint32_t>(__TC_FILL_ROWS) : __rows;
    __tc_zd_write_rect(__tc_aw_x, static_cast<int16_t>(__tc_aw_y + __row), __tc_aw_w,
                       static_cast<int16_t>(__batch),
                       __tc_zd_fixup_run(__p, __full * __batch));
    __p += __full * __batch;
    __rows -= __batch;
    __row = static_cast<int16_t>(__row + __batch);
  }
  const uint32_t __rem = n % __full;
  if (__rem > 0U) {
    __tc_zd_write_rect(__tc_aw_x, static_cast<int16_t>(__tc_aw_y + __row),
                       static_cast<int16_t>(__rem), 1, __tc_zd_fixup_run(__p, __rem));
  }
}

// Single pixel: one 1x1 write.
static void __tc_op_writePixel(void* /*ctx*/, int16_t x, int16_t y, uint16_t c) {
  uint16_t __buf[1];
  __buf[0] = __tc_zd_fix_pixel(c);
  __tc_zd_write_rect(x, y, 1, 1, __buf);
}

// Fill a rect with a solid color: tile the block buffer with the color, then
// deliver the rect in multi-row display_write chunks.
static void __tc_op_fillRect(void* /*ctx*/, int16_t x, int16_t y, int16_t rw, int16_t rh, uint16_t c) {
  if (rw <= 0 || rh <= 0) return;
  const uint16_t __word = __tc_zd_fix_pixel(c);
  for (int16_t r = 0; r < __TC_FILL_ROWS; r++) {
    for (int16_t i = 0; i < rw; i++) {
      __tc_zd_block[static_cast<uint32_t>(r) * static_cast<uint32_t>(rw) + static_cast<uint32_t>(i)] = __word;
    }
  }
  int16_t remaining = rh;
  int16_t yy = y;
  while (remaining > 0) {
    int16_t chunk = (remaining > __TC_FILL_ROWS) ? __TC_FILL_ROWS : remaining;
    __tc_zd_write_rect(x, yy, rw, chunk, __tc_zd_block);
    remaining -= chunk;
    yy = static_cast<int16_t>(yy + chunk);
  }
}

// Width/height are the profile's compile-time effective dimensions — the
// CuttlefishGFX global below is constructed before main() runs, so it cannot
// wait for display_get_capabilities. display_init cross-checks the caps
// against these and reports a mismatch (a wiring/binding problem worth
// surfacing, not silently rendering at the wrong resolution).
static int16_t __tc_op_width(void* /*ctx*/) { return ${w}; }
static int16_t __tc_op_height(void* /*ctx*/) { return ${h}; }

// flush is nullptr — immediate-mode panel (TFT); the dirty loop's writes are
// already on the glass.
struct CuttlefishPanelOps;
extern const CuttlefishPanelOps __tc_display_ops;

const CuttlefishPanelOps __tc_display_ops = {
  __tc_op_startWrite,
  __tc_op_endWrite,
  __tc_op_setAddrWindow,
  __tc_op_writePixels,
  __tc_op_writePixel,
  __tc_op_fillRect,
  __tc_op_width,
  __tc_op_height,
  nullptr,  // flush — immediate-mode panel
};

// The live display target: a CuttlefishGFX driven by the panel-ops vtable.
CuttlefishGFX __tc_display(&__tc_display_ops, nullptr);

// ── display_init (called from setup) ────────────────────────────────────

static inline void display_init() {
  printk("TC_DISPLAY: display-API transport (${dtLabel})\\n");
${blInit}
  if (!device_is_ready(__tc_zd_dev)) {
    printk("TC_DISPLAY: device not ready — is the panel driver enabled?\\n");
    return;
  }
  display_get_capabilities(__tc_zd_dev, &__tc_zd_caps);
  __tc_zd_swap = (__tc_zd_caps.current_pixel_format == PIXEL_FORMAT_RGB_565X);
  if (__tc_zd_caps.current_pixel_format != PIXEL_FORMAT_RGB_565
      && __tc_zd_caps.current_pixel_format != PIXEL_FORMAT_RGB_565X) {
    printk("TC_DISPLAY: unexpected pixel format %u (expected RGB565) — rendering best-effort\\n",
           static_cast<unsigned int>(__tc_zd_caps.current_pixel_format));
  }
  if (__tc_zd_caps.x_resolution != static_cast<uint16_t>(${nativeW})
      || __tc_zd_caps.y_resolution != static_cast<uint16_t>(${nativeH})) {
    printk("TC_DISPLAY: panel reports %ux%u, DT node carries ${nativeW}x${nativeH} — check the display node geometry\\n",
           static_cast<unsigned int>(__tc_zd_caps.x_resolution),
           static_cast<unsigned int>(__tc_zd_caps.y_resolution));
  }
  (void)display_blanking_off(__tc_zd_dev);
  __tc_op_fillRect(nullptr, 0, 0, ${w}, ${h}, 0x0000);
  printk("TC_DISPLAY: display-API init done (RGB565, black fill)\\n");
}

static inline void display_fillScreen(UI_COLOR_T color) {
  __tc_op_fillRect(nullptr, 0, 0, ${w}, ${h}, static_cast<uint16_t>(color));
}
static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }
static inline int16_t display_width() { return ${w}; }
static inline int16_t display_height() { return ${h}; }

static inline void display_startWrite() { }
static inline void display_endWrite() { }
static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t winW, int16_t winH) {
  __tc_op_setAddrWindow(nullptr, x, y, winW, winH);
}
static inline void display_writePixels(uint16_t* pixels, uint32_t count) {
  __tc_op_writePixels(nullptr, pixels, count);
}
${CANVAS_LIFECYCLE_SECTION}${TARGET_FORWARDERS_SECTION}`;

  return { includes, declaration, functions };
}
