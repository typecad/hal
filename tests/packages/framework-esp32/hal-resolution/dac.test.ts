import { describe, it, expect } from 'vitest';
import { lowerDac, dacInitLines } from '../../../../packages/framework-esp32/src/lowering/dac';

describe('dac init block', () => {
  it('emits CUTTLEFISH_DAC markers', () => {
    const lines = dacInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_DAC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_DAC_END');
    expect(lines).toContain('dac_output_enable');
  });
});

describe('dac lowering', () => {
  it('GPIO25 → DAC_CHAN_0', () => {
    expect(lowerDac({ operation: 'dac.write', pin: 25, value: 128 }))
      .toEqual({ code: 'dac_output_voltage(DAC_CHAN_0, 128);' });
  });
  it('GPIO26 → DAC_CHAN_1', () => {
    expect(lowerDac({ operation: 'dac.write', pin: 26, value: 200 }))
      .toEqual({ code: 'dac_output_voltage(DAC_CHAN_1, 200);' });
  });
  it('other pin defaults to DAC_CHAN_0', () => {
    expect(lowerDac({ operation: 'dac.write', pin: 4, value: 0 }).code)
      .toContain('DAC_CHAN_0');
  });
  it('unknown dac.* op throws', () => {
    expect(() => lowerDac({ operation: 'dac.unknown', pin: 25 } as any)).toThrow(/does not yet support/);
  });
});
