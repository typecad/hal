// ---------------------------------------------------------------------------
// ESP32 native CST816S touch adapter — capacitive I2C touch controller.
//
// Register protocol sourced from the CST816S datasheet (Hynitron
// Semiconductor). No third-party library was studied for this implementation
// — the register map (touch count at 0x02, coordinates at 0x03-0x06) is from
// the manufacturer datasheet. The layout is nearly identical to the FT6336U.
//
// The implementation (ESP-IDF i2c_master transactions) is independently
// written.
//
// The CST816S is a simple single-touch I2C capacitive controller (common on
// budget TFT modules). Its register map is nearly identical to the FT6336U:
// register 0x02 holds the touch count, 0x03-0x06 hold x/y coordinates.
//
// I2C address 0x15 (default). Uses the shared I2C bus store.
// ---------------------------------------------------------------------------

import type { TouchProfile } from "@typecad/cuttlefish/api/shared";
import type { TouchAdapterCodegen } from "./ft6336u-esp32.js";

export function esp32Cst816sTouchAdapter(touch: TouchProfile): TouchAdapterCodegen {
  const addr = touch.i2cAddress ?? 0x15;
  const addrHex = "0x" + addr.toString(16);
  const i2cFrequency = touch.i2cFrequency ?? 400000;

  return {
    includes: [
      `// --- ESP32 CST816S touch driver (I2C capacitive) ---`,
      `// No vendor touch library, no Arduino Wire header.`,
      `#include "driver/i2c_master.h"`,
      `#include "driver/gpio.h"`,
    ],

    declaration: [
      `// ESP32 CST816S touch I2C state — device handle on the shared I2C bus.`,
      `struct __Esp32Cst816sCtx {`,
      `  i2c_master_dev_handle_t dev;`,
      `  bool ready;`,
      `};`,
      `static __Esp32Cst816sCtx __esp32_cst816s = { NULL, false };`,
      `static int16_t __esp32_touch_cached_x = 0;`,
      `static int16_t __esp32_touch_cached_y = 0;`,
      `static int16_t __esp32_touch_cached_z = 0;`,
      `static uint8_t __esp32_touch_cached_valid = 0;`,
    ].join('\n'),

    functions: [
      `// Read N bytes from a register address (single-byte reg, like FT6336U).`,
      `static inline uint8_t __esp32_cst816s_read_block(uint8_t reg, uint8_t* buf, uint8_t len) {`,
      `  if (!__esp32_cst816s.dev) return 0;`,
      `  esp_err_t err = i2c_master_transmit_receive(__esp32_cst816s.dev, &reg, 1, buf, len, pdMS_TO_TICKS(50));`,
      `  return (err == ESP_OK) ? 1 : 0;`,
      `}`,
      ``,
      `static inline void touch_init() {`,
      `  i2c_master_bus_handle_t bus = __esp32_i2c_bus_get(0);`,
      `  if (bus && !__esp32_cst816s.dev) {`,
      `    i2c_device_config_t dcfg = {};`,
      `    dcfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;`,
      `    dcfg.device_address = ${addrHex};`,
      `    dcfg.scl_speed_hz = ${i2cFrequency};`,
      `    if (i2c_master_bus_add_device(bus, &dcfg, &__esp32_cst816s.dev) != ESP_OK) {`,
      `      __esp32_cst816s.dev = NULL;`,
      `    }`,
      `  }`,
      `  __esp32_cst816s.ready = (__esp32_cst816s.dev != NULL);`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  if (!__esp32_cst816s.ready) return false;`,
      `  __esp32_touch_cached_valid = 0;`,
      `  __esp32_touch_cached_z = 0;`,
      `  // CST816S register map (nearly identical to FT6336U):`,
      `  // 0x02 = touch count (bits[3:0])`,
      `  // 0x03..0x06 = event_flag+x_h, x_l, y_h, y_l`,
      `  uint8_t buf[5] = {0, 0, 0, 0, 0};`,
      `  if (!__esp32_cst816s_read_block(0x02, buf, 5)) return false;`,
      `  uint8_t count = buf[0] & 0x0F;`,
      `  if (count == 0) return false;`,
      `  __esp32_touch_cached_x = static_cast<int16_t>((static_cast<uint16_t>(buf[1] & 0x0F) << 8) | buf[2]);`,
      `  __esp32_touch_cached_y = static_cast<int16_t>((static_cast<uint16_t>(buf[3] & 0x0F) << 8) | buf[4]);`,
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
