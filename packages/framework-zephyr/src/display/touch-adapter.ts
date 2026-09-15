// ---------------------------------------------------------------------------
// Zephyr touch adapters for the TypeCAD UI rendering pipeline.
//
//   - FT6336U capacitive: through Zephyr's INPUT subsystem — the in-tree
//     focaltech,ft5336 driver owns the controller (polling mode: the node
//     carries no int-gpios, so the driver samples on a k_timer/work cycle
//     and no GPIO IRQ is registered — sidestepping the ESP32
//     VECDESC_FL_SHARED crash the direct-IRQ path hit). The adapter listens
//     for the device's INPUT events and serves the runtime's
//     touch_init/isTouched/readRaw contract from the latest event state.
//     Hardware-verified on the demo rig (ESP32-S3 + FT6336U, SDA8/SCL9).
//   - XPT2046 resistive: raw SPI polling (spi_transceive_dt) — the Zephyr
//     analog of Arduino's XPT2046_Touchscreen adapter. NOT yet on the input
//     subsystem: the in-tree xpt2046 driver scales coordinates through its
//     DT min-x/max-x props, which would double-apply the runtime's
//     calibration math (touch_readRaw must stay in raw controller units for
//     ui_poll_touch's calibration + rotation). Converting needs the DT
//     scaling reconciled with the config calibration — and hardware to
//     verify it on. CONFIG_INPUT stays off for xpt2046-only builds.
//
// The adapters emit touch_init / touch_isTouched / touch_readRaw — the three
// symbols the runtime's ui_poll_touch body calls. For FT6336U the raw
// coordinate space is unchanged (X/Y controller registers, native portrait
// panel units): the overlay's swapped-xy property makes the driver's ABS_X/
// ABS_Y events carry the register values verbatim, so ui_poll_touch's
// calibration + rotation math applies as before.
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
      `#include <zephyr/kernel.h>`,
      `#include <zephyr/input/input.h>`,
      // TEMPORARY DIAGNOSTIC (with __tc_touch_diag above).
      `#include <zephyr/drivers/i2c.h>`,
    ],
    declaration: [
      `// Zephyr FT6336U touch — INPUT subsystem listener. The in-tree`,
      `// focaltech,ft5336 driver (CONFIG_INPUT_FT5336, polling mode — no`,
      `// int-gpios on the node) owns the controller and reports events; this`,
      `// adapter keeps the latest state and serves the runtime's per-frame`,
      `// touch_isTouched/touch_readRaw poll. The overlay's swapped-xy DT prop`,
      `// makes the driver's ABS_X/ABS_Y carry the controller's X/Y registers`,
      `// verbatim — the same raw space the register-polling adapter reported,`,
      `// so the runtime's calibration + rotation math is unchanged.`,
      `static int16_t __tc_touch_cached_x = 0;`,
      `static int16_t __tc_touch_cached_y = 0;`,
      `static volatile bool __tc_touch_down = false;`,
    ].join("\n"),
    functions: [
      `// Input listener: runs in the driver's work-handler context (poll mode`,
      `// samples every CONFIG_INPUT_FT5336_PERIOD ms). Latest-value semantics —`,
      `// plain int16 stores with no locking; the UI loop reads them once per`,
      `// frame and a torn mid-write read only ever costs one sample of one axis.`,
      `// The first events are logged once — a diagnostic that costs ten lines`,
      `// ever and immediately answers "are events arriving, and in which space".`,
      `static uint8_t __tc_touch_evt_logged = 0U;`,
      `static void __tc_touch_input_cb(struct input_event* evt, void* /*user_data*/) {`,
      `  if (__tc_touch_evt_logged < 10U) {`,
      `    __tc_touch_evt_logged++;`,
      `    printk("TC_TOUCH: evt type=%u code=%u value=%d sync=%u\\n",`,
      `           static_cast<unsigned int>(evt->type),`,
      `           static_cast<unsigned int>(evt->code),`,
      `           static_cast<int>(evt->value),`,
      `           static_cast<unsigned int>(evt->sync));`,
      `  }`,
      `  if (evt->type == INPUT_EV_ABS) {`,
      `    if (evt->code == INPUT_ABS_X) {`,
      `      __tc_touch_cached_x = static_cast<int16_t>(evt->value);`,
      `    } else if (evt->code == INPUT_ABS_Y) {`,
      `      __tc_touch_cached_y = static_cast<int16_t>(evt->value);`,
      `    }`,
      `  } else if ((evt->type == INPUT_EV_KEY) && (evt->code == INPUT_BTN_TOUCH)) {`,
      `    __tc_touch_down = (evt->value != 0);`,
      `  }`,
      `}`,
      ``,
      `// Registered for the ft6336u device's events only (the _dev filter) —`,
      `// other input devices on the system never reach the UI touch state.`,
      `INPUT_CALLBACK_DEFINE(DEVICE_DT_GET(DT_NODELABEL(ft6336u)), __tc_touch_input_cb, NULL);`,
      ``,
      `static inline void touch_init() {`,
      `  // Power/reset enable — rig-verified sequence, matching the Arduino`,
      `  // pin order this module needs (GPIO driven LOW 10ms, then HIGH, then`,
      `  // 500ms settle before the controller answers). Without the drive the`,
      `  // enable floats: the controller half-powers, ACKs briefly, then`,
      `  // browns out — the 0xFF-then-NAK bus death reproduced identically on`,
      `  // every firmware variant until this was wired. The in-tree driver`,
      `  // pulses its own (shorter) reset at init; this re-drive with the`,
      `  // verified timing runs from main before the UI starts polling.`,
      `#if DT_NODE_HAS_STATUS(DT_NODELABEL(ft6336u), okay) && DT_NODE_HAS_PROP(DT_NODELABEL(ft6336u), reset_gpios)`,
      `  static const struct gpio_dt_spec __tc_touch_en = GPIO_DT_SPEC_GET(DT_NODELABEL(ft6336u), reset_gpios);`,
      `  if (device_is_ready(__tc_touch_en.port)) {`,
      `    gpio_pin_configure_dt(&__tc_touch_en, GPIO_OUTPUT_ACTIVE);   // drive LOW (active-low spec)`,
      `    k_msleep(10);`,
      `    gpio_pin_set_dt(&__tc_touch_en, 0);                          // drive HIGH`,
      `    k_msleep(500);`,
      `  }`,
      `#endif`,
      `  const struct device* __tc_touch_dev = DEVICE_DT_GET(DT_NODELABEL(ft6336u));`,
      `  if (!device_is_ready(__tc_touch_dev)) {`,
      `    printk("TC_TOUCH: ft6336u device not ready\\n");`,
      `    return;`,
      `  }`,
      `  // Self-test: dispatch one synthetic release event through the input`,
      `  // core. If the listener is registered and dispatch works, the event`,
      `  // logger above prints it; rc=-EAGAIN means the input queue is full`,
      `  // (input thread wedged). K_NO_WAIT so a dead queue can never block`,
      `  // boot.`,
      `  int __rc = input_report_key(__tc_touch_dev, INPUT_BTN_TOUCH, 0, true, K_NO_WAIT);`,
      `  printk("TC_TOUCH: ft6336u ready, self-test report rc=%d\\n", __rc);`,
      `}`,
      ``,
      `// Boot-time bus diagnostic (self-limiting): reads TD_STATUS directly`,
      `// over I2C — the register path the raw adapter proved on this rig —`,
      `// dense (300ms) for the first 5s, sparse (3s) until 60s, then silent.`,
      `// On the demo rig this caught a failing touch module: the controller`,
      `// ACKs for the first ~700ms after every reset, returns 0xFF once, then`,
      `// NAKs permanently — a power/connection fault, independent of firmware`,
      `// (reproduced identically on the committed pre-migration build).`,
      `static const struct i2c_dt_spec __tc_touch_probe = I2C_DT_SPEC_GET(DT_NODELABEL(ft6336u));`,
      `static int32_t __tc_touch_probe_next = 0;`,
      `static void __tc_touch_diag() {`,
      `  int32_t __now = static_cast<int32_t>(k_uptime_get_32());`,
      `  if (__now >= 60000) return;`,
      `  int32_t __gap = (__now < 5000) ? 300 : 3000;`,
      `  if (__now < __tc_touch_probe_next) return;`,
      `  __tc_touch_probe_next = __now + __gap;`,
      `  uint8_t __td = 0U;`,
      `  uint8_t __reg = 0x02U;`,
      `  int __rc = i2c_write_read_dt(&__tc_touch_probe, &__reg, 1U, &__td, 1U);`,
      `  if ((__rc != 0) || (__td != 0U)) {`,
      `    printk("TC_TOUCH: diag td_status=0x%02x rc=%d down=%d\\n",`,
      `           static_cast<unsigned int>(__td), __rc,`,
      `           __tc_touch_down ? 1 : 0);`,
      `  }`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  __tc_touch_diag();`,
      `  return __tc_touch_down;`,
      `}`,
      ``,
      `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
      `  // Latest reported position in controller register units (native panel`,
      `  // space); the runtime applies calibration + rotation. z is saturation`,
      `  // for capacitive (the driver reports press/release, not pressure).`,
      `  if (x) *x = __tc_touch_cached_x;`,
      `  if (y) *y = __tc_touch_cached_y;`,
      `  if (z) *z = 255;`,
      `}`,
    ].join("\n"),
  };
}
