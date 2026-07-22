import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/** Resolve a HAL timing.* op to ESP-IDF C++.
 *  Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 *  Throws on timer ops (set_interval/etc.) — those are lowered via the
 *  __tc_Timing polyfill in generateNativePolyfills (Task 10), not here. */
export function lowerTiming(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'timing.delay':
      // Cooperative delay: pumps setInterval/setTimeout when timer_methods
      // registers __tc_coop_poll_hook. A bare vTaskDelay in setup()'s
      // while(true) never returns to loop(), so timers would never fire.
      return { code: `__tc_delay(${o.ms});` };
    case 'timing.delay_microseconds':
      return { code: `esp_rom_delay_us(${o.us});` };
    case 'timing.millis':
      return { expression: `(esp_timer_get_time() / 1000)` };
    case 'timing.micros':
      return { expression: `esp_timer_get_time()` };
    case 'timing.free_heap':
      return { expression: `esp_get_free_heap_size()` };
    case 'timing.set_interval':
    case 'timing.set_timeout':
    case 'timing.clear_interval':
    case 'timing.clear_timeout':
      // Handled by __tc_Timing polyfill in generateNativePolyfills (Task 10).
      // Throwing here surfaces a programming error: these ops should be lowered
      // by the polyfill, not directly emitted.
      throw new Error(`timing timer op ${op.operation} must be lowered via __tc_Timing polyfill, not lowerTiming().`);
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
