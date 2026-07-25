import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF die-temperature sensor. Uses the temperature_sensor driver
 * (driver/temperature_sensor.h on v5+, driver/temp_sensor.h on older releases).
 * The init is lazy: the first temp.read opens the sensor once and reuses it.
 *
 * Forced include (driver/temperature_sensor.h) is gated on usesTemp in
 * strategy.ts.
 */

export function tempInitLines(): string[] {
  return [
    `// CUTTLEFISH_TEMP_BEGIN`,
    `#include "driver/temperature_sensor.h"`,
    `static temperature_sensor_handle_t __tc_temp_handle = NULL;`,
    `static bool __tc_temp_started = false;`,
    ``,
    `static inline void __tc_temp_ensure_init(void) {`,
    `    if (__tc_temp_handle) return;`,
    `    temperature_sensor_config_t cfg = TEMPERATURE_SENSOR_CONFIG_DEFAULT(10, 50);`,
    `    temperature_sensor_install(&cfg, &__tc_temp_handle);`,
    `    temperature_sensor_enable(__tc_temp_handle);`,
    `    __tc_temp_started = true;`,
    `}`,
    ``,
    `static inline float __tc_temp_read(void) {`,
    `    __tc_temp_ensure_init();`,
    `    float tsens_value = 0;`,
    `    temperature_sensor_get_celsius(__tc_temp_handle, &tsens_value);`,
    `    return tsens_value;`,
    `}`,
    `// CUTTLEFISH_TEMP_END`,
    ``,
  ];
}

/** Resolve a HAL temp.* op to ESP-IDF C++. */
export function lowerTemp(op: HALOpIR): { code?: string; expression?: string } {
  switch (op.operation) {
    case 'temp.read':
      return { expression: '__tc_temp_read()' };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
