// ---------------------------------------------------------------------------
// Zephyr UI display adapter for the TypeCAD UI rendering pipeline.
//
// Bridges the in-tree CuttlefishGFX/CuttlefishCanvas16 class (emitted by the
// runtime header's cuttlefish-gfx slice) to an SPI TFT panel. The panel is
// driven DIRECTLY over the SPI controller with GPIO chip-select, DC and reset
// pins — NOT through Zephyr's mipi-dbi-spi bridge: that bridge issues separate
// SPI transactions for the command byte and its parameters (CS deasserts
// between them), which scrambles this panel family's command decoder and
// leaves it white. Verified on hardware (ST7796S): the direct protocol (CS
// held low across the command+data burst, DC toggled mid-burst — the Adafruit
// ST77xx protocol) initializes the panel and renders pixels correctly.
//
// Per-controller support lives in two places, keyed off the display profile's
// `controller` field (see profiles.ts):
//   - the init command table (byte-for-byte Adafruit sequences)
//   - the pixel wire format: ST7796S is driven in 18-bit (666) mode (its
//     16-bit channel routing is crossed on the verified clone panel), ILI9341
//     in native 16-bit (565) big-endian. The ST7796S path below is frozen
//     exactly as hardware-verified; the ILI9341 path mirrors it with the
//     Adafruit ILI9341 init + 565 packing and is not yet hardware-tuned.
//
// This is the Zephyr analog of the Adafruit adapters in framework-arduino,
// using the in-tree native GFX class (no #define CuttlefishCanvas16) driven
// through a CuttlefishPanelOps function-pointer vtable.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
//
// AGENTS.md rendering guardrails: the line buffer is one row (reused, not
// per-frame allocated); fillRect writes row-by-row. Pixel bursts use 16-bit
// SPI words (MSB-first on the wire = RGB565 big-endian, no byte swap).
// ---------------------------------------------------------------------------

import type { DisplayAdapterCode, DisplayAdapterGenerator } from "@typecad/cuttlefish/api/shared";
import { ZEPHYR_DISPLAY_PROFILES, panelControllerFor } from "./profiles.js";
import type { ZephyrDisplayProfile } from "./profiles.js";

/**
 * Build the Zephyr UI display adapter for a profile. Emits the full
 * display_ / display_target_ / display_canvas_ surface the UI runtime expects,
 * driving the panel directly via SPI (CS held across command+data).
 */
export interface ZephyrDisplayReadbackOptions {
  /** Enable the controller GET_SCANLINE dirty-rectangle experiment. */
  scanlineSync?: boolean;
  /** MISO/SDO GPIO; readback is disabled when it is not explicitly wired. */
  miso?: number;
  /** Tearing-effect GPIO (panel TE output). When set, panel updates wait for
   *  the TE frame pulse instead of GET_SCANLINE readback — no MISO required.
   *  The overlay adds te-gpios to the display DT node from this. */
  tearingEffectPin?: number;
}

export function zephyrUiDisplayAdapter(
  profile: ZephyrDisplayProfile,
  readback: ZephyrDisplayReadbackOptions = {},
): DisplayAdapterCode {
  const w = profile.width;
  const h = profile.height;
  const maxDim = Math.max(w, h);
  const dtLabel = profile.dtLabel;
  const backlightAlias = profile.backlight;
  const bus = profile.busLabel ?? 'spi2';
  const bridge = profile.bridgeLabel ?? 'mipi_dbi';
  const controller = panelControllerFor(profile);
  const isIli9341 = controller === 'ili9341';
  // Bytes per pixel on the wire: 3 (18-bit 666) for ST7796S, 2 (16-bit 565)
  // for ILI9341. The row/block scratch buffers and pack loops key off this.
  const bpp = isIli9341 ? 2 : 3;
  const rowBuf = `__tc_display_row${bpp}`;
  const blockBuf = `__tc_display_block${bpp}`;
  const packFn = isIli9341 ? '__tc_pnl_pack565' : '__tc_pnl_pack666';
  const pixelsFn = isIli9341 ? '__tc_pnl_pixels565' : '__tc_pnl_pixels666';
  const wireTag = isIli9341 ? '16-bit 565' : '18-bit';
  // Never infer readback from a board's default pinmux. SDO/MISO may be left
  // floating or shared with another device, and ST7796S modules are known to
  // react badly to GSCAN reads. Both an explicit opt-in and an explicit MISO
  // pin are required before emitting an active synchronization path.
  const scanlineSync = readback.scanlineSync === true && readback.miso !== undefined;
  // TE (hardware tearing-effect) sync: strictly opt-in via a configured GPIO.
  // Preferred over GET_SCANLINE when wired — no readback traffic, no MISO.
  const tePin = typeof readback.tearingEffectPin === 'number' ? readback.tearingEffectPin : undefined;

  const includes = [
    `// --- Zephyr UI display adapter (${profile.driver}) ---`,
    `// Native CuttlefishGFX path: do NOT #define CuttlefishCanvas16 so the`,
    `// runtime header emits the in-tree CuttlefishGFX/CuttlefishCanvas16 class.`,
    `#define CuttlefishDisplayTarget CuttlefishGFX`,
    `#include <zephyr/kernel.h>`,
    `#include <zephyr/drivers/display.h>`,
    `#include <zephyr/drivers/spi.h>`,
    `#include <zephyr/drivers/gpio.h>`,
  ].join("\n");

  // Per-controller scratch-buffer declarations. The ST7796S text is frozen as
  // hardware-verified; the ILI9341 variant documents its 565 wire format.
  const bufferDecls = isIli9341
    ? [
        `// One-row scratch buffer in 16-bit (565) wire format: maxDim px x 2 bytes.`,
        `// Reused across fillRect/draw calls — never per-frame (AGENTS.md: no`,
        `// per-frame heap allocation). The ILI9341 is driven in its native`,
        `// 16-bit COLMOD (0x55): RGB565 pixels go out big-endian (MSB-first SPI),`,
        `// the Adafruit ILI9341 convention, with no repacking needed.`,
        `static uint8_t ${rowBuf}[${maxDim} * 2];`,
        `// Multi-row block buffer for solid fills (8 rows of maxDim px in 565).`,
        `// fillRect fills this once with the color, then sends the whole rect in a`,
        `// few large spi_write chunks instead of one spi_write per row — a full`,
        `// 480x320 clear went from ~320 syscalls (~110ms) to ~40 (~15ms). Reused,`,
        `// not per-frame (AGENTS.md).`,
        `#define __TC_FILL_ROWS 8`,
        `static uint8_t ${blockBuf}[${maxDim} * 2 * __TC_FILL_ROWS];`,
      ]
    : [
        `// One-row scratch buffer in 18-bit (666) wire format: maxDim px x 3 bytes.`,
        `// Reused across fillRect/draw calls — never per-frame (AGENTS.md: no`,
        `// per-frame heap allocation). The panel is driven in 18-bit mode (COLMOD`,
        `// 0x66): its 16-bit (565) channel routing is crossed (G/B swap, verified`,
        `// with calibration bands), while 18-bit mode routes every channel`,
        `// correctly with plain (R,G,B) byte order.`,
        `static uint8_t ${rowBuf}[${maxDim} * 3];`,
        `// Multi-row block buffer for solid fills (8 rows of maxDim px in 18-bit).`,
        `// fillRect fills this once with the color, then sends the whole rect in a`,
        `// few large spi_write chunks instead of one spi_write per row — a full`,
        `// 480x320 clear went from ~320 syscalls (~110ms) to ~40 (~15ms). Reused,`,
        `// not per-frame (AGENTS.md).`,
        `#define __TC_FILL_ROWS 8`,
        `static uint8_t ${blockBuf}[${maxDim} * 3 * __TC_FILL_ROWS];`,
      ];

  const declaration = [
    `// CUTTLEFISH_DISPLAY_BEGIN`,
    // The display0 DT node carries frequency/dimensions for DT_PROP reads, but
    // the panel is driven directly via spi_write — no Zephyr display device is
    // needed. Using a constant 1 avoids the ST7796S driver binding (which
    // allocates a tearing-effect GPIO interrupt that conflicts with the SPI/I2C
    // interrupts — the VECDESC_FL_SHARED assertion crash on the 3rd frame).
    `#define __tc_display_dev 1`,
    ...bufferDecls,
    `// startWrite/endWrite batching depth. When > 0 the panel CS is held asserted`,
    `// (low) across multiple primitives — DC still toggles mid-burst, but CS does`,
    `// not, matching the Adafruit ST77xx protocol and avoiding one full CS-toggle`,
    `// SPI transaction per primitive. The runtime brackets whole canvas pushes`,
    `// and per-node repaints in display_startWrite/endWrite pairs.`,
    `static uint8_t __tc_pnl_write_depth = 0;`,
    `// Scanline readback is deliberately opt-in. A verified SDO/MISO wire and`,
    `// controller-specific validation are required; otherwise the display stays`,
    `// on the existing retained/composited path with no extra SPI reads.`,
    `static const bool __tc_pnl_scanline_sync = ${scanlineSync ? 'true' : 'false'};`,
    `// Tearing-effect (TE) hardware sync: the panel pulses its TE line once`,
    `// per frame. When te-gpios is present on the display DT node, panel`,
    `// updates arm on the TE edge — tear-free writes with no MISO readback.`,
    `#if DT_NODE_HAS_PROP(DT_NODELABEL(${dtLabel}), te_gpios)`,
    `#define __TC_TE_SYNC 1`,
    `static const struct gpio_dt_spec __tc_te =`,
    `    GPIO_DT_SPEC_GET(DT_NODELABEL(${dtLabel}), te_gpios);`,
    `static struct gpio_callback __tc_te_cb;`,
    `static volatile uint32_t __tc_te_count = 0;`,
    `static void __tc_te_isr(const struct device* port, struct gpio_callback* cb, uint32_t pins) {`,
    `    (void)port; (void)cb; (void)pins;`,
    `    __tc_te_count++;`,
    `}`,
    `#else`,
    `#define __TC_TE_SYNC 0`,
    `#endif`,
    `// Stashed address window from the last setAddrWindow call. The runtime`,
    `// calls setAddrWindow + writePixels as a matched pair, so we stash the rect`,
    `// here and consume it in writePixels.`,
    `static int16_t __tc_aw_x = 0;`,
    `static int16_t __tc_aw_y = 0;`,
    `static int16_t __tc_aw_w = ${w};`,
    `static int16_t __tc_aw_h = ${h};`,
    `// CUTTLEFISH_DISPLAY_END`,
  ].join("\n");

  // Backlight: drive it as a raw GPIO output. The DT alias points at a
  // gpio-leds node whose 'gpios' property is a phandle to the GPIO controller
  // + pin. GPIO_DT_SPEC_GET resolves that phandle into a gpio_dt_spec. The
  // overlay only emits this alias when a backlight GPIO is configured, so guard
  // with DT_HAS_ALIAS (the safe primitive for an alias that may be absent —
  // DT_NODE_HAS_STATUS(DT_ALIAS(...)) is version-dependent when the alias is
  // missing and can fail the build).
  // TE pin: input + rising-edge interrupt (the ST7796 TE pulse), then tell
  // the controller to drive the line (TEON 0x35, mode 1 = vertical sync only).
  const teInit = tePin !== undefined ? `#if __TC_TE_SYNC
    if (device_is_ready(__tc_te.port)) {
      gpio_pin_configure_dt(&__tc_te, GPIO_INPUT);
      gpio_init_callback(&__tc_te_cb, __tc_te_isr, BIT(__tc_te.pin));
      (void)gpio_add_callback(__tc_te.port, &__tc_te_cb);
      (void)gpio_pin_interrupt_configure_dt(&__tc_te, GPIO_INT_EDGE_RISING);
      __tc_pnl_cmd1(0x35, 0x01); // TEON: TE output = vsync pulse
    }
#endif` : '';

  const blInit = backlightAlias
    ? `#if DT_HAS_ALIAS(${backlightAlias})\n    const struct gpio_dt_spec __bl = GPIO_DT_SPEC_GET(DT_ALIAS(${backlightAlias}), gpios);\n    if (device_is_ready(__bl.port)) { gpio_pin_configure_dt(&__bl, GPIO_OUTPUT_ACTIVE); }\n#endif`
    : '';

  // Per-controller pixel pack/stream helpers. Both share the row-chunked
  // transport; only the per-pixel wire encoding differs.
  const pixelHelpers = isIli9341
    ? `
// Pack count rgb565 pixels into the row2 scratch buffer as big-endian 16-bit
// wire bytes (c>>8, c&0xFF) — the ILI9341's native 565 format under COLMOD
// 0x55. The caller then streams the buffer with the 8-bit config (one row at
// a time; the buffer holds maxDim pixels).
static void ${packFn}(const uint16_t* px, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) {
    uint16_t c = px[i];
    ${rowBuf}[i * 2] = static_cast<uint8_t>(c >> 8);
    ${rowBuf}[i * 2 + 1] = static_cast<uint8_t>(c);
  }
}

// Stream count rgb565 pixels to the panel (chunked through the row2 scratch).
// Caller holds the RAMWR burst.
static void ${pixelsFn}(const uint16_t* px, uint32_t count) {
  while (count > 0) {
    uint32_t __chunk = (count > ${maxDim}) ? ${maxDim} : count;
    ${packFn}(px, __chunk);
    struct spi_buf __bd = { ${rowBuf}, static_cast<size_t>(__chunk) * 2U };
    struct spi_buf_set __sd = { &__bd, 1 };
    (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sd);
    px += __chunk;
    count -= __chunk;
  }
}
`
    : `
// Pack count rgb565 pixels into the row3 scratch buffer as 18-bit (666) wire
// format: (r<<3, g<<2, b<<3) — R,G,B byte order, verified correct on this
// panel in 18-bit mode. The caller then streams the buffer with the 8-bit
// config (one row at a time; the buffer holds maxDim pixels).
static void ${packFn}(const uint16_t* px, uint32_t count) {
  for (uint32_t i = 0; i < count; i++) {
    uint16_t c = px[i];
    ${rowBuf}[i * 3] = static_cast<uint8_t>((c >> 8) & 0xF8u);
    ${rowBuf}[i * 3 + 1] = static_cast<uint8_t>((c >> 3) & 0xFCu);
    ${rowBuf}[i * 3 + 2] = static_cast<uint8_t>((c << 3) & 0xF8u);
  }
}

// Stream count rgb565 pixels to the panel (converted to 18-bit, chunked
// through the row3 scratch). Caller holds the RAMWR burst.
static void ${pixelsFn}(const uint16_t* px, uint32_t count) {
  while (count > 0) {
    uint32_t __chunk = (count > ${maxDim}) ? ${maxDim} : count;
    ${packFn}(px, __chunk);
    struct spi_buf __bd = { ${rowBuf}, static_cast<size_t>(__chunk) * 3U };
    struct spi_buf_set __sd = { &__bd, 1 };
    (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sd);
    px += __chunk;
    count -= __chunk;
  }
}
`;

  // Per-controller solid-fill. Both tile one built row into the block buffer
  // and stream it in multi-row chunks; only the color encoding differs.
  const fillRectFn = isIli9341
    ? `
static void __tc_op_fillRect(void* /*ctx*/, int16_t x, int16_t y, int16_t rw, int16_t rh, uint16_t c) {
  if (rw <= 0 || rh <= 0) return;
  uint8_t __b0 = static_cast<uint8_t>(c >> 8);
  uint8_t __b1 = static_cast<uint8_t>(c);
  // Build one row, then tile it into the block buffer.
  for (int16_t i = 0; i < rw; i++) {
    ${rowBuf}[i * 2] = __b0;
    ${rowBuf}[i * 2 + 1] = __b1;
  }
  size_t rowBytes = static_cast<size_t>(rw) * 2U;
  for (int16_t r = 0; r < __TC_FILL_ROWS; r++) {
    memcpy(&${blockBuf}[static_cast<size_t>(r) * rowBytes], ${rowBuf}, rowBytes);
  }
  __tc_pnl_set_window(x, y, rw, rh);
  __tc_pnl_ramwr_begin();
  int16_t remaining = rh;
  while (remaining > 0) {
    int16_t chunk = (remaining > __TC_FILL_ROWS) ? __TC_FILL_ROWS : remaining;
    struct spi_buf __bd = { ${blockBuf}, static_cast<size_t>(chunk) * rowBytes };
    struct spi_buf_set __sd = { &__bd, 1 };
    (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sd);
    remaining -= chunk;
  }
  __tc_pnl_ramwr_end();
}
`
    : `
// Fill a rect row-by-row using the one-row 18-bit scratch buffer. This is the
// hot path for background clears and large fills; building the color into the
// reused buffer and writing each row keeps memory bounded.
// Fill a rect with a solid color. The 18-bit row is tiled into the block buffer
// (__TC_FILL_ROWS rows), then the whole rect is sent in multi-row spi_write
// chunks. A full 480x320 clear is ~40 writes instead of ~320, dropping it from
// ~110ms to ~15ms — the ESP32 SPI driver's per-transaction overhead (not SPI
// bandwidth) is the binding cost, so fewer/larger writes win. Scatter-gather
// descriptor lists tested slower (the driver walks each descriptor), so this
// uses one contiguous buffer per write.
static void __tc_op_fillRect(void* /*ctx*/, int16_t x, int16_t y, int16_t rw, int16_t rh, uint16_t c) {
  if (rw <= 0 || rh <= 0) return;
  uint8_t __b0 = static_cast<uint8_t>((c >> 8) & 0xF8u);
  uint8_t __b1 = static_cast<uint8_t>((c >> 3) & 0xFCu);
  uint8_t __b2 = static_cast<uint8_t>((c << 3) & 0xF8u);
  // Build one 18-bit row, then tile it into the block buffer.
  for (int16_t i = 0; i < rw; i++) {
    ${rowBuf}[i * 3] = __b0;
    ${rowBuf}[i * 3 + 1] = __b1;
    ${rowBuf}[i * 3 + 2] = __b2;
  }
  size_t rowBytes = static_cast<size_t>(rw) * 3U;
  for (int16_t r = 0; r < __TC_FILL_ROWS; r++) {
    memcpy(&${blockBuf}[static_cast<size_t>(r) * rowBytes], ${rowBuf}, rowBytes);
  }
  __tc_pnl_set_window(x, y, rw, rh);
  __tc_pnl_ramwr_begin();
  int16_t remaining = rh;
  while (remaining > 0) {
    int16_t chunk = (remaining > __TC_FILL_ROWS) ? __TC_FILL_ROWS : remaining;
    struct spi_buf __bd = { ${blockBuf}, static_cast<size_t>(chunk) * rowBytes };
    struct spi_buf_set __sd = { &__bd, 1 };
    (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sd);
    remaining -= chunk;
  }
  __tc_pnl_ramwr_end();
}
`;

  // Per-controller init table. Both are byte-for-byte Adafruit sequences
  // emitted as (cmd, len, data, delay) records walked in display_init.
  const initBlock = isIli9341
    ? `
// ── Panel init ──────────────────────────────────────────────────────────
// Adafruit ILI9341 init sequence (initILI9341), byte for byte: SWRESET,
// manufacturer/power/gamma registers, MADCTL 0x28 (MV landscape + BGR, the
// same convention as the ST7796S path), COLMOD 0x55 (16-bit RGB565 — the
// native wire format of the pack565 transport), SLPOUT (150ms), DISPON
// (150ms), INVON. INVON is included because the common ILI9341 SPI modules
// (2.2"/2.4" TFTs) ship with an inverted panel; the in-tree binding's
// display-inversion property mirrors this for the stock driver.
struct __tc_pnl_init_cmd { uint8_t cmd; uint8_t len; const uint8_t* data; uint16_t delay_ms; };
static const uint8_t __tc_pnl_i1[] = {0x03, 0x80, 0x02};
static const uint8_t __tc_pnl_i2[] = {0x00, 0xC1, 0x30};
static const uint8_t __tc_pnl_i3[] = {0x64, 0x03, 0x12, 0x81};
static const uint8_t __tc_pnl_i4[] = {0x85, 0x00, 0x78};
static const uint8_t __tc_pnl_i5[] = {0x39, 0x2C, 0x00, 0x34, 0x02};
static const uint8_t __tc_pnl_i6[] = {0x20};
static const uint8_t __tc_pnl_i7[] = {0x00, 0x00};
static const uint8_t __tc_pnl_i8[] = {0x23};
static const uint8_t __tc_pnl_i9[] = {0x10};
static const uint8_t __tc_pnl_i10[] = {0x3E, 0x28};
static const uint8_t __tc_pnl_i11[] = {0x86};
static const uint8_t __tc_pnl_i12[] = {0x28};
static const uint8_t __tc_pnl_i13[] = {0x55};
static const uint8_t __tc_pnl_i14[] = {0x00, 0x18};
static const uint8_t __tc_pnl_i15[] = {0x08, 0x82, 0x27};
static const uint8_t __tc_pnl_i16[] = {0x00};
static const uint8_t __tc_pnl_i17[] = {0x01};
static const uint8_t __tc_pnl_i18[] = {0x0F, 0x31, 0x2B, 0x0C, 0x0E, 0x08, 0x4E, 0xF1, 0x37, 0x07, 0x10, 0x03, 0x0E, 0x09, 0x00};
static const uint8_t __tc_pnl_i19[] = {0x00, 0x0E, 0x14, 0x03, 0x11, 0x07, 0x31, 0xC1, 0x48, 0x08, 0x0F, 0x0C, 0x31, 0x36, 0x0F};
static const struct __tc_pnl_init_cmd __tc_pnl_init_seq[] = {
  {0x01, 0, NULL, 150},      // SWRESET
  {0xEF, 3, __tc_pnl_i1, 0},
  {0xCF, 3, __tc_pnl_i2, 0},
  {0xED, 4, __tc_pnl_i3, 0},
  {0xE8, 3, __tc_pnl_i4, 0},
  {0xCB, 5, __tc_pnl_i5, 0},
  {0xF7, 1, __tc_pnl_i6, 0},
  {0xEA, 2, __tc_pnl_i7, 0},
  {0xC0, 1, __tc_pnl_i8, 0},  // PWCTRL1
  {0xC1, 1, __tc_pnl_i9, 0},  // PWCTRL2
  {0xC5, 2, __tc_pnl_i10, 0}, // VMCTRL1
  {0xC7, 1, __tc_pnl_i11, 0}, // VMCTRL2
  {0x36, 1, __tc_pnl_i12, 0}, // MADCTL 0x28: MV (landscape) + BGR=1
  {0x3A, 1, __tc_pnl_i13, 0}, // COLMOD 0x55 (16-bit RGB565)
  {0xB1, 2, __tc_pnl_i14, 0}, // FRMCTR1
  {0xB6, 3, __tc_pnl_i15, 0}, // DISCTRL
  {0xF2, 1, __tc_pnl_i16, 0}, // ENABLE3G off
  {0x26, 1, __tc_pnl_i17, 0}, // GAMSET gamma curve 1
  {0xE0, 15, __tc_pnl_i18, 0}, // PGAMCTRL
  {0xE1, 15, __tc_pnl_i19, 0}, // NGAMCTRL
  {0x11, 0, NULL, 150},      // SLPOUT (sleep out — 120ms typical)
  {0x29, 0, NULL, 150},      // DISPON
  {0x21, 0, NULL, 0},        // INVON (common ILI9341 modules ship inverted)
};
`
    : `
// ── Panel init ──────────────────────────────────────────────────────────
// Adafruit ST7796S init sequence (demo-st lib fork), byte for byte: hw reset
// pulse, SWRESET, manufacturer unlock, VCOM/MADCTL/COLMOD/porch registers,
// lock, SLPOUT (150ms), DISPON (150ms), INVOFF. MADCTL 0x28 = MV (rotation 1
// landscape) + BGR=1. BGR=1 makes the controller route data R/B to the
// B/R subpixels (verified: red data shows blue with BGR=1), which combined
// with a lossless R/B data swap renders the UI correctly; BGR=0 leaves a
// half-lossy G/B quirk on this clone controller.
struct __tc_pnl_init_cmd { uint8_t cmd; uint8_t len; const uint8_t* data; uint16_t delay_ms; };
static const uint8_t __tc_pnl_i1[] = {0xC3};
static const uint8_t __tc_pnl_i2[] = {0x96};
static const uint8_t __tc_pnl_i3[] = {0x1C};
static const uint8_t __tc_pnl_i4[] = {0x28};
static const uint8_t __tc_pnl_i5[] = {0x66};
static const uint8_t __tc_pnl_i6[] = {0x80};
static const uint8_t __tc_pnl_i7[] = {0x00};
static const uint8_t __tc_pnl_i8[] = {0x80, 0x02, 0x3B};
static const uint8_t __tc_pnl_i9[] = {0xC6};
static const uint8_t __tc_pnl_i10[] = {0x69};
static const uint8_t __tc_pnl_i11[] = {0x3C};
static const struct __tc_pnl_init_cmd __tc_pnl_init_seq[] = {
  {0x01, 0, NULL, 150},      // SWRESET
  {0xF0, 1, __tc_pnl_i1, 0},  // unlock manufacturer
  {0xF0, 1, __tc_pnl_i2, 0},
  {0xC5, 1, __tc_pnl_i3, 0},  // VCOM control
  {0x36, 1, __tc_pnl_i4, 0},  // MADCTL 0x28: MV (rotation 1) + BGR=1
  {0x3A, 1, __tc_pnl_i5, 0},  // COLMOD 0x66 (18-bit, 262K) — clean channel routing
  {0xB0, 1, __tc_pnl_i6, 0},  // interface control
  {0xB4, 1, __tc_pnl_i7, 0},  // inversion control
  {0xB6, 3, __tc_pnl_i8, 0},  // display function control
  {0xB7, 1, __tc_pnl_i9, 0},  // entry mode
  {0xF0, 1, __tc_pnl_i10, 0}, // lock manufacturer
  {0xF0, 1, __tc_pnl_i11, 0},
  {0x11, 0, NULL, 150},      // SLPOUT (sleep out — 120ms typical)
  {0x29, 0, NULL, 150},      // DISPON
  {0x20, 0, NULL, 0},        // INVOFF (non-inverted at power-on)
};
`;

  const functions = `
// ── Direct panel transport ──────────────────────────────────────────────
// GPIOs: CS/DC/RST driven manually; CS stays LOW for the whole command+data
// burst (DC toggles between command byte and parameters/pixels), matching the
// Adafruit ST77xx protocol this panel requires. The SPI config carries no CS
// (cs_is_gpio = false -> the ESP32 driver's hardware CSEL pin is left idle;
// it is not connected to the panel).
static const struct gpio_dt_spec __tc_pnl_cs = GPIO_DT_SPEC_GET(DT_NODELABEL(${bus}), cs_gpios);
static const struct gpio_dt_spec __tc_pnl_dc = GPIO_DT_SPEC_GET(DT_NODELABEL(${bridge}), dc_gpios);
static const struct gpio_dt_spec __tc_pnl_rst = GPIO_DT_SPEC_GET(DT_NODELABEL(${bridge}), reset_gpios);

// 8-bit frames for commands/parameters and ${isIli9341 ? '16-bit (2 bytes/pixel)' : '18-bit (3 bytes/pixel)'} pixel data.
static struct spi_config __tc_pnl_cfg8 = {
  .frequency = DT_PROP(DT_NODELABEL(${dtLabel}), mipi_max_frequency),
  .operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8),
  .slave = 0,
};

// Assert CS (active=low) unless a startWrite/endWrite batch already holds it.
static inline void __tc_pnl_cs_assert(void) {
  if (__tc_pnl_write_depth == 0U) { gpio_pin_set_dt(&__tc_pnl_cs, 1); }
}
// Deassert CS unless a startWrite/endWrite batch is still holding it.
static inline void __tc_pnl_cs_release(void) {
  if (__tc_pnl_write_depth == 0U) { gpio_pin_set_dt(&__tc_pnl_cs, 0); }
}

// Write one command byte (DC low) + its parameters (DC high). CS is asserted
// for the burst unless an outer startWrite is already holding it.
static void __tc_pnl_cmd(uint8_t cmd, const uint8_t* data, uint16_t len) {
  struct spi_buf __bc = { &cmd, 1 };
  struct spi_buf_set __sc = { &__bc, 1 };
  __tc_pnl_cs_assert();
  gpio_pin_set_dt(&__tc_pnl_dc, 0);
  (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sc);
  if (len > 0) {
    struct spi_buf __bd = { const_cast<uint8_t*>(data), len };
    struct spi_buf_set __sd = { &__bd, 1 };
    gpio_pin_set_dt(&__tc_pnl_dc, 1);
    (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sd);
  }
  __tc_pnl_cs_release();
}

// Open a RAMWR burst: CS low, RAMWR command, DC high for the pixel data.
static void __tc_pnl_ramwr_begin(void) {
  uint8_t __ramwr = 0x2C;
  struct spi_buf __bc = { &__ramwr, 1 };
  struct spi_buf_set __sc = { &__bc, 1 };
  __tc_pnl_cs_assert();
  gpio_pin_set_dt(&__tc_pnl_dc, 0);
  (void)spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sc);
  gpio_pin_set_dt(&__tc_pnl_dc, 1);
}

static void __tc_pnl_ramwr_end(void) { __tc_pnl_cs_release(); }

// Read ST7796S/ILI9341 GET_SCANLINE (0x45). These controllers return one
// dummy byte followed by the 16-bit scanline. Some modules do not implement
// readback correctly; 0xFFFF means "unknown" and disables waiting for that
// update rather than stalling or corrupting the frame.
static uint16_t __tc_pnl_read_scanline(void) {
  if (!__tc_pnl_scanline_sync) return 0xFFFFu;
  uint8_t __cmd = 0x45;
  uint8_t __tx[3] = {0, 0, 0};
  uint8_t __rx[3] = {0, 0, 0};
  struct spi_buf __bc = { &__cmd, 1 };
  struct spi_buf_set __sc = { &__bc, 1 };
  struct spi_buf __bt = { __tx, sizeof(__tx) };
  struct spi_buf __br = { __rx, sizeof(__rx) };
  struct spi_buf_set __st = { &__bt, 1 };
  struct spi_buf_set __sr = { &__br, 1 };
  __tc_pnl_cs_assert();
  gpio_pin_set_dt(&__tc_pnl_dc, 0);
  int __cmd_err = spi_write(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__sc);
  int __read_err = 0;
  if (__cmd_err == 0) {
    gpio_pin_set_dt(&__tc_pnl_dc, 1);
    __read_err = spi_transceive(DEVICE_DT_GET(DT_NODELABEL(${bus})), &__tc_pnl_cfg8, &__st, &__sr);
  }
  __tc_pnl_cs_release();
  if (__cmd_err != 0 || __read_err != 0) return 0xFFFFu;
  uint16_t __line = static_cast<uint16_t>((static_cast<uint16_t>(__rx[1]) << 8) | __rx[2]);
  return (__line < ${h}) ? __line : 0xFFFFu;
}

// Wait until the panel has scanned past a dirty rectangle. This is intentionally
// bounded: a broken/floating SDO must never hang the UI loop. Full-height writes
// have no safe post-rectangle interval, so they retain the normal single-burst
// behavior; the caller's framebuffer still prevents intermediate software frames.
static void __tc_pnl_wait_for_safe_rect(int16_t y, int16_t rh) {
#if __TC_TE_SYNC
  // TE variant: arm on the next frame pulse, then start the burst — the write
  // chases the scan beam from the top of the rect. Bounded so a stuck TE line
  // can never hang the UI loop.
  if (rh < 8 || y < 0) return;
  uint32_t __was = __tc_te_count;
  uint32_t __deadline = k_uptime_get_32() + 25U;
  while (__tc_te_count == __was) {
    if (static_cast<int32_t>(k_uptime_get_32() - __deadline) >= 0) break;
    k_msleep(0);
  }
  return;
#endif
  if (!__tc_pnl_scanline_sync || rh < 8 || y < 0) return;
  int16_t __last = static_cast<int16_t>(y + rh - 1);
  if (__last >= static_cast<int16_t>(${h} - 2)) return;
  uint32_t __deadline = k_uptime_get_32() + 20U;
  for (;;) {
    uint16_t __line = __tc_pnl_read_scanline();
    if (__line == 0xFFFFu || (__line > static_cast<uint16_t>(__last + 2) && __line < static_cast<uint16_t>(${h} - 2))) return;
    if (static_cast<int32_t>(k_uptime_get_32() - __deadline) >= 0) return;
    k_msleep(0);
  }
}
${pixelHelpers}
// Set the address window. Coordinates are in the effective (rotated) UI
// space; the panel's MADCTL (rotation 1: MV) maps them onto the native
// 320x480 raster, so CASET/RASET take the UI x/y ranges directly.
static void __tc_pnl_set_window(int16_t x, int16_t y, int16_t winW, int16_t winH) {
  __tc_pnl_wait_for_safe_rect(y, winH);
  uint16_t __x0 = static_cast<uint16_t>(x);
  uint16_t __x1 = static_cast<uint16_t>(x + winW - 1);
  uint16_t __y0 = static_cast<uint16_t>(y);
  uint16_t __y1 = static_cast<uint16_t>(y + winH - 1);
  uint8_t __ca[4] = { static_cast<uint8_t>(__x0 >> 8), static_cast<uint8_t>(__x0),
                      static_cast<uint8_t>(__x1 >> 8), static_cast<uint8_t>(__x1) };
  uint8_t __ra[4] = { static_cast<uint8_t>(__y0 >> 8), static_cast<uint8_t>(__y0),
                      static_cast<uint8_t>(__y1 >> 8), static_cast<uint8_t>(__y1) };
  __tc_pnl_cmd(0x2A, __ca, 4);
  __tc_pnl_cmd(0x2B, __ra, 4);
}

// ── Panel-ops consumed by CuttlefishGFX ─────────────────────────────────
// startWrite/endWrite batch multiple primitives under one CS-asserted burst
// (Adafruit ST77xx protocol: CS held low across the burst, DC toggles
// mid-burst). A depth counter supports nested startWrite calls — the runtime
// sometimes wraps a canvas push inside an outer transaction. Only the
// outermost startWrite asserts CS and the outermost endWrite releases it;
// inner ones just bump the depth. This collapses per-primitive CS-toggle
// overhead (one transaction per burst instead of one per rect/glyph row).
static void __tc_op_startWrite(void* /*ctx*/) {
  if (__tc_pnl_write_depth == 0U) { gpio_pin_set_dt(&__tc_pnl_cs, 1); }
  __tc_pnl_write_depth++;
}
static void __tc_op_endWrite(void* /*ctx*/) {
  if (__tc_pnl_write_depth > 0U) {
    __tc_pnl_write_depth--;
    if (__tc_pnl_write_depth == 0U) { gpio_pin_set_dt(&__tc_pnl_cs, 0); }
  }
}

// Stash the target rect. The runtime always follows this with writePixels
// delivering exactly (w*h) pixels for this rect, OR fillRect/writePixel which
// ignore the stash.
static void __tc_op_setAddrWindow(void* /*ctx*/, int16_t x, int16_t y, int16_t winW, int16_t winH) {
  __tc_aw_x = x; __tc_aw_y = y; __tc_aw_w = winW; __tc_aw_h = winH;
}

// Push the stashed rect's worth of rgb565 pixels. Called right after
// setAddrWindow with exactly (aw_w * aw_h) pixels. The caller's buffer is
// never mutated (scroll canvases persist across frames), so pixels are
// converted in chunks through the row${bpp} scratch buffer.
static void __tc_op_writePixels(void* /*ctx*/, const uint16_t* px, uint32_t n) {
  if (n == 0U) return;
  __tc_pnl_set_window(__tc_aw_x, __tc_aw_y, __tc_aw_w, __tc_aw_h);
  __tc_pnl_ramwr_begin();
  ${pixelsFn}(px, n);
  __tc_pnl_ramwr_end();
}

// Single pixel: write a 1x1 rect.
static void __tc_op_writePixel(void* /*ctx*/, int16_t x, int16_t y, uint16_t c) {
  uint16_t __c = c;
  __tc_pnl_set_window(x, y, 1, 1);
  __tc_pnl_ramwr_begin();
  ${pixelsFn}(&__c, 1);
  __tc_pnl_ramwr_end();
}
${fillRectFn}
static int16_t __tc_op_width(void* /*ctx*/) { return ${w}; }
static int16_t __tc_op_height(void* /*ctx*/) { return ${h}; }

// flush is nullptr — direct-mode panel (TFT), no backing store to push.
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
  nullptr,  // flush — direct-mode panel
};

// The live display target: a CuttlefishGFX driven by the panel-ops vtable.
CuttlefishGFX __tc_display(&__tc_display_ops, nullptr);
${initBlock}
// ── display_init (called from setup) ────────────────────────────────────

static inline void display_init() {
  printk("TC_DISPLAY: device ready\\n");
${teInit}
${blInit}
  gpio_pin_configure_dt(&__tc_pnl_cs, GPIO_OUTPUT);
  gpio_pin_configure_dt(&__tc_pnl_dc, GPIO_OUTPUT);
  gpio_pin_configure_dt(&__tc_pnl_rst, GPIO_OUTPUT);
  // Hardware reset pulse (Adafruit init behavior).
  gpio_pin_set_dt(&__tc_pnl_rst, 1);
  k_msleep(20);
  gpio_pin_set_dt(&__tc_pnl_rst, 0);
  k_msleep(20);
  // Adafruit init sequence, direct protocol.
  for (uint32_t i = 0; i < (sizeof(__tc_pnl_init_seq) / sizeof(__tc_pnl_init_seq[0])); i++) {
    __tc_pnl_cmd(__tc_pnl_init_seq[i].cmd, __tc_pnl_init_seq[i].data,
                 __tc_pnl_init_seq[i].len);
    if (__tc_pnl_init_seq[i].delay_ms > 0) k_msleep(__tc_pnl_init_seq[i].delay_ms);
  }
  __tc_op_fillRect(nullptr, 0, 0, ${w}, ${h}, 0x0000);
  printk("TC_DISPLAY: direct init done (${wireTag}, black fill)\\n");
}

static inline void display_fillScreen(UI_COLOR_T color) {
  __tc_op_fillRect(nullptr, 0, 0, ${w}, ${h}, static_cast<uint16_t>(color));
}
static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }
static inline int16_t display_width() { return ${w}; }
static inline int16_t display_height() { return ${h}; }

static inline void display_startWrite() { __tc_op_startWrite(nullptr); }
static inline void display_endWrite() { __tc_op_endWrite(nullptr); }
static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t winW, int16_t winH) {
  __tc_op_setAddrWindow(nullptr, x, y, winW, winH);
}
static inline void display_writePixels(uint16_t* pixels, uint32_t count) {
  __tc_op_writePixels(nullptr, pixels, count);
}

// ── Canvas lifecycle + accessors (offscreen rgb565 compositing) ──────────
// Allocate the canvas object via malloc + placement-new (not operator new).
// Under CONFIG_REQUIRES_FULL_LIBCPP without CONFIG_CPP_EXCEPTIONS, operator new
// throws std::bad_alloc on OOM and the nothrow wrapper's internal catch cannot
// unwind (no EH runtime) → std::terminate → abort. malloc returns NULL on
// failure with no exception path; placement-new then constructs the object in
// place (vtable included). display_deleteCanvas mirrors with an explicit dtor
// + free. The runtime's callers already null-check the return, so an OOM
// degrades gracefully instead of aborting.
static inline CuttlefishCanvas16* display_createCanvas(int16_t cw, int16_t ch) {
  void* mem = malloc(sizeof(CuttlefishCanvas16));
  if (!mem) return nullptr;
  return new (mem) CuttlefishCanvas16(cw, ch);
}
// psramFound() shim: the Arduino ESP32 core provides this, but Zephyr does not.
// Under BOARD_HAS_PSRAM the ESP heap serves PSRAM, so report it as present. The
// runtime's ui_create_canvas_best calls this under #if defined(BOARD_HAS_PSRAM).
#if defined(BOARD_HAS_PSRAM) && !defined(psramFound)
#include <zephyr/multi_heap/shared_multi_heap.h>
static inline bool psramFound() {
  // Compile-time truth: if BOARD_HAS_PSRAM is defined, the build targets a
  // PSRAM board with CONFIG_ESP_SPIRAM enabled (the framework emits both).
  return true;
}
// Allocate from PSRAM via Zephyr's shared multi-heap (the ESP32 SoC code
// registers PSRAM as an SMH_REG_ATTR_EXTERNAL region at boot).
static inline void* ui_psram_malloc(size_t bytes) {
  return shared_multi_heap_alloc(SMH_REG_ATTR_EXTERNAL, bytes);
}
#endif
static inline CuttlefishCanvas16* display_createCanvasPsram(int16_t cw, int16_t ch) {
  // Allocate the pixel buffer in PSRAM (large: w*h*2 bytes) and the small
  // canvas object in SRAM. The canvas takes ownership of the PSRAM buffer and
  // frees it via free() in its dtor (the SMH allocator's free is compatible
  // with the standard k_free/free path). Returns nullptr if PSRAM isn't
  // available or the allocation fails — ui_create_canvas_best falls back.
#if defined(BOARD_HAS_PSRAM)
  if ((cw > 0) && (ch > 0)) {
    size_t bytes = static_cast<size_t>(cw) * static_cast<size_t>(ch) * sizeof(uint16_t);
    uint16_t* psramBuf = static_cast<uint16_t*>(ui_psram_malloc(bytes));
    if (psramBuf) {
      void* mem = malloc(sizeof(CuttlefishCanvas16));
      if (mem) {
        return new (mem) CuttlefishCanvas16(cw, ch, psramBuf, 1);
      }
      free(psramBuf);
    }
  }
#else
  (void)cw; (void)ch;
#endif
  return nullptr;
}
static inline void display_deleteCanvas(CuttlefishCanvas16* canvas) {
  if (!canvas) return;
  canvas->~CuttlefishCanvas16();
  free(canvas);
}
static inline int16_t display_canvasWidth(CuttlefishCanvas16* c) { return c->width(); }
static inline int16_t display_canvasHeight(CuttlefishCanvas16* c) { return c->height(); }
static inline uint16_t* display_canvasBuffer(CuttlefishCanvas16* c) { return c->getBuffer(); }
static inline uint16_t display_canvasGetPixel(CuttlefishCanvas16* c, int16_t x, int16_t y) { return c->getPixel(x, y); }
static inline void display_canvasFillScreen(CuttlefishCanvas16* c, UI_COLOR_T color) { c->fillScreen(static_cast<uint16_t>(color)); }
static inline void display_canvasFillRect(CuttlefishCanvas16* c, int16_t x, int16_t y, int16_t cw, int16_t ch, UI_COLOR_T color) {
  c->fillRect(x, y, cw, ch, static_cast<uint16_t>(color));
}

// ── Target-polymorphic draw (panel or canvas via CuttlefishDisplayTarget*) ─
static inline void display_targetDrawPixel(CuttlefishDisplayTarget* t, int16_t x, int16_t y, UI_COLOR_T color) { t->drawPixel(x, y, static_cast<uint16_t>(color)); }
static inline int16_t display_targetWidth(CuttlefishDisplayTarget* t) { return t->width(); }
static inline int16_t display_targetHeight(CuttlefishDisplayTarget* t) { return t->height(); }
static inline void display_targetDrawRGBBitmap(CuttlefishDisplayTarget* t, int16_t x, int16_t y, const uint16_t* bitmap, int16_t bw, int16_t bh) {
  t->drawRGBBitmap(x, y, bitmap, bw, bh);
}
static inline void display_targetFillRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, UI_COLOR_T color) { t->fillRect(x, y, bw, bh, static_cast<uint16_t>(color)); }
static inline void display_targetDrawFastHLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, UI_COLOR_T color) { t->drawFastHLine(x, y, bw, static_cast<uint16_t>(color)); }
static inline void display_targetDrawFastVLine(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bh, UI_COLOR_T color) { t->drawFastVLine(x, y, bh, static_cast<uint16_t>(color)); }
static inline void display_targetFillRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, int16_t r, UI_COLOR_T color) { t->fillRoundRect(x, y, bw, bh, r, static_cast<uint16_t>(color)); }
static inline void display_targetDrawRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, UI_COLOR_T color) { t->drawRect(x, y, bw, bh, static_cast<uint16_t>(color)); }
static inline void display_targetDrawRoundRect(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t bw, int16_t bh, int16_t r, UI_COLOR_T color) { t->drawRoundRect(x, y, bw, bh, r, static_cast<uint16_t>(color)); }
static inline void display_targetDrawLine(CuttlefishDisplayTarget* t, int16_t x0, int16_t y0, int16_t x1, int16_t y1, UI_COLOR_T color) { t->drawLine(x0, y0, x1, y1, static_cast<uint16_t>(color)); }
static inline void display_targetFillCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->fillCircle(x, y, r, static_cast<uint16_t>(color)); }
static inline void display_targetDrawCircle(CuttlefishDisplayTarget* t, int16_t x, int16_t y, int16_t r, UI_COLOR_T color) { t->drawCircle(x, y, r, static_cast<uint16_t>(color)); }
static inline void display_targetSetCursor(CuttlefishDisplayTarget* t, int16_t x, int16_t y) { t->setCursor(x, y); }
static inline void display_targetSetTextColor(CuttlefishDisplayTarget* t, UI_COLOR_T fg) { t->setTextColor(static_cast<uint16_t>(fg)); }
static inline void display_targetSetTextColorBg(CuttlefishDisplayTarget* t, UI_COLOR_T fg, UI_COLOR_T bg) { t->setTextColor(static_cast<uint16_t>(fg), static_cast<uint16_t>(bg)); }
static inline void display_targetSetTextSize(CuttlefishDisplayTarget* t, uint8_t s) { t->setTextSize(s); }
static inline void display_targetSetTextWrap(CuttlefishDisplayTarget* t, bool wp) { t->setTextWrap(wp); }
static inline void display_targetPrint(CuttlefishDisplayTarget* t, const char* s) { t->print(s); }
`;

  return { includes, declaration, functions };
}

/**
 * Strategy-owned display adapter generator. Receives the resolved display and
 * looks up the Zephyr DT-binding profile by driver id. Returns undefined for
 * unknown drivers so resolveDisplayAdapter can decline and
 * generateDisplayAdapter surfaces a clear error.
 */
export const zephyrDisplayAdapterGenerator: DisplayAdapterGenerator = (display) => {
  const profile = ZEPHYR_DISPLAY_PROFILES[display.driver];
  if (!profile) return undefined as unknown as DisplayAdapterCode;
  // The UI adapter is RGB565/SPI (TFT) only. Monochrome panels (OLED) use the
  // direct display.* GFX runtime (gfx.ts mono branch) — there is no
  // CuttlefishGFX UI rendering path for mono. Decline so cuttlefish does not
  // emit an incompatible RGB565 adapter for a mono profile.
  if (profile.colorFormat === 'mono') return undefined as unknown as DisplayAdapterCode;
  return zephyrUiDisplayAdapter(profile, {
    scanlineSync: display.scanlineSync,
    miso: display.spiPins?.miso,
    tearingEffectPin: (display as { tearingEffectPin?: number }).tearingEffectPin,
  });
};
