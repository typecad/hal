import { describe, it, expect, beforeEach } from 'vitest';
import { lowerAdc, adcInitLines } from '../../../../packages/framework-esp32/src/lowering/adc';
import { setActiveChip, ESP32 } from '../../../../packages/framework-esp32/src/chips/index';

beforeEach(() => setActiveChip(ESP32));

describe('adc init block', () => {
  it('emits CUTTLEFISH_ADC markers', () => {
    const lines = adcInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_ADC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_ADC_END');
    // v6 oneshot driver — not the deprecated esp_adc_cal_* API.
    expect(lines).toContain('adc_oneshot_new_unit');
    expect(lines).toContain('adc_cali_create_line_fitting');
    expect(lines).not.toContain('esp_adc_cal_');
  });
});

describe('adc lowering', () => {
  it('read on ADC1 pin (GPIO32) → __tc_adc_read with ADC1 channel + unit', () => {
    const out = lowerAdc({ operation: 'adc.read', pin: 32 });
    expect(out.expression).toContain('__tc_adc_read(1,');
    expect(out.expression).toMatch(/ADC_CHANNEL_\d+/);
  });
  it('read on ADC2 pin (GPIO4) → __tc_adc_read with unit 2', () => {
    const out = lowerAdc({ operation: 'adc.read', pin: 4 });
    expect(out.expression).toContain('__tc_adc_read(2,');
    expect(out.expression).toMatch(/ADC_CHANNEL_\d+/);
  });
  it('read_voltage uses __tc_adc_read_voltage (adc_cali path)', () => {
    const out = lowerAdc({ operation: 'adc.read_voltage', pin: 32 });
    expect(out.expression).toContain('__tc_adc_read_voltage(1,');
    expect(out.expression).toMatch(/ADC_CHANNEL_\d+/);
  });
  it('get_resolution returns 12 (expression)', () => {
    expect(lowerAdc({ operation: 'adc.get_resolution' })).toEqual({ expression: '12' });
  });
  it('set_reference is a no-op comment (fixed reference)', () => {
    expect(lowerAdc({ operation: 'adc.set_reference', reference: 'DEFAULT' }).code)
      .toMatch(/adc\.set_reference.*ATTN_DB_11/);
  });
  it('throws on pin without ADC channel', () => {
    expect(() => lowerAdc({ operation: 'adc.read', pin: 99 })).toThrow(/no ADC channel/);
  });
  it('unknown adc.* op throws', () => {
    expect(() => lowerAdc({ operation: 'adc.unknown', pin: 32 } as any)).toThrow(/does not yet support/);
  });
});
