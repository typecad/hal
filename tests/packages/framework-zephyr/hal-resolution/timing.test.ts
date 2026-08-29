import { describe, it, expect } from 'vitest';
import { lowerTiming } from '../../../../packages/framework-zephyr/src/lowering/timing';
import { transpileZephyrStrategy, expectCppContains } from '../../../setup';

describe('timing lowering', () => {





  it('timer ops lower to polyfill helpers (no longer throw)', () => {
    expect(lowerTiming({ operation: 'timing.set_interval', handler: 'cb', timeout: 100 } as any))
      .toEqual({ expression: '__tc_setInterval(cb, 100)' });
    expect(lowerTiming({ operation: 'timing.set_timeout', handler: 'cb', timeout: 50 } as any))
      .toEqual({ expression: '__tc_setTimeout(cb, 50)' });
    expect(lowerTiming({ operation: 'timing.clear_interval', id: 2 } as any))
      .toEqual({ code: '__tc_clearInterval(2);' });
    expect(lowerTiming({ operation: 'timing.clear_timeout', id: 2 } as any))
      .toEqual({ code: '__tc_clearTimeout(2);' });
  });

  // ── Time.* — the TS-flavored surface (hal/time.ts) ──────────────────────
  it('Time.sleep → k_msleep', () => {
    expect(lowerTiming({ operation: 'timing.sleep', ms: 250 } as any))
      .toEqual({ code: 'k_msleep(250);' });
  });

  it('Time.now → k_uptime_get as double, no uint32 wrap (expression)', () => {
    expect(lowerTiming({ operation: 'timing.now' } as any))
      .toEqual({ expression: 'static_cast<double>(k_uptime_get())' });
  });

  it('Time.nowUs → k_cyc_to_us_floor64(k_cycle_get_64()) as double (expression)', () => {
    expect(lowerTiming({ operation: 'timing.now_us' } as any))
      .toEqual({ expression: 'static_cast<double>(k_cyc_to_us_floor64(k_cycle_get_64()))' });
  });

  it('Time.busyWaitUs → k_busy_wait', () => {
    expect(lowerTiming({ operation: 'timing.busy_wait_us', us: 15 } as any))
      .toEqual({ code: 'k_busy_wait(15);' });
  });
});

describe('Time end-to-end (user code → resolver → Zephyr lowering)', () => {
  it('lowers Time.sleep/now/nowUs/busyWaitUs in a transpiled program', () => {
    const result = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      const start = Time.now();
      Time.sleep(100);
      const elapsedUs = Time.nowUs();
      Time.busyWaitUs(5);
      console.log(start, elapsedUs);
    `);

    expectCppContains(result, [
      'k_msleep(100);',
      'static_cast<double>(k_uptime_get())',
      'static_cast<double>(k_cyc_to_us_floor64(k_cycle_get_64()))',
      'k_busy_wait(5);',
    ]);
  });
});
