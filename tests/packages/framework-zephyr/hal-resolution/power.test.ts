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

  it('set_cpu_frequency → documented no-op (nRF52 fixed HFXO)', () => {
    const out = lowerPower({ operation: 'power.set_cpu_frequency', mhz: 128 } as any);
    expect(out.code).toContain('no portable scaling');
    expect(out.code).toContain('128');
  });

  it('deep_sleep_pin → configures GPIO wake interrupt + k_sleep', () => {
    const out = lowerPower({ operation: 'power.deep_sleep_pin', pin: 4, level: 1 } as any);
    expect(out.code).toContain('gpio_pin_interrupt_configure');   // wake source
    expect(out.code).toContain('GPIO_INT');                        // interrupt flags
    expect(out.code).toContain('k_sleep(K_FOREVER)');             // block until wake
    expect(out.code).toContain('4');                               // the pin
  });
});
