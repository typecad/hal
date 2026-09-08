// ---------------------------------------------------------------------------
// Zephyr touch adapters for the TypeCAD UI rendering pipeline.
//
// Two controllers, both driven directly (polling, no in-tree driver):
//   - FT6336U capacitive over I2C (i2c_write_read_dt)
//   - XPT2046 resistive over SPI (spi_transceive_dt) — the Zephyr analog of
//     Arduino's XPT2046_Touchscreen adapter. The DT node uses the in-tree
//     xptek,xpt2046 binding; CONFIG_INPUT stays off, so the in-tree input
//     driver does not build and this adapter owns the chip.
//
// The adapters emit touch_init / touch_isTouched / touch_readRaw — the three
// symbols the runtime's ui_poll_touch body calls.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { TouchAdapterCodegen } from "@typecad/cuttlefish/api/shared";
import type { TouchProfile } from "@typecad/cuttlefish/api/shared";

/**
 * Generate a Zephyr touch adapter for the profile's library. Returns
 * undefined for libraries this framework doesn't handle so the strategy can
 * decline and cuttlefish surfaces a clear error.
 */
export function zephyrTouchAdapter(touch: TouchProfile): TouchAdapterCodegen | undefined {
  if (touch.library === "XPT2046_Touchscreen") return xpt2046Adapter(touch);
  if (touch.library === "FT6336U") return ft6336uAdapter(touch);
  return undefined;
}

/** XPT2046 control bytes (12-bit differential mode, auto power-down). */
const XPT2046_CMD_X = 0x90;
const XPT2046_CMD_Y = 0xd0;
const XPT2046_CMD_Z1 = 0xb0;
const hex = (v: number): string => `0x${v.toString(16).toUpperCase()}`;

function xpt2046Adapter(touch: TouchProfile): TouchAdapterCodegen {
  // Pen-detect Z1 threshold (raw 12-bit counts). Resistive panels need a few
  // hundred counts above noise; the TouchProfile default (10) is far too low
  // for raw Z1, so the adapter defaults to 400 (the Arduino XPT2046
  // library's Z_THRESHOLD) unless the config sets one explicitly.
  const zThreshold = touch.minPressure ?? 400;

  return {
    includes: [
      `#include <zephyr/kernel.h>`,
      `#include <zephyr/drivers/spi.h>`,
      `#include <zephyr/drivers/gpio.h>`,
    ],
    declaration: [
      `// Zephyr XPT2046 resistive touch — SPI device resolved via devicetree.`,
      `// The overlay defines the 'xpt2046' nodelabel on the panel's SPI bus`,
      `// (CS index 1) with the xptek,xpt2046 binding; the bus + CS + 2.5MHz`,
      `// ceiling come from that node. Raw X/Y/Z1 values are reported — the`,
      `// runtime applies the profile calibration + rotation.`,
      `static const struct spi_dt_spec __tc_touch =`,
      `    SPI_DT_SPEC_GET(DT_NODELABEL(xpt2046), SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0U);`,
      `static int16_t __tc_touch_cached_x = 0;`,
      `static int16_t __tc_touch_cached_y = 0;`,
      `static int16_t __tc_touch_cached_z = 0;`,
      `static uint8_t __tc_touch_cached_valid = 0;`,
      `#if DT_NODE_HAS_PROP(DT_NODELABEL(xpt2046), int_gpios)`,
      `static const struct gpio_dt_spec __tc_touch_irq = GPIO_DT_SPEC_GET(DT_NODELABEL(xpt2046), int_gpios);`,
      `static uint8_t __tc_touch_irq_ready = 0;`,
      `#endif`,
    ].join("\n"),
    functions: [
      `// One XPT2046 conversion: clock out a control byte, read the 12-bit`,
      `// result. The rx byte during the command phase is a dummy; the value is`,
      `// MSB-aligned across the following 16 bits ((b1<<8 | b2) >> 3). The`,
      `// control byte's PD bits are 00 (auto power-down between transactions),`,
      `// so the bus stays shareable with the panel. Touch is polled every frame`,
      `// from ui_poll_touch, so a failed transfer is non-fatal — returns 0 and`,
      `// touch_isTouched() reports false.`,
      `static uint16_t __tc_xpt_read(uint8_t cmd) {`,
      `  if (!device_is_ready(__tc_touch.bus)) return 0U;`,
      `  uint8_t __tx[3] = { cmd, 0U, 0U };`,
      `  uint8_t __rx[3] = { 0U, 0U, 0U };`,
      `  struct spi_buf __bt = { __tx, sizeof(__tx) };`,
      `  struct spi_buf __br = { __rx, sizeof(__rx) };`,
      `  struct spi_buf_set __st = { &__bt, 1 };`,
      `  struct spi_buf_set __sr = { &__br, 1 };`,
      `  if (spi_transceive_dt(&__tc_touch, &__st, &__sr) != 0) return 0U;`,
      `  return static_cast<uint16_t>(((static_cast<uint16_t>(__rx[1]) << 8) | __rx[2]) >> 3);`,
      `}`,
      ``,
      `static inline void touch_init() {`,
      `  // The SPI bus + CS are configured by devicetree. Configure the pen IRQ`,
      `  // input (active low) when the overlay wired it — the cheap detect path.`,
      `#if DT_NODE_HAS_PROP(DT_NODELABEL(xpt2046), int_gpios)`,
      `  if (device_is_ready(__tc_touch_irq.port)) {`,
      `    gpio_pin_configure_dt(&__tc_touch_irq, GPIO_INPUT);`,
      `    __tc_touch_irq_ready = 1U;`,
      `  }`,
      `#endif`,
      `  (void)device_is_ready(__tc_touch.bus);`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  __tc_touch_cached_valid = 0;`,
      `  __tc_touch_cached_z = 0;`,
      `#if DT_NODE_HAS_PROP(DT_NODELABEL(xpt2046), int_gpios)`,
      `  if (__tc_touch_irq_ready != 0U) {`,
      `    // PENIRQ asserts (active low) while the panel is pressed — no SPI`,
      `    // traffic needed to answer the per-frame poll.`,
      `    if (gpio_pin_get_dt(&__tc_touch_irq) <= 0) return false;`,
      `  }`,
      `#endif`,
      `  // No IRQ (or it fired): confirm via Z1 pressure before reading coords.`,
      `  uint16_t __z1 = __tc_xpt_read(${hex(XPT2046_CMD_Z1)});`,
      `  if (__z1 <= ${zThreshold}) return false;`,
      `  __tc_touch_cached_x = static_cast<int16_t>(__tc_xpt_read(${hex(XPT2046_CMD_X)}));`,
      `  __tc_touch_cached_y = static_cast<int16_t>(__tc_xpt_read(${hex(XPT2046_CMD_Y)}));`,
      `  __tc_touch_cached_z = static_cast<int16_t>(__z1);`,
      `  __tc_touch_cached_valid = 1;`,
      `  return true;`,
      `}`,
      ``,
      `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
      `  // touch_isTouched() is polled each frame by ui_poll_touch; the cached`,
      `  // values are fresh. If something calls readRaw before isTouched, probe now.`,
      `  if (!__tc_touch_cached_valid) {`,
      `    (void)touch_isTouched();`,
      `  }`,
      `  if (x) *x = __tc_touch_cached_x;`,
      `  if (y) *y = __tc_touch_cached_y;`,
      `  if (z) *z = __tc_touch_cached_z;`,
      `  __tc_touch_cached_valid = 0;`,
      `}`,
    ].join("\n"),
  };
}

function ft6336uAdapter(_touch: TouchProfile): TouchAdapterCodegen {
  return {
    includes: [
      `#include <zephyr/drivers/i2c.h>`,
    ],
    declaration: [
      `// Zephyr FT6336U touch — I2C device resolved via devicetree.`,
      `// The board DT must define an 'ft6336u' nodelabel on an I2C bus.`,
      `static const struct i2c_dt_spec __tc_touch = I2C_DT_SPEC_GET(DT_NODELABEL(ft6336u));`,
      `static int16_t __tc_touch_cached_x = 0;`,
      `static int16_t __tc_touch_cached_y = 0;`,
      `static int16_t __tc_touch_cached_z = 0;`,
      `static uint8_t __tc_touch_cached_valid = 0;`,
    ].join("\n"),
    functions: [
      `// Read N bytes starting from a register address. Returns 1 on success.`,
      `// Uses i2c_write_read_dt for a combined write-read transaction (register`,
      `// address write, then repeated-start read). The FT6336U is polled every`,
      `// frame from ui_poll_touch, so a failed read (stuck SDA, no controller) is`,
      `// non-fatal — returns 0 and touch_isTreated() returns false.`,
      `static inline uint8_t __tc_touch_read_block(uint8_t reg, uint8_t* buf, uint8_t len) {`,
      `  if (!device_is_ready(__tc_touch.bus)) return 0U;`,
      `  int rc = i2c_write_read_dt(&__tc_touch, &reg, 1U, buf, len);`,
      `  return (rc == 0) ? 1U : 0U;`,
      `}`,
      ``,
      `static inline void touch_init() {`,
      `  // The I2C bus + device are configured by devicetree. The FT6336U needs a`,
      `  // hardware reset (reset pin low → high) to enter normal mode after power-on.`,
      `#if DT_NODE_HAS_STATUS(DT_NODELABEL(ft6336u), okay) && DT_NODE_HAS_PROP(DT_NODELABEL(ft6336u), reset_gpios)`,
      `  static const struct gpio_dt_spec __tc_touch_rst = GPIO_DT_SPEC_GET(DT_NODELABEL(ft6336u), reset_gpios);`,
      `  if (device_is_ready(__tc_touch_rst.port)) {`,
      `    gpio_pin_configure_dt(&__tc_touch_rst, GPIO_OUTPUT_ACTIVE);    // assert reset (active=low)`,
      `    k_msleep(10);`,
      `    gpio_pin_set_dt(&__tc_touch_rst, 0);                            // release reset (inactive=high)`,
      `    k_msleep(200);  // FT6336U needs ~50ms after reset before responding`,
      `  }`,
      `#endif`,
      `  (void)device_is_ready(__tc_touch.bus);`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  __tc_touch_cached_valid = 0;`,
      `  __tc_touch_cached_z = 0;`,
      `  // Read TD_STATUS (0x02) + P1_XH/XL/YH/YL — 5 bytes in one transaction.`,
      `  uint8_t buf[5] = {0, 0, 0, 0, 0};`,
      `  if (!__tc_touch_read_block(0x02, buf, 5U)) return false;`,
      `  uint8_t count = buf[0] & 0x0F;`,
      `  if (count == 0U) return false;`,
      `  __tc_touch_cached_x = static_cast<int16_t>((static_cast<uint16_t>(buf[1] & 0x0F) << 8) | buf[2]);`,
      `  __tc_touch_cached_y = static_cast<int16_t>((static_cast<uint16_t>(buf[3] & 0x0F) << 8) | buf[4]);`,
      `  __tc_touch_cached_z = 255;`,
      `  __tc_touch_cached_valid = 1;`,
      `  return true;`,
      `}`,
      ``,
      `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
      `  // touch_isTouched() is polled each frame by ui_poll_touch; the cached`,
      `  // values are fresh. If something calls readRaw before isTouched, probe now.`,
      `  if (!__tc_touch_cached_valid) {`,
      `    (void)touch_isTouched();`,
      `  }`,
      `  if (x) *x = __tc_touch_cached_x;`,
      `  if (y) *y = __tc_touch_cached_y;`,
      `  if (z) *z = __tc_touch_cached_z;`,
      `  __tc_touch_cached_valid = 0;`,
      `}`,
    ].join("\n"),
  };
}
