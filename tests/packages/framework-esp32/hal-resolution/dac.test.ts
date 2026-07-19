import { describe, it, expect, beforeEach } from 'vitest';
import { lowerDac, dacInitLines } from '../../../../packages/framework-esp32/src/lowering/dac';
import { setActiveChip, ESP32, ESP32S3 } from '../../../../packages/framework-esp32/src/chips/index';

beforeEach(() => setActiveChip(ESP32));

describe('dac init block', () => {
  it('emits CUTTLEFISH_DAC markers', () => {
    const lines = dacInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_DAC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_DAC_END');
    expect(lines).toContain('dac_output_enable');
  });
});

describe('dac lowering', () => {
  it('GPIO25 → DAC_CHAN_0 with init', () => {
    expect(lowerDac({ operation: 'dac.write', pin: 25, value: 128 }))
      .toEqual({ code: '__tc_dac_init(); dac_output_voltage(DAC_CHAN_0, 128);' });
  });
  it('GPIO26 → DAC_CHAN_1', () => {
    expect(lowerDac({ operation: 'dac.write', pin: 26, value: 200 }))
      .toEqual({ code: '__tc_dac_init(); dac_output_voltage(DAC_CHAN_1, 200);' });
  });
  it('unknown DAC pin throws', () => {
    expect(() => lowerDac({ operation: 'dac.write', pin: 4, value: 0 }))
      .toThrow(/not a DAC pin/);
  });
  it('throws on chips without DAC', () => {
    setActiveChip(ESP32S3);
    expect(() => lowerDac({ operation: 'dac.write', pin: 25, value: 0 }))
      .toThrow(/no DAC peripheral/);
  });
  it('unknown dac.* op throws', () => {
    expect(() => lowerDac({ operation: 'dac.unknown', pin: 25 } as any)).toThrow(/does not yet support/);
  });
});
