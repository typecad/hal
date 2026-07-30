import { describe, it, expect } from 'vitest';
import { lowerTiming } from '../../../../packages/framework-zephyr/src/lowering/timing';

describe('timing lowering', () => {
  it('delay → k_msleep', () => {
    expect(lowerTiming({ operation: 'timing.delay', ms: 500 } as any))
      .toEqual({ code: 'k_msleep(500);' });
  });

  it('delay_microseconds → k_busy_wait', () => {
    expect(lowerTiming({ operation: 'timing.delay_microseconds', us: 10 } as any))
      .toEqual({ code: 'k_busy_wait(10);' });
  });

  it('millis → k_uptime_get_32 cast to uint32_t (expression)', () => {
    expect(lowerTiming({ operation: 'timing.millis' } as any))
      .toEqual({ expression: 'static_cast<uint32_t>(k_uptime_get_32())' });
  });

  it('micros → k_cycle_get_32 scaled to us (expression)', () => {
    const out = lowerTiming({ operation: 'timing.micros' } as any);
    expect(out.expression).toBe(
      '(uint32_t)(((uint64_t)k_cycle_get_32() * 1000000ULL) / sys_clock_hw_cycles_per_sec())',
    );
  });

  it('free_heap → 0 with explanatory comment (no portable query)', () => {
    const out = lowerTiming({ operation: 'timing.free_heap' } as any);
    expect(out.expression).toContain('0');
    expect(out.expression).toContain('CONFIG_SYS_HEAP_RUNTIME_STATS');
  });

  it('timer ops throw (unsupported — no async runtime yet)', () => {
    expect(() => lowerTiming({ operation: 'timing.set_interval' } as any)).toThrow(/does not yet support/);
    expect(() => lowerTiming({ operation: 'timing.set_timeout' } as any)).toThrow(/does not yet support/);
    expect(() => lowerTiming({ operation: 'timing.clear_interval' } as any)).toThrow(/does not yet support/);
    expect(() => lowerTiming({ operation: 'timing.clear_timeout' } as any)).toThrow(/does not yet support/);
  });
});
