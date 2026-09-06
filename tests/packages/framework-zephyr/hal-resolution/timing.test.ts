import { describe, it, expect } from 'vitest';
import { lowerTiming } from '../../../../packages/framework-zephyr/src/lowering/timing';
import { transpileZephyrStrategy, expectCppContains } from '../../../setup';

describe('timing lowering', () => {





  // ── Time.* — the TS-flavored surface (hal/time.ts) ──────────────────────
  it('Time.sleep → k_msleep', () => {
    expect(lowerTiming({ operation: 'timing.sleep', ms: 250 } as any))
      .toEqual({ code: 'k_msleep(250);' });
  });

  it('Time.now → k_uptime_get as double, no uint32 wrap (expression)', () => {
    expect(lowerTiming({ operation: 'timing.now' } as any))
      .toEqual({ expression: 'static_cast<double>(k_uptime_get())' });
  });

  it('Time.nowUs → uptime-derived µs as double, uniform for every board (expression)', () => {
    // The cycle-counter form reads a constant on SoCs without a free-running
    // 64-bit counter, so the one expression that is monotonic and advancing
    // everywhere is the kernel uptime scaled to µs.
    expect(lowerTiming({ operation: 'timing.now_us' } as any))
      .toEqual({ expression: 'static_cast<double>(k_uptime_get() * 1000)' });
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
      const s: number = start;
      const e: number = elapsedUs;
      void s; void e;
    `);

    expectCppContains(result, [
      'k_msleep(100);',
      'static_cast<double>(k_uptime_get())',
      'static_cast<double>(k_uptime_get() * 1000)',
      'k_busy_wait(5);',
    ]);
  });
});
