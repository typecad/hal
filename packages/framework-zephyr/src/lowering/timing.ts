// ---------------------------------------------------------------------------
// Timing lowering — Zephyr kernel timing
//
// delay/millis/delay_microseconds/micros/free_heap lower directly. The four
// timer ops (set_interval/set_timeout/clear_interval/clear_timeout) call the
// timer_methods polyfill helpers (k_timer + k_work pool), declared as 'polyfill'
// status in the manifest — the validator skips the resolver probe for these
// (they legitimately return polyfill-helper calls, not direct lowering).
// free_heap has no portable Zephyr query without CONFIG_SYS_HEAP_RUNTIME_STATS;
// it returns 0 with a comment (honest limitation).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Resolve a HAL timing.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerTiming(
  op: HALOpIR,
): { code?: string; expression?: string } {
  const o = op as any;

  switch (op.operation) {
    case 'timing.sleep':
      // Time.sleep — yielding ms sleep (k_msleep), delay()'s replacement.
      return { code: `k_msleep(${o.ms});` };
    case 'timing.now':
      // Time.now — ms since boot as a double (k_uptime_get is int64_t ms).
      return { expression: 'static_cast<double>(k_uptime_get())' };
    case 'timing.now_us':
      // Time.nowUs — µs since boot; a double holds µs exactly for ~285 years.
      return { expression: 'static_cast<double>(k_cyc_to_us_floor64(k_cycle_get_64()))' };
    case 'timing.busy_wait_us':
      // Time.busyWaitUs — spin, no yield; delayMicroseconds's honest name.
      return { code: `k_busy_wait(${o.us});` };
    // JS-named timers — polyfill-backed (__tc_setInterval/__tc_setTimeout via
    // the timer_methods k_timer+k_work pool). Declared 'polyfill' in the
    // manifest, so the validator skips the resolver probe.
    case 'timing.set_interval':
      return { expression: `__tc_setInterval(${o.handler}, ${o.timeout})` };
    case 'timing.set_timeout':
      return { expression: `__tc_setTimeout(${o.handler}, ${o.timeout})` };
    case 'timing.clear_interval':
      return { code: `__tc_clearInterval(${o.id});` };
    case 'timing.clear_timeout':
      return { code: `__tc_clearTimeout(${o.id});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}

