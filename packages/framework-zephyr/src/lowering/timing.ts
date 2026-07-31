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
    case 'timing.delay': {
      // Milliseconds — k_msleep is the blocking Zephyr call. Because
      // isRtosTarget() returns true, the transpiler does not warn about
      // blocking delays inside loop().
      const ms = o.ms;
      return { code: `k_msleep(${ms});` };
    }
    case 'timing.delay_microseconds': {
      // k_busy_wait spins (does not yield); for cooperative μs delays.
      return { code: `k_busy_wait(${o.us});` };
    }
    case 'timing.millis':
      // k_uptime_get_32() returns int64_t milliseconds since boot. Cast to the
      // Arduino-millis() return type (uint32_t) so overflow wraps identically.
      return { expression: 'static_cast<uint32_t>(k_uptime_get_32())' };
    case 'timing.micros': {
      // Convert hardware cycles to microseconds. k_cycle_get_32 + the cycles/sec
      // macro (note: sys_clock_hw_cycles_per_sec is a MACRO — needs parens).
      return {
        expression: '(uint32_t)(((uint64_t)k_cycle_get_32() * 1000000ULL) / sys_clock_hw_cycles_per_sec())',
      };
    }
    case 'timing.free_heap':
      // No portable free-heap query without CONFIG_SYS_HEAP_RUNTIME_STATS.
      // Return 0 with a comment so callers don't get a link error.
      return { expression: '(0 /* free_heap: enable CONFIG_SYS_HEAP_RUNTIME_STATS for real value */)' };
    case 'timing.set_interval':
      // Backed by the timer_methods polyfill (k_timer + k_work). The callback is
      // a lowered function pointer; ms is the repeat period.
      return { expression: `__tc_setInterval(${o.callback}, ${o.ms})` };
    case 'timing.set_timeout':
      // One-shot: k_timer with K_FOREVER period.
      return { expression: `__tc_setTimeout(${o.callback}, ${o.ms})` };
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

