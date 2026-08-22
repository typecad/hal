import { describe, it, expect } from 'vitest';
import { lowerPwm, pwmInitLines, pwmDtAlias } from '../../../../packages/framework-zephyr/src/lowering/pwm';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

// Synthesized-spec chip (the Black Pill shape): pwm4 controller + channel,
// no board-shipped DT alias — the overlay generator creates tc-pwm<pin>.
const BLACKPILL_PWM: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  pwm: {
    specs: [
      { pin: 22, controller: 'pwm4', channel: 1, periodNs: 20_000_000 },  // PB6 (TIM4_CH1)
      { pin: 23, controller: 'pwm4', channel: 2 },                         // PB7 (TIM4_CH2)
    ],
  },
};

describe('pwm init block', () => {
  it('emits CUTTLEFISH_PWM markers + a pwm_dt_spec per channel', () => {
    const lines = pwmInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_PWM_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PWM_END');
    // The alias token is macro-safe (dashes → underscores): the DT alias is
    // `pwm-led0` but Zephyr's generated macro is DT_N_ALIAS_pwm_led0 — the
    // dashed spelling DT_ALIAS(pwm-led0) is a subtraction expression and
    // fails to compile (found by the blackpill E2E west build).
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))');
    expect(lines).not.toContain('DT_ALIAS(pwm-led0)');
    expect(lines).toContain('__tc_pwm_pwm_led0');
  });
});

describe('per-use PWM spec gating', () => {
  it('emits specs only for the pins the program drives', () => {
    const used = new Set<number>([22]);
    const lines = pwmInitLines(BLACKPILL_PWM, used).join('\n');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm22))');
    expect(lines).not.toContain('tc_pwm23');
  });

  it('emits every spec when no usage set is given (probe path)', () => {
    const lines = pwmInitLines(BLACKPILL_PWM).join('\n');
    expect(lines).toContain('tc_pwm22');
    expect(lines).toContain('tc_pwm23');
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

describe('synthesized PWM specs (Black Pill — overlay-generated aliases)', () => {
  it('addresses the channel via the tc-pwm<pin> alias the overlay creates', () => {
    const lines = pwmInitLines(BLACKPILL_PWM).join('\n');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm22))');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm23))');
    expect(lines).toContain('__tc_pwm_tc_pwm22');
  });

  it('pwm.write scales duty against the synthesized spec (same code shape as aliased specs)', () => {
    const out = lowerPwm({ operation: 'pwm.write', pin: 22, duty: 128 } as any, BLACKPILL_PWM);
    expect(out.code).toBe('pwm_set_pulse_dt(&__tc_pwm_tc_pwm22, (static_cast<uint32_t>(128) * __tc_pwm_tc_pwm22.period) / 255);');
  });

  it('pwmDtAlias derives the pin-keyed alias only for the synthesized form', () => {
    expect(pwmDtAlias({ pin: 22, controller: 'pwm4', channel: 1 })).toBe('tc-pwm22');
    expect(pwmDtAlias({ pin: 17, dtSpec: 'pwm-led0' })).toBe('pwm-led0');
  });
});
