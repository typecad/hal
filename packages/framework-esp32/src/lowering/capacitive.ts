import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

/**
 * Native ESP-IDF capacitive touch pins. ESP32-family chips have dedicated
 * capacitive-sensing GPIOs driven by the touch_sensor peripheral (distinct
 * from the I2C/SPI touch *display* controllers). This shim maps a touch-capable
 * GPIO to its touch channel and reads the raw count via touch_pad_read_raw().
 *
 * The init is lazy: the first read initializes the touch peripheral once.
 * Forced include (driver/touch_sensor.h) is gated on usesCapacitive in
 * strategy.ts.
 */

export function capacitiveInitLines(): string[] {
  return [
    `// CUTTLEFISH_CAPACITIVE_BEGIN`,
    `#include "driver/touch_sensor.h"`,
    `static bool __tc_touch_inited = false;`,
    ``,
    `static inline void __tc_touch_ensure_init(void) {`,
    `    if (__tc_touch_inited) return;`,
    `    touch_pad_init();`,
    `    touch_pad_set_fsm_mode(TOUCH_FSM_MODE_TIMER);`,
    `    touch_pad_fsm_start();`,
    `    __tc_touch_inited = true;`,
    `}`,
    ``,
    `// Map a touch-capable GPIO to its touch channel index. On classic ESP32 the`,
    `// touch pads are T0..T9 on GPIO4,0,2,15,13,12,14,27,32,33 respectively. The`,
    `// channel index is what touch_pad_read_raw consumes. Returns -1 for pins`,
    `// that are not touch-capable.`,
    `static inline int __tc_touch_chan_for_gpio(int gpio) {`,
    `    // Classic ESP32 touch-capable GPIOs → touch channel.`,
    `    static const int map[][2] = {`,
    `        {4, 0}, {0, 1}, {2, 2}, {15, 3}, {13, 4},`,
    `        {12, 5}, {14, 6}, {27, 7}, {32, 8}, {33, 9},`,
    `    };`,
    `    for (int i = 0; i < 10; i++) {`,
    `        if (map[i][0] == gpio) return map[i][1];`,
    `    }`,
    `    return -1;`,
    `}`,
    ``,
    `static inline uint32_t __tc_capacitive_read(int gpio) {`,
    `    __tc_touch_ensure_init();`,
    `    int chan = __tc_touch_chan_for_gpio(gpio);`,
    `    if (chan < 0) return 0;`,
    `    touch_pad_set_channel_mask(BIT(chan));`,
    `    uint32_t val = 0;`,
    `    touch_pad_read_raw(chan, &val);`,
    `    return val;`,
    `}`,
    `// CUTTLEFISH_CAPACITIVE_END`,
    ``,
  ];
}

/** Resolve a HAL capacitive.* op to ESP-IDF C++. */
export function lowerCapacitive(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'capacitive.read':
      return { expression: `__tc_capacitive_read(${o.pin})` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
