import { describe, it, expect } from 'vitest';
import { lowerPower } from '../../../../packages/framework-zephyr/src/lowering/power';

describe('power lowering', () => {
  it('deep_sleep → k_sleep for the duration', () => {
    expect(lowerPower({ operation: 'power.deep_sleep', ms: 5000 } as any))
      .toEqual({ code: 'k_sleep(K_MSEC(5000));' });
  });

  it('light_sleep → pm_state_force SUSPEND_TO_IDLE', () => {
    const out = lowerPower({ operation: 'power.light_sleep' } as any);
    expect(out.code).toContain('pm_state_force(0');
    expect(out.code).toContain('PM_STATE_SUSPEND_TO_IDLE');
  });

  it('set_cpu_frequency → deferred comment (nRF clock API)', () => {
    const out = lowerPower({ operation: 'power.set_cpu_frequency', mhz: 128 } as any);
    expect(out.code).toContain('deferred');
    expect(out.code).toContain('128');
  });

  it('deep_sleep_pin → deferred comment (GPIOTE sense)', () => {
    const out = lowerPower({ operation: 'power.deep_sleep_pin', pin: 4, level: 1 } as any);
    expect(out.code).toContain('deferred');
    expect(out.code).toContain('4');
  });
});
