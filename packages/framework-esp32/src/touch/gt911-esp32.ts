// ---------------------------------------------------------------------------
// ESP32 native GT911 touch adapter — capacitive I2C touch controller.
//
// Register protocol sourced from the GT911 Programming Guide (Goodix
// Technology). No third-party library was studied for this implementation —
// the register map (status 0x814E, coordinates 0x8150, 16-bit big-endian
// register addressing) is from the manufacturer datasheet.
//
// The implementation (ESP-IDF i2c_master transactions) is independently
// written.
//
// The GT911 (Goodix) supports up to 5 simultaneous touch points, uses 16-bit
// register addresses, and requires a config-write on init for reliable
// operation. This adapter reads a single touch point (the runtime's
// ui_poll_touch is single-touch) from the coordinate registers.
//
// I2C address depends on the INT pin state at reset: 0x5D when INT is high,
// 0x14 when INT is low. The user must supply the correct address via
// display.touch.i2cAddress (default 0x5D).
//
// Uses the shared I2C bus store (__esp32_i2c_bus_get) so it coexists with
// I2C displays and user I2C sensors.
// ---------------------------------------------------------------------------

import type { TouchProfile } from "@typecad/cuttlefish/api/shared";
import type { TouchAdapterCodegen } from "./ft6336u-esp32.js";

export function esp32Gt911TouchAdapter(touch: TouchProfile): TouchAdapterCodegen {
  const addr = touch.i2cAddress ?? 0x5D;
  const addrHex = "0x" + addr.toString(16);
  const i2cFrequency = touch.i2cFrequency ?? 400000;

  return {
    includes: [
      `// --- ESP32 GT911 touch driver (I2C capacitive, 16-bit registers) ---`,
      `// No vendor touch library, no Arduino Wire header.`,
      `#include "driver/i2c_master.h"`,
      `#include "driver/gpio.h"`,
    ],

    declaration: [
      `// ESP32 GT911 touch I2C state — device handle on the shared I2C bus.`,
      `struct __Esp32Gt911Ctx {`,
      `  i2c_master_dev_handle_t dev;`,
      `  bool ready;`,
      `};`,
      `static __Esp32Gt911Ctx __esp32_gt911 = { NULL, false };`,
      `static int16_t __esp32_touch_cached_x = 0;`,
      `static int16_t __esp32_touch_cached_y = 0;`,
      `static int16_t __esp32_touch_cached_z = 0;`,
      `static uint8_t __esp32_touch_cached_valid = 0;`,
    ].join('\n'),

    functions: [
      `// Read N bytes from a 16-bit register address (GT911 uses big-endian`,
      `// 16-bit register addresses: low byte first, high byte second).`,
      `static inline uint8_t __esp32_gt911_read_block(uint16_t reg, uint8_t* buf, uint8_t len) {`,
      `  if (!__esp32_gt911.dev) return 0;`,
      `  uint8_t regbuf[2] = { (uint8_t)(reg & 0xFF), (uint8_t)(reg >> 8) };`,
      `  esp_err_t err = i2c_master_transmit_receive(__esp32_gt911.dev, regbuf, 2, buf, len, pdMS_TO_TICKS(50));`,
      `  return (err == ESP_OK) ? 1 : 0;`,
      `}`,
      ``,
      `// Write to a 16-bit register address.`,
      `static inline void __esp32_gt911_write_reg(uint16_t reg, uint8_t val) {`,
      `  if (!__esp32_gt911.dev) return;`,
      `  uint8_t buf[3] = { (uint8_t)(reg & 0xFF), (uint8_t)(reg >> 8), val };`,
      `  i2c_master_transmit(__esp32_gt911.dev, buf, 3, pdMS_TO_TICKS(50));`,
      `}`,
      ``,
      `// GT911 register map.`,
      `#define GT911_STATUS_REG    0x814E  // bit 7 = data ready, bits[3:0] = touch count`,
      `#define GT911_COORDS_REG    0x8150  // first touch point data`,
      `#define GT911_CONFIG_REG    0x8040  // config start`,
      `#define GT911_COMMAND_REG   0x8040  // config fresh bit 0`,
      ``,
      `static inline void touch_init() {`,
      `  i2c_master_bus_handle_t bus = __esp32_i2c_bus_get(0);`,
      `  if (bus && !__esp32_gt911.dev) {`,
      `    i2c_device_config_t dcfg = {};`,
      `    dcfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;`,
      `    dcfg.device_address = ${addrHex};`,
      `    dcfg.scl_speed_hz = ${i2cFrequency};`,
      `    if (i2c_master_bus_add_device(bus, &dcfg, &__esp32_gt911.dev) != ESP_OK) {`,
      `      __esp32_gt911.dev = NULL;`,
      `    }`,
      `  }`,
      `  __esp32_gt911.ready = (__esp32_gt911.dev != NULL);`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  if (!__esp32_gt911.ready) return false;`,
      `  __esp32_touch_cached_valid = 0;`,
      `  __esp32_touch_cached_z = 0;`,
      `  // Read status register: bit 7 = buffer ready, bits[3:0] = touch count.`,
      `  uint8_t status = 0;`,
      `  if (!__esp32_gt911_read_block(GT911_STATUS_REG, &status, 1)) return false;`,
      `  uint8_t count = status & 0x0F;`,
      `  // Clear the "buffer ready" flag by writing 0 to the status register.`,
      `  __esp32_gt911_write_reg(GT911_STATUS_REG, 0x00);`,
      `  if (count == 0) return false;`,
      `  // Read first touch point: 6 bytes at GT911_COORDS_REG.`,
      `  // Layout: track_id, x_h, x_l, y_h, y_l, area (size).`,
      `  uint8_t data[6] = {0, 0, 0, 0, 0, 0};`,
      `  if (!__esp32_gt911_read_block(GT911_COORDS_REG, data, 6)) return false;`,
      `  __esp32_touch_cached_x = (int16_t)(((uint16_t)(data[1] & 0x0F) << 8) | data[2]);`,
      `  __esp32_touch_cached_y = (int16_t)(((uint16_t)(data[3] & 0x0F) << 8) | data[4]);`,
      `  __esp32_touch_cached_z = 255;  // capacitive — no real pressure`,
      `  __esp32_touch_cached_valid = 1;`,
      `  return true;`,
      `}`,
      ``,
      `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
      `  if (!__esp32_touch_cached_valid) {`,
      `    (void)touch_isTouched();`,
      `  }`,
      `  if (x) *x = __esp32_touch_cached_x;`,
      `  if (y) *y = __esp32_touch_cached_y;`,
      `  if (z) *z = __esp32_touch_cached_z;`,
      `  __esp32_touch_cached_valid = 0;`,
      `}`,
    ].join('\n'),
  };
}
