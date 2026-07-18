import { describe, it, expect } from 'vitest';
import { lowerGpio } from '../../../../packages/framework-esp32/src/lowering/gpio';

describe('gpio lowering', () => {
  it('gpio.write (literal 1) → gpio_set_level with 1', () => {
    expect(lowerGpio({ operation: 'gpio.write', pin: 2, value: 1 }))
      .toEqual({ code: 'gpio_set_level((gpio_num_t)2, 1);' });
  });

  it('gpio.write (literal 0) → gpio_set_level with 0', () => {
    expect(lowerGpio({ operation: 'gpio.write', pin: 2, value: 0 }))
      .toEqual({ code: 'gpio_set_level((gpio_num_t)2, 0);' });
  });

  it('gpio.write (runtime expression) → ternary coercion', () => {
    const out = lowerGpio({ operation: 'gpio.write', pin: 2, value: 'state' });
    expect(out.code).toBe('gpio_set_level((gpio_num_t)2, ((state) ? 1 : 0));');
  });

  it('gpio.read → gpio_get_level (expression, not code)', () => {
    expect(lowerGpio({ operation: 'gpio.read', pin: 4 }))
      .toEqual({ expression: 'gpio_get_level((gpio_num_t)4)' });
  });

  it('gpio.toggle reads-then-writes', () => {
    const out = lowerGpio({ operation: 'gpio.toggle', pin: 2 });
    expect(out.code).toBe('gpio_set_level((gpio_num_t)2, !gpio_get_level((gpio_num_t)2));');
  });

  it('gpio.set_mode "output" → GPIO_MODE_OUTPUT', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 2, mode: 'output' });
    expect(out.code).toContain('gpio_set_direction((gpio_num_t)2, GPIO_MODE_OUTPUT)');
    expect(out.code).not.toMatch(/pullup|pulldown/);
  });

  it('gpio.set_mode "input_pullup" adds gpio_pullup_en', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 4, mode: 'input_pullup' });
    expect(out.code).toContain('gpio_pullup_en((gpio_num_t)4)');
    expect(out.code).toContain('GPIO_MODE_INPUT');
  });

  it('gpio.set_mode "input_pulldown" adds gpio_pulldown_en', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 4, mode: 'input_pulldown' });
    expect(out.code).toContain('gpio_pulldown_en((gpio_num_t)4)');
  });

  it('gpio.set_mode resets pin first (idempotent reconfigure)', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 2, mode: 'output' });
    expect(out.code).toContain('gpio_reset_pin((gpio_num_t)2)');
  });

  it('unknown gpio.* op throws', () => {
    expect(() => lowerGpio({ operation: 'gpio.unknown', pin: 2 } as any)).toThrow(/does not yet support/);
  });
});
