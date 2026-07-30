import { describe, it, expect } from 'vitest';
import { lowerTone } from '../../../../packages/framework-zephyr/src/lowering/tone';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('tone lowering (PWM-based)', () => {
  it('play without duration sets a 50% duty square wave', () => {
    const out = lowerTone({ operation: 'tone.play', frequency: 440 } as any, XIAO_BLE);
    expect(out.code).toContain('__period = (440 > 0) ? (1000000000ULL / static_cast<uint64_t>(440)) : 0');
    expect(out.code).toContain('pwm_set_dt(&__tc_pwm_pwm_led0, __period, __period / 2)');
  });

  it('play with duration blocks for the duration then stops', () => {
    const out = lowerTone({ operation: 'tone.play', frequency: 880, duration: 200 } as any, XIAO_BLE);
    expect(out.code).toContain('k_msleep(200)');
    expect(out.code).toContain('pwm_set_pulse_dt(&__tc_pwm_pwm_led0, 0)');
  });

  it('stop → 0 pulse on the PWM spec', () => {
    const out = lowerTone({ operation: 'tone.stop' } as any, XIAO_BLE);
    expect(out.code).toBe('pwm_set_pulse_dt(&__tc_pwm_pwm_led0, 0);');
  });
});
