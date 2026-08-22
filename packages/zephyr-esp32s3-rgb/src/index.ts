// ---------------------------------------------------------------------------
// @typecad/zephyr-esp32s3-rgb — onboard WS2812 RGB LED (ESP32-S3 DevKitC)
//
// A cuttlefish *library package*: `npm install @typecad/zephyr-esp32s3-rgb`,
// then import and use it like any other TypeScript module. The cuttlefish
// transpiler resolves the import to the native shim header (`__tc_rgbled.h`)
// and emits the shim + devicetree overlay + Kconfig into the generated Zephyr
// application — the class below is never executed, it is the typed API
// contract your editor sees. The C++ class in shims/__tc_rgbled.h is the
// implementation this type describes.
//
// Board facts carried by this library (instead of by you):
//   - WS2812 ("NeoPixel") on GPIO48 (DevKitC v1.0; v1.1 moved it to GPIO38)
//   - driven through the I2S0 peripheral (upstream Zephyr's own configuration
//     for this board — samples/drivers/led/led_strip)
//   - GRB wire order handled by the devicetree color-mapping
// ---------------------------------------------------------------------------

/**
 * The onboard addressable RGB LED.
 *
 * Buffers color/brightness locally; `show()` pushes one pixel to the strip.
 * All modifiers chain and return the same instance.
 */
export class RgbLed {
  /**
   * Set the LED color from 8-bit components (0–255 each).
   * The LED does not change until `show()` is called.
   */
  color(r: number, g: number, b: number): this;

  /**
   * Set the LED color from a CSS-style hex string
   * (`'#00ff00'` or `'00ff00'`). Invalid input is ignored.
   * The LED does not change until `show()` is called.
   */
  color(hex: string): this;

  color(rOrHex: number | string, g?: number, b?: number): this {
    // Types-only — lowered to the RgbLed C++ shim by the transpiler.
    return this;
  }

  /**
   * Scale output brightness (0–255, default 255). Applied at `show()` time,
   * so the buffered full-brightness color is preserved.
   */
  brightness(scale: number): this {
    return this;
  }

  /** Push the buffered color to the LED. */
  show(): this {
    return this;
  }

  /** Turn the LED off immediately (black + show). */
  off(): this {
    return this;
  }
}

/**
 * The board's onboard RGB LED — the instance to use. A preconstructed
 * singleton (rather than `new RgbLed()`) so the generated C++ stays a plain
 * static instance with zero heap use.
 */
export const rgbLed: RgbLed = new RgbLed();
