import { describe, it, expect } from 'vitest';
import { lowerGpio, dtSpecVarName } from '../../../../packages/framework-zephyr/src/lowering/gpio';
import { XIAO_BLE, setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';

// GPIO lowering uses the active chip's gpio.dtSpecs to pick the DT-spec path vs
// the raw-controller fallback. Seed the active chip so pin 26 (led0) takes the
// DT-spec path and an unmapped pin (e.g. 99) takes the raw path.
setActiveChip(XIAO_BLE);

describe('gpio lowering — devicetree-spec path (led0 = pin 26)', () => {
  it('gpio.write (literal 1) → gpio_pin_set_dt with 1', () => {
    expect(lowerGpio({ operation: 'gpio.write', pin: 26, value: 1 } as any, XIAO_BLE))
      .toEqual({ code: 'gpio_pin_set_dt(&__tc_dt_led0, 1);' });
  });

  it('gpio.write (literal 0) → gpio_pin_set_dt with 0', () => {
    expect(lowerGpio({ operation: 'gpio.write', pin: 26, value: 0 } as any, XIAO_BLE))
      .toEqual({ code: 'gpio_pin_set_dt(&__tc_dt_led0, 0);' });
  });

  it('gpio.write (runtime expression) → ternary coercion', () => {
    const out = lowerGpio({ operation: 'gpio.write', pin: 26, value: 'state' } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_set_dt(&__tc_dt_led0, ((state) ? 1 : 0));');
  });

  it('gpio.read → gpio_pin_get_dt (expression, not code)', () => {
    expect(lowerGpio({ operation: 'gpio.read', pin: 26 } as any, XIAO_BLE))
      .toEqual({ expression: 'gpio_pin_get_dt(&__tc_dt_led0)' });
  });

  it('gpio.toggle → gpio_pin_toggle_dt', () => {
    expect(lowerGpio({ operation: 'gpio.toggle', pin: 26 } as any, XIAO_BLE))
      .toEqual({ code: 'gpio_pin_toggle_dt(&__tc_dt_led0);' });
  });

  it('gpio.set_mode "OUTPUT" (uppercase) → GPIO_OUTPUT', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'OUTPUT' } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT);');
  });

  it('gpio.set_mode "output" (lowercase) → GPIO_OUTPUT', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'output' } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT);');
  });

  // ── B1 regression: pull resistors ─────────────────────────────────────────
  it('gpio.set_mode "INPUT_PULLUP" adds GPIO_PULL_UP (B1 fix)', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'INPUT_PULLUP' } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_configure_dt(&__tc_dt_led0, GPIO_INPUT | GPIO_PULL_UP);');
  });

  it('gpio.set_mode "input_pullup" (lowercase) adds GPIO_PULL_UP', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'input_pullup' } as any, XIAO_BLE);
    expect(out.code).toContain('GPIO_PULL_UP');
    expect(out.code).toContain('GPIO_INPUT');
  });

  it('gpio.set_mode "INPUT_PULLDOWN" adds GPIO_PULL_DOWN', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'INPUT_PULLDOWN' } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_configure_dt(&__tc_dt_led0, GPIO_INPUT | GPIO_PULL_DOWN);');
  });

  it('gpio.set_mode "input_pulldown" adds GPIO_PULL_DOWN', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'input_pulldown' } as any, XIAO_BLE);
    expect(out.code).toContain('GPIO_PULL_DOWN');
  });

  it('plain INPUT has no pull flag', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 26, mode: 'INPUT' } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_configure_dt(&__tc_dt_led0, GPIO_INPUT);');
    expect(out.code).not.toMatch(/PULL/);
  });
});

describe('gpio lowering — raw-controller fallback (unmapped pin 99)', () => {
  const ctl = 'DEVICE_DT_GET(DT_NODELABEL(gpio0))';
  it('gpio.write (literal 1) → gpio_pin_set_raw', () => {
    expect(lowerGpio({ operation: 'gpio.write', pin: 99, value: 1 } as any, XIAO_BLE))
      .toEqual({ code: `gpio_pin_set_raw(${ctl}, 99, 1);` });
  });
  it('gpio.read → gpio_pin_get_raw', () => {
    expect(lowerGpio({ operation: 'gpio.read', pin: 99 } as any, XIAO_BLE))
      .toEqual({ expression: `gpio_pin_get_raw(${ctl}, 99)` });
  });
  it('gpio.toggle uses the native atomic toggle (no read-modify-write)', () => {
    // gpio_pin_toggle — Zephyr's toggle API has no _raw variant; for pins
    // without GPIO_ACTIVE_LOW the logical toggle equals the physical one.
    const out = lowerGpio({ operation: 'gpio.toggle', pin: 99 } as any, XIAO_BLE);
    expect(out.code).toBe(`gpio_pin_toggle(${ctl}, 99);`);
  });
  it('gpio.set_mode INPUT_PULLUP adds GPIO_PULL_UP on raw path too', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 99, mode: 'INPUT_PULLUP' } as any, XIAO_BLE);
    expect(out.code).toBe(`gpio_pin_configure(${ctl}, 99, GPIO_INPUT | GPIO_PULL_UP);`);
  });
  it('gpio.set_mode OUTPUT on raw path', () => {
    const out = lowerGpio({ operation: 'gpio.set_mode', pin: 99, mode: 'OUTPUT' } as any, XIAO_BLE);
    expect(out.code).toBe(`gpio_pin_configure(${ctl}, 99, GPIO_OUTPUT);`);
  });
});

describe('dtSpecVarName', () => {
  it('prefixes with __tc_dt_', () => {
    expect(dtSpecVarName('led0')).toBe('__tc_dt_led0');
  });
});
