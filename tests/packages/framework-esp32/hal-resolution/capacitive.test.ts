import { describe, it, expect } from 'vitest';
import { lowerCapacitive, capacitiveInitLines } from '../../../../packages/framework-esp32/src/lowering/capacitive';

describe('capacitive init block', () => {
  it('emits CUTTLEFISH_CAPACITIVE markers and the touch_sensor driver', () => {
    const lines = capacitiveInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_CAPACITIVE_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_CAPACITIVE_END');
    expect(lines).toContain('touch_pad_init');
    expect(lines).toContain('touch_pad_read_raw');
    // GPIO → channel map for the classic ESP32 touch pins.
    expect(lines).toContain('{4, 0}');
    expect(lines).toContain('{33, 9}');
  });
});

describe('capacitive lowering', () => {
  it('capacitive.read(GPIO4) → __tc_capacitive_read(4) expression', () => {
    const out = lowerCapacitive({ operation: 'capacitive.read', pin: 4 } as any);
    expect(out.expression).toBe('__tc_capacitive_read(4)');
  });
  it('unknown capacitive.* op throws', () => {
    expect(() => lowerCapacitive({ operation: 'capacitive.bogus' } as any)).toThrow();
  });
});
