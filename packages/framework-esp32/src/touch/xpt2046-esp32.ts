// ---------------------------------------------------------------------------
// ESP32 native XPT2046 touch adapter — resistive SPI touch controller.
//
// ──── MIT attribution ─────────────────────────────────────────────────────
// The XPT2046 read sequence (Z1/Z2 pressure computation, 3x oversample,
// best-two-average filter, and channel command bytes) is transcribed from:
//
//   XPT2046_Touchscreen.cpp / XPT2046_Touchscreen.h
//   Copyright (c) 2015, Paul Stoffregen, paul@pjrc.com
//   Licensed under the MIT License.
//   Upstream: https://github.com/PaulStoffregen/XPT2046_Touchscreen
//
// The command bytes (0xB1=Z1, 0xC1=Z2, 0x91=X, 0xD1=Y) and the pressure
// formula (z = 4095 + z1 - z2) are from the XPT2046/ADS7843 datasheet.
// The best-two-average filter is a generic signal-processing technique.
// The implementation (ESP-IDF spi_device_polling_transmit full-duplex) is
// independently written.
// ──── End MIT attribution ─────────────────────────────────────────────────
//
// The XPT2046 is a streaming SAR ADC: send a command byte to select a channel,
// read the 12-bit result during the NEXT command's transfer (full-duplex).
// Pressure is computed from Z1 and Z2 channel readings: z = 4095 + z1 - z2.
// Touch is registered when z ≥ 400 (matching the Adafruit XPT2046_Touchscreen
// Z_THRESHOLD).
//
// Shares SPI2_HOST with the display (standard 4-wire SPI touch topology:
// shared MOSI/MISO/SCK, separate CS). 2 MHz, SPI mode 0.
//
// Register protocol transcribed from Adafruit XPT2046_Touchscreen.cpp update().
// ---------------------------------------------------------------------------

import type { TouchProfile } from "@typecad/cuttlefish/api/shared";
import { emitSpiTouchHelpers, emitSpiTouchXfer16, emitSpiTouchCS } from "./spi-touch-helpers.js";
import type { TouchAdapterCodegen } from "./ft6336u-esp32.js";

export function esp32Xpt2046TouchAdapter(touch: TouchProfile): TouchAdapterCodegen {
  const cs = touch.cs;
  if (cs === undefined || cs < 0) {
    throw new Error(
      `XPT2046 native touch adapter requires display.touch.cs (a GPIO connected ` +
      `to the controller's CS line). Set it in cuttlefish.config.ts: ` +
      `display: { touch: { ..., cs: <gpio> } }.`,
    );
  }

  const helpers = emitSpiTouchHelpers(cs, 2_000_000, 0); // 2 MHz, SPI mode 0

  return {
    includes: [
      `// --- ESP32 XPT2046 touch driver (SPI resistive, full-duplex ADC) ---`,
      `// No vendor touch library, no Arduino SPI header.`,
      ...helpers.includes,
    ],

    declaration: [
      helpers.declaration,
      `// Cached touch coordinates from the last touch_isTouched() probe.`,
      `static int16_t __esp32_touch_cached_x = 0;`,
      `static int16_t __esp32_touch_cached_y = 0;`,
      `static int16_t __esp32_touch_cached_z = 0;`,
      `static uint8_t __esp32_touch_cached_valid = 0;`,
    ].join('\n'),

    functions: [
      emitSpiTouchCS(),
      emitSpiTouchXfer16(),
      ``,
      `// Best-two-of-three average (noise filter from the Adafruit library).`,
      `static inline int16_t __esp32_touch_besttwo(int16_t x, int16_t y, int16_t z) {`,
      `  int16_t d01 = x > y ? x - y : y - x;`,
      `  int16_t d02 = x > z ? x - z : z - x;`,
      `  int16_t d12 = y > z ? y - z : z - y;`,
      `  if (d01 <= d02 && d01 <= d12) return (x + y) / 2;`,
      `  if (d02 <= d12) return (x + z) / 2;`,
      `  return (y + z) / 2;`,
      `}`,
      ``,
      `static inline void touch_init() {`,
      helpers.initLines,
      `}`,
      ``,
      `// XPT2046 command bytes (bits [7:6]=A2A1A0 channel select, bit 2=SER,`,
      `// bits [1:0]=power-down mode). 0xB0=Z1, 0xC0=Z2, 0x90=X, 0xD0=Y.`,
      `// Bit 0 set = "read during next transfer" (no power-down between).`,
      `#define XPT_CMD_Z1  0xB1`,
      `#define XPT_CMD_Z2  0xC1`,
      `#define XPT_CMD_X   0x91`,
      `#define XPT_CMD_Y   0xD1`,
      `#define XPT_CMD_Y_PWDN 0xD0  // last read, powers down ADC`,
      `#define XPT_Z_THRESHOLD 400`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  if (!__esp32_spi_touch.ready) return false;`,
      `  __esp32_touch_cached_valid = 0;`,
      `  __esp32_touch_cached_z = 0;`,
      `  __esp32_touch_cs_low();`,
      `  // Z1 + Z2 → pressure. Result of each xfer16 is from the PREVIOUS cmd.`,
      `  __esp32_touch_xfer16(XPT_CMD_Z1);               // send Z1 cmd (result is garbage)`,
      `  int16_t z1 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_Z2) >> 3);  // Z1 result + send Z2`,
      `  int16_t z2 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_X) >> 3);   // Z2 result + send X`,
      `  int16_t pressure = 4095 + z1 - z2;`,
      `  if (pressure < XPT_Z_THRESHOLD) {`,
      `    // Not enough pressure — flush and power down.`,
      `    __esp32_touch_xfer16(XPT_CMD_Y_PWDN);`,
      `    __esp32_touch_cs_high();`,
      `    return false;`,
      `  }`,
      `  // 3x oversample X and Y (first X is a dummy — noisy).`,
      `  __esp32_touch_xfer16(XPT_CMD_X);                 // dummy X (result from Z2 cmd)`,
      `  int16_t y0 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_Y) >> 3);   // Y sample 0`,
      `  int16_t x0 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_X) >> 3);   // X sample 0`,
      `  int16_t y1 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_Y) >> 3);   // Y sample 1`,
      `  int16_t x1 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_X) >> 3);   // X sample 1`,
      `  int16_t y2 = static_cast<int16_t>(__esp32_touch_xfer16(XPT_CMD_Y_PWDN) >> 3); // Y sample 2 (powers down)`,
      `  __esp32_touch_xfer16(0x00);                      // flush (read last result)`,
      `  __esp32_touch_cs_high();`,
      `  // Best-two-average filter for noise resilience.`,
      `  __esp32_touch_cached_x = __esp32_touch_besttwo(x0, x1, x0);  // 2 X samples (dummy was Y slot)`,
      `  __esp32_touch_cached_y = __esp32_touch_besttwo(y0, y1, y2);`,
      `  __esp32_touch_cached_z = pressure;`,
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
