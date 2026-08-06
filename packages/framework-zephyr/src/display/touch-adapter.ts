// ---------------------------------------------------------------------------
// Zephyr touch adapter for the Cuttlefish UI rendering pipeline.
//
// FT6336U capacitive touch controller over I2C, driven via Zephyr's
// device-tree-bound I2C API (i2c_write_read_dt). This is the Zephyr analog of
// the Arduino FT6336U adapter in framework-arduino (touch-adapters-codegen.ts)
// and the stale native ESP32 reference (demo-display/.../main.cc).
//
// The touch node is resolved via DEVICE_DT_GET(DT_NODELABEL(ft6336u)). The
// board's devicetree must carry an `ft6336u` nodelabel with the I2C spec +
// the `focaltech,ft6336u` (or compatible) binding so the device is ready.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { TouchAdapterCodegen } from "@typecad/cuttlefish/api/shared";
import type { TouchProfile } from "@typecad/cuttlefish/api/shared";

/**
 * Generate the FT6336U touch adapter for Zephyr. Emits touch_init /
 * touch_isTouched / touch_readRaw — the three symbols the runtime's
 * ui_poll_touch body calls. Returns undefined for other libraries so the
 * strategy can decline.
 */
export function zephyrTouchAdapter(touch: TouchProfile): TouchAdapterCodegen | undefined {
  if (touch.library !== "FT6336U") return undefined;

  const addr = touch.i2cAddress ?? 0x38;
  const addrHex = "0x" + addr.toString(16).toUpperCase();

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
      `  // The I2C bus + device are configured by devicetree; nothing to do at`,
      `  // runtime beyond confirming readiness. The FT6336U self-resets on power-on.`,
      `  (void)device_is_ready(__tc_touch.bus);`,
      `  // Diagnostic: probe the chip ID + touch status so a dead bus (wrong`,
      `  // SDA/SCL wiring) is visible on serial instead of silently no-touch.`,
      `  {`,
      `    uint8_t __id = 0xFF;`,
      `    uint8_t __id_reg = 0xA3;`,
      `    int __rc = i2c_write_read_dt(&__tc_touch, &__id_reg, 1U, &__id, 1U);`,
      `    uint8_t __td[2] = {0, 0};`,
      `    uint8_t __td_reg = 0x02;`,
      `    int __rc2 = i2c_write_read_dt(&__tc_touch, &__td_reg, 1U, __td, 2U);`,
      `    printk("TC_TOUCH: bus_ready=%d id_reg(0xA3)=0x%02x rc=%d td_status(0x02)=0x%02x rc2=%d\\n",`,
      `           device_is_ready(__tc_touch.bus), __id, __rc, __td[0], __rc2);`,
      `  }`,
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
