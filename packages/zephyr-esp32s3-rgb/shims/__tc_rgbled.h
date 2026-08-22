// ---------------------------------------------------------------------------
// __tc_rgbled.h — RgbLed shim for @typecad/zephyr-esp32s3-rgb
//
// Emitted into the generated application's src/ by the cuttlefish transpiler
// when the @typecad/zephyr-esp32s3-rgb import is used. The TypeScript class
// in the package's src/index.ts is the typed contract; this class is the
// implementation. Calls render verbatim, so the method names and the global
// `rgbLed` instance are the API — do not rename one without the other.
//
// Targets the devicetree node aliased `led-strip` (contributed by this
// library's overlay fragment: WS2812 on GPIO48 via the I2S0 peripheral).
// AUTOSAR C++14 compliant (no heap, no C-style casts, fixed-width ints).
// ---------------------------------------------------------------------------

#ifndef TC_RGBLED_H_
#define TC_RGBLED_H_

#include <cstdint>
#include <zephyr/device.h>
#include <zephyr/drivers/led_strip.h>

class RgbLed final
{
public:
  RgbLed& color(std::uint8_t r, std::uint8_t g, std::uint8_t b);
  RgbLed& color(const char* hex);
  RgbLed& brightness(std::uint8_t scale);
  RgbLed& show();
  RgbLed& off();

private:
  static const struct device* strip_device();

  // Value-initialized: layout-agnostic (led_rgb may carry a leading scratch
  // member under CONFIG_LED_STRIP_RGB_SCRATCH).
  struct led_rgb pixel_{};
  std::uint8_t scale_ = 255U;
};

extern RgbLed rgbLed;

#endif  // TC_RGBLED_H_
