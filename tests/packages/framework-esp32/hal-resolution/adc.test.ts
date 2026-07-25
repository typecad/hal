import { describe, it, expect, beforeEach } from 'vitest';
import { lowerAdc, adcInitLines } from '../../../../packages/framework-esp32/src/lowering/adc';
import { setActiveChip, ESP32 } from '../../../../packages/framework-esp32/src/chips/index';
import { transpileEsp32Strategy } from '../../../setup';

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

// Regression: a value-position HAL op (D32.readAnalog() used in a var-init)
// lowers to an adc.read hal-expr. The analysis pass must set usesADC from the
// hal-expr so the CUTTLEFISH_ADC init block (shimLines) and adc_oneshot.h
// forced include both emit. Without the hal-expr detection fix, the lowering
// ran (__tc_adc_read emitted) but its runtime + include were dropped — a
// silent link failure on device.
describe('adc lowering end-to-end (init-block propagation)', () => {
  it('D32.readAnalog() var-init emits the init block + v6 includes', () => {
    const r = transpileEsp32Strategy(`
      import { D32 } from '@typecad/board-esp32-devkit';
      export function setup() {
        const v = D32.readAnalog();
        console.log(v);
      }
    `);
    expect(r.cpp).toContain('__tc_adc_read(1, ADC_CHANNEL_4)');
    expect(r.cpp).toContain('CUTTLEFISH_ADC_BEGIN');
    expect(r.cpp).toMatch(/adc_oneshot\.h/);
    expect(r.cpp).toMatch(/adc_cali_scheme\.h/);
  });
});
