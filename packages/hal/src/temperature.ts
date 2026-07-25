/**
 * TemperatureClass — on-chip die temperature sensor.
 *
 * Lowered to the temp.* HAL op: ESP-IDF's temperature_sensor driver reads the
 * internal die temperature in °C. Useful for thermal monitoring and
 * compensation. No external components required.
 */
export class TemperatureClass {
  static readonly __instance_name = "Temperature";

  /** Read the on-chip die temperature in degrees Celsius. */
  read(): number {
    return tempRead();
  }
}

export const Temperature = new TemperatureClass();

// ── Semantic primitive (resolved to temp.* HAL op by the transpiler) ──
export function tempRead(): number { return 0; }
