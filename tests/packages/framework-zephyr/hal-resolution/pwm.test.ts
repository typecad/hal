import { describe, it, expect } from 'vitest';
import { lowerPwm, pwmInitLines } from '../../../../packages/framework-zephyr/src/lowering/pwm';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('pwm init block', () => {
  it('emits CUTTLEFISH_PWM markers + a pwm_dt_spec per channel', () => {
    const lines = pwmInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_PWM_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PWM_END');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(pwm-led0))');
    expect(lines).toContain('__tc_pwm_pwm_led0');
  });
});

describe('pwm lowering', () => {
  // The XIAO pwm-led0 spec is on pin 17.
  it('pwm.write scales 0–255 duty to ns against the period', () => {
    const out = lowerPwm({ operation: 'pwm.write', pin: 17, duty: 128 } as any, XIAO_BLE);
    expect(out.code).toBe('pwm_set_pulse_dt(&__tc_pwm_pwm_led0, (static_cast<uint32_t>(128) * __tc_pwm_pwm_led0.period) / 255);');
  });

  it('pwm.get_frequency → 1e9 / period (expression)', () => {
    const out = lowerPwm({ operation: 'pwm.get_frequency', pin: 17 } as any, XIAO_BLE);
    expect(out.expression).toBe('(__tc_pwm_pwm_led0.period ? (1000000000ULL / __tc_pwm_pwm_led0.period) : 0)');
  });

  it('pwm.get_resolution → 8 (Arduino 8-bit duty range)', () => {
    expect(lowerPwm({ operation: 'pwm.get_resolution', pin: 17 } as any, XIAO_BLE))
      .toEqual({ expression: '8' });
  });

  it('unmapped pin → comment (no spec in chip descriptor)', () => {
    const out = lowerPwm({ operation: 'pwm.write', pin: 99, duty: 50 } as any, XIAO_BLE);
    expect(out.code).toContain('no PWM spec');
  });
});
