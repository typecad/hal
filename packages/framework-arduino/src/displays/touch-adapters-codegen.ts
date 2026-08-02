// ---------------------------------------------------------------------------
// Arduino touch-library adapters for @typecad/framework-arduino.
//
// Moved here from cuttlefish so cuttlefish carries no Arduino/Wiring-specific
// touch-library knowledge. ArduinoStrategy.providesTouchAdapter() returns true
// and resolveTouchAdapter() dispatches to generateArduinoTouchAdapter().
//
// Holds the four Adafruit/Arduino-ecosystem touch library branches:
//   - XPT2046_Touchscreen (SPI resistive)
//   - Adafruit_TouchScreen (4-wire analog resistive)
//   - Adafruit_STMPE610   (SPI resistive)
//   - FT6336U             (I2C capacitive, RAK14014_FT6336U driver)
//
// The generic/native touch path (sdl) stays in cuttlefish.
// ---------------------------------------------------------------------------

import type { TouchProfile, TouchAdapterCodegen } from "@typecad/cuttlefish/api/shared";

/** Generate C++ code for an Arduino built-in touch library adapter.
 *
 *  Returns undefined when `touch.library` is not one of the Arduino-ecosystem
 *  libraries handled here, so the caller (ArduinoStrategy.resolveTouchAdapter)
 *  can signal "no adapter" and let cuttlefish fall through to its generic path.
 */
export function generateArduinoTouchAdapter(touch: TouchProfile): TouchAdapterCodegen | undefined {
  const cs = touch.cs ?? 0;
  const irq = touch.irq;

  if (touch.library === "XPT2046_Touchscreen") {
    return {
      includes: ["#include <XPT2046_Touchscreen.h>"],
      declaration: `XPT2046_Touchscreen __tc_touch(${cs}${irq ? `, ${irq}` : ""});`,
      functions: [
        `static inline void touch_init() { __tc_touch.begin(); }`,
        `static inline bool touch_isTouched() { return __tc_touch.touched(); }`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  TS_Point __tp = __tc_touch.getPoint();`,
        `  if (x) *x = static_cast<int16_t>(__tp.x);`,
        `  if (y) *y = static_cast<int16_t>(__tp.y);`,
        `  if (z) *z = static_cast<int16_t>(__tp.z);`,
        `}`,
      ].join("\n"),
    };
  }

  if (touch.library === "Adafruit_TouchScreen" && touch.analogPins) {
    const a = touch.analogPins;
    return {
      includes: ["#include <TouchScreen.h>"],
      declaration: `TouchScreen __tc_touch = TouchScreen(${a.xp}, ${a.yp}, ${a.xm}, ${a.ym}, ${a.rx});`,
      functions: [
        `static inline void touch_init() {}`,
        `static inline bool touch_isTouched() { return __tc_touch.isTouching(); }`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  TS_Point __tp = __tc_touch.getPoint();`,
        `  if (x) *x = static_cast<int16_t>(__tp.x);`,
        `  if (y) *y = static_cast<int16_t>(__tp.y);`,
        `  if (z) *z = static_cast<int16_t>(__tp.z);`,
        `}`,
      ].join("\n"),
    };
  }

  if (touch.library === "Adafruit_STMPE610") {
    return {
      includes: ["#include <Adafruit_STMPE610.h>"],
      declaration: `Adafruit_STMPE610 __tc_touch(${cs});`,
      functions: [
        `static inline void touch_init() { __tc_touch.begin(); }`,
        `static inline bool touch_isTouched() { return __tc_touch.touched() && !__tc_touch.bufferEmpty(); }`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  TS_Point __tp = __tc_touch.getPoint();`,
        `  if (x) *x = static_cast<int16_t>(__tp.x);`,
        `  if (y) *y = static_cast<int16_t>(__tp.y);`,
        `  if (z) *z = static_cast<int16_t>(__tp.z);`,
        `}`,
      ].join("\n"),
    };
  }

  if (touch.library === "FT6336U") {
    const addr = touch.i2cAddress ?? 0x38;
    // I2C addresses are conventional in hex in Arduino code.
    const addrHex = "0x" + addr.toString(16).toUpperCase();
    const i2cFrequency = touch.i2cFrequency ?? 400000;
    const reset = touch.resetPin;
    const resetLines = reset
      ? [
          `  pinMode(${reset}, OUTPUT);`,
          `  digitalWrite(${reset}, LOW);`,
          `  delay(10);`,
          `  digitalWrite(${reset}, HIGH);`,
          `  delay(500);`,
        ].join("\n")
      : ``;
    return {
      includes: ["#include <Wire.h>", "#include <RAK14014_FT6336U.h>"],
      declaration: [
        `FT6336U __tc_touch(${addrHex});`,
        `static int16_t __tc_touch_cached_x = 0;`,
        `static int16_t __tc_touch_cached_y = 0;`,
        `static int16_t __tc_touch_cached_z = 0;`,
        `static uint8_t __tc_touch_cached_valid = 0;`,
      ].join("\n"),
      functions: [
        `static inline uint8_t __tc_ft6336u_read_block(uint8_t reg, uint8_t* buf, uint8_t len) {`,
        `  Wire.beginTransmission(${addrHex});`,
        `  Wire.write(reg);`,
        `  if (Wire.endTransmission(false) != 0) return 0;`,
        `  uint8_t got = Wire.requestFrom(static_cast<uint8_t>(${addrHex}), len);`,
        `  if (got < len) return 0;`,
        `  for (uint8_t i = 0; i < len; i++) {`,
        `    if (!Wire.available()) return 0;`,
        `    buf[i] = Wire.read();`,
        `  }`,
        `  return 1;`,
        `}`,
        `static inline void touch_init() {`,
        resetLines,
        `  __tc_touch.begin(Wire, ${addrHex});`,
        `  Wire.setClock(${i2cFrequency});`,
        `}`,
        `static inline bool touch_isTouched() {`,
        `  uint8_t buf[5] = {0, 0, 0, 0, 0};`,
        `  __tc_touch_cached_valid = 0;`,
        `  __tc_touch_cached_z = 0;`,
        `  if (!__tc_ft6336u_read_block(0x02, buf, 5)) return false;`,
        `  uint8_t count = buf[0] & 0x0F;`,
        `  if (count == 0) return false;`,
        `  __tc_touch_cached_x = static_cast<int16_t>((static_cast<uint16_t>(buf[1] & 0x0F) << 8) | buf[2]);`,
        `  __tc_touch_cached_y = static_cast<int16_t>((static_cast<uint16_t>(buf[3] & 0x0F) << 8) | buf[4]);`,
        `  __tc_touch_cached_z = 255;`,
        `  __tc_touch_cached_valid = 1;`,
        `  return true;`,
        `}`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
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

  return undefined;
}
