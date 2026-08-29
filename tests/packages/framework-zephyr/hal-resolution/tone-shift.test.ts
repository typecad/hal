// ---------------------------------------------------------------------------
// Phase-0 gap closers: PWM.tone (square-wave sugar) and GPIO.shiftOut/shiftIn
// (bit-bang) — the thin replacements for the legacy tone()/shiftOut()/shiftIn()
// ahead of the legacy-HAL removal.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerPwm } from '../../../../packages/framework-zephyr/src/lowering/pwm';
import { lowerGpio } from '../../../../packages/framework-zephyr/src/lowering/gpio';
import { ESP32S3_DEVKITC } from '../../../../packages/framework-zephyr/src/chips/esp32s3';
import { transpileZephyrStrategy as transpile, expectCppContains } from '../../../setup';

describe('PWM.tone lowering', () => {
  it('tone(hz) → one pwm_set_dt at 50% duty', () => {
    const out = lowerPwm({ operation: 'pwm.tone', pin: 17, hz: 440 } as any, { pwm: { specs: [{ pin: 17, controller: 'pwm4', channel: 1 }] } } as any);
    expect(out.code).toContain('1000000000ULL / static_cast<uint64_t>(440)');
    expect(out.code).toContain('__p / 2U');
    expect(out.code).toContain('pwm_set_dt(');
  });
});

describe('GPIO.shift lowering', () => {
  it('shift_out bit-bangs 8 bits MSB-first: data then clock pulse', () => {
    const out = lowerGpio({ operation: 'gpio.shift_out', dataPin: 5, clockPin: 6, value: 0xA5, msbFirst: true } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('for (int __i = 7; __i >= 0; __i--)');
    expect(out.code).toContain('gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5');
    expect(out.code).toContain('gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 6, 1');
    expect(out.code).toContain('k_busy_wait(1)');
  });

  it('shift_in samples on the clock edge, LSB-first form flips the loop', () => {
    const out = lowerGpio({ operation: 'gpio.shift_in', dataPin: 5, clockPin: 6, msbFirst: false } as any, ESP32S3_DEVKITC);
    expect(out.expression).toContain('for (int __i = 0; __i < 8; __i++)');
    expect(out.expression).toContain('gpio_pin_get_raw');
    expect(out.expression).toMatch(/__b; \}\)$/);
  });

  it('end-to-end: GPIO.shiftOut + tone flow through the resolver', () => {
    const result = transpile(`
      import { shiftOut, shiftIn, PWM } from '@typecad/hal';
      shiftOut(5, 6, 0xA5);
      const b = shiftIn(5, 6);
      const buzzer = new PWM(4, { periodNs: 2273000 });
      buzzer.tone(440);
      console.log(b);
    `);
    expectCppContains(result, ['for (int __i = 7', 'k_busy_wait(1)', 'pwm_set_dt']);
  });
});
