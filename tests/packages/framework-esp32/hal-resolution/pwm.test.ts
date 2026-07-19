import { describe, it, expect, beforeEach } from 'vitest';
import { lowerPwm, pwmInitLines, resetPwmChannels } from '../../../../packages/framework-esp32/src/lowering/pwm';

beforeEach(() => resetPwmChannels());

describe('pwm init block', () => {
  it('emits CUTTLEFISH_PWM markers + ledc_timer_config', () => {
    const lines = pwmInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_PWM_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PWM_END');
    expect(lines).toContain('ledc_timer_config');
  });
});

describe('pwm lowering', () => {
  it('first write allocates channel 0, inits timer, configs channel, sets duty', () => {
    const out = lowerPwm({ operation: 'pwm.write', pin: 2, duty: 512 });
    expect(out.code).toContain('__tc_ledc_init()');
    expect(out.code).toContain('ledc_channel_config');
    expect(out.code).toContain('LEDC_CHANNEL_0');
    expect(out.code).toContain('ledc_set_duty');
    expect(out.code).toContain('512');
  });
  it('second pin gets channel 1', () => {
    lowerPwm({ operation: 'pwm.write', pin: 2, duty: 0 });
    expect(lowerPwm({ operation: 'pwm.write', pin: 4, duty: 0 }).code).toContain('LEDC_CHANNEL_1');
  });
  it('same pin keeps same channel', () => {
    lowerPwm({ operation: 'pwm.write', pin: 2, duty: 0 });
    lowerPwm({ operation: 'pwm.write', pin: 2, duty: 100 }).code!.includes('LEDC_CHANNEL_0');
  });
  it('get_frequency returns configured value (expression)', () => {
    expect(lowerPwm({ operation: 'pwm.get_frequency', pin: 2 }))
      .toEqual({ expression: '5000' });
  });
  it('get_resolution returns configured bit depth (expression)', () => {
    expect(lowerPwm({ operation: 'pwm.get_resolution', pin: 2 }))
      .toEqual({ expression: '14' });
  });
  it('unknown pwm.* op throws', () => {
    expect(() => lowerPwm({ operation: 'pwm.unknown', pin: 2 } as any)).toThrow(/does not yet support/);
  });
});
