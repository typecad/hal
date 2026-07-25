/**
 * CapacitiveClass — ESP32 on-chip capacitive touch pins.
 *
 * ESP32-family chips have dedicated capacitive-sensing GPIOs (10 on classic
 * ESP32, up to 14 on S3) that read touch/proximity without external
 * components — distinct from the I2C/SPI touch *display* controllers (FT6336U,
 * GT911, etc.). Lowered to capacitive.* HAL ops: ESP-IDF's touch_sensor driver.
 *
 * Pin numbers are the touch-pad-capable GPIOs (GPIO4, GPIO0, GPIO2, ... on
 * classic ESP32); the framework maps them to touch_channel indices.
 */
export class CapacitiveClass {
  static readonly __instance_name = "Capacitive";

  /** Read the raw capacitive value of a touch pin. Higher = more capacitance
   *  (touched). The raw scale is chip-dependent; use a threshold calibrated
   *  against the untouched reading. */
  read(pin: number): number {
    return capacitiveRead(pin);
  }

  /** True when the pin's reading exceeds `threshold` (a convenience over read()). */
  isTouched(pin: number, threshold: number): boolean {
    return capacitiveRead(pin) > threshold;
  }
}

export const Capacitive = new CapacitiveClass();

// ── Semantic primitive (resolved to capacitive.* HAL op by the transpiler) ──
export function capacitiveRead(pin: number): number { return 0; }
