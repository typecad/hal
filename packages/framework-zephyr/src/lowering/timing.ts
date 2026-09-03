// ---------------------------------------------------------------------------
// Timing lowering — Zephyr kernel timing
//
// sleep/now/now_us/busy_wait_us lower directly to kernel calls. Periodic or
// deferred work is NOT a timing op: it is a Thread (k_thread) or a Counter
// (hardware timer), each with its own lowering.
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
      // Time.nowUs — µs since boot, uptime-derived for EVERY board: the
      // cycle-counter form (k_cyc_to_us_floor64(k_cycle_get_64())) reads a
      // constant on SoCs without a free-running 64-bit counter, so the one
      // uniform expression that is monotonic and advancing everywhere is
      // the kernel uptime scaled to µs. Resolution is therefore the uptime
      // tick (millisecond), uniformly. A double holds µs exactly for ~285
      // years.
      return { expression: 'static_cast<double>(k_uptime_get() * 1000)' };
    case 'timing.busy_wait_us':
      // Time.busyWaitUs — spin, no yield; delayMicroseconds's honest name.
      return { code: `k_busy_wait(${o.us});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}

