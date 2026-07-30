import { describe, it, expect } from 'vitest';
import { lowerPulseOrShift } from '../../../../packages/framework-zephyr/src/lowering/pulse';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

const CTL = 'DEVICE_DT_GET(DT_NODELABEL(gpio0))';

describe('pulse lowering (bit-bang)', () => {
  it('pulse.in measures until the edge, with a timeout (Q5 fix)', () => {
    const out = lowerPulseOrShift({ operation: 'pulse.in', pin: 5, value: 1, timeout: 500_000 } as any, XIAO_BLE);
    expect(out.expression).toContain('k_uptime_get()');            // 64-bit, no wrap
    expect(out.expression).toContain(`gpio_pin_get_raw(${CTL}, 5)`);
    expect(out.expression).toContain('__max');                      // timeout-bounded
    expect(out.expression).toContain('500000 / 1000');
  });

  // Q5 regression: pulse.in_long must have a timeout (was an infinite spin).
  it('pulse.in_long is timeout-bounded (Q5 fix — was infinite spin)', () => {
    const out = lowerPulseOrShift({ operation: 'pulse.in_long', pin: 5, value: 1, timeout: 1_000_000 } as any, XIAO_BLE);
    expect(out.expression).toContain('__max');
    expect(out.expression).toContain('1000000 / 1000');
    // Must not be an unbounded `while(...) {}` with no timeout escape.
    expect(out.expression).toMatch(/if \(\(k_uptime_get\(\) - __t0\) > __max\)/);
  });

  it('shift.out bit-bangs MSB-first by default', () => {
    const out = lowerPulseOrShift({ operation: 'shift.out', dataPin: 5, clockPin: 6, value: 0xA5, bitOrder: 'msb' } as any, XIAO_BLE);
    expect(out.code).toContain('for (int __i = 7; (__i >= 0); __i--)');
    expect(out.code).toContain(`(${CTL}, 5`);
    expect(out.code).toContain(`(${CTL}, 6`);
  });

  it('shift.in accumulates MSB-first', () => {
    const out = lowerPulseOrShift({ operation: 'shift.in', dataPin: 5, clockPin: 6, bitOrder: 'msb' } as any, XIAO_BLE);
    expect(out.expression).toContain('__v = (__v << 1)');
    // GCC statement-expression returns the trailing __v expression (no `return`).
    expect(out.expression).toMatch(/} __v; \}\)$/);
  });
});
