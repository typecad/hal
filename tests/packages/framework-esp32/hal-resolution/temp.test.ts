import { describe, it, expect } from 'vitest';
import { lowerTemp, tempInitLines } from '../../../../packages/framework-esp32/src/lowering/temp';

describe('temp init block', () => {
  it('emits CUTTLEFISH_TEMP markers and the temperature_sensor driver', () => {
    const lines = tempInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_TEMP_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_TEMP_END');
    expect(lines).toContain('temperature_sensor_install');
    expect(lines).toContain('temperature_sensor_get_celsius');
  });
});

describe('temp lowering', () => {
  it('temp.read → __tc_temp_read() expression (°C)', () => {
    const out = lowerTemp({ operation: 'temp.read' } as any);
    expect(out.expression).toBe('__tc_temp_read()');
  });
  it('unknown temp.* op throws', () => {
    expect(() => lowerTemp({ operation: 'temp.bogus' } as any)).toThrow();
  });
});
