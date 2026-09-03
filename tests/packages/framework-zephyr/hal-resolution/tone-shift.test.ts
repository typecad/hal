// ---------------------------------------------------------------------------
// Phase-0 gap closers: GPIO.shiftOut/shiftIn (bit-bang) — the thin
// replacements for the legacy shiftOut()/shiftIn()
// ahead of the legacy-HAL removal.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerPwm } from '../../../../packages/framework-zephyr/src/lowering/pwm';
import { ESP32S3_DEVKITC } from '../helpers/test-chip';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}
import { lowerGpio } from '../../../../packages/framework-zephyr/src/lowering/gpio';
import { transpile, expectCppContains } from '../../../setup';

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

  it('end-to-end: GPIO.shiftOut + PWM duty flow through the resolver', () => {
    // PWM duty needs the LEDC matrix — a synthetic silicon fact injected with
    // the generated board constants.
    const constants = generatedConstants('esp32s3_devkitc/esp32s3/procpu');
    constants.set('zephyr.pwm.matrix.controller', 'ledc0');
    constants.set('zephyr.pwm.matrix.channelCount', 8);
    for (let i = 0; i < 49; i++) constants.set(`zephyr.pwm.matrix.pins.${i}`, i);
    const result = transpile(`
      import { shiftOut, shiftIn, PWM } from '@typecad/hal';
      shiftOut(5, 6, 0xA5);
      const b = shiftIn(5, 6);
      const buzzer = new PWM(4, { periodNs: 2273000 });
      buzzer.setDuty(0.5);
      console.log(b);
    `, { strategy: new ZephyrStrategy(), boardConstants: constants });
    expectCppContains(result, ['for (int __i = 7', 'k_busy_wait(1)', 'pwm_set_pulse_dt']);
  });
});
