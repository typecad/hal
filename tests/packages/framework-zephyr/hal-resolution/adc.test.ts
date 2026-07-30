import { describe, it, expect } from 'vitest';
import { lowerAdc, adcChannelForPin, adcInitLines } from '../../../../packages/framework-zephyr/src/lowering/adc';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('adc channel resolution', () => {
  it('XIAO D0 (pin 2) → SAADC channel 0', () => {
    expect(adcChannelForPin(XIAO_BLE, 2)).toBe(0);
  });
  it('XIAO D1 (pin 3) → SAADC channel 1', () => {
    expect(adcChannelForPin(XIAO_BLE, 3)).toBe(1);
  });
  it('unmapped pin → -1 (drives the profileDiagnostic + link-error guard)', () => {
    expect(adcChannelForPin(XIAO_BLE, 99)).toBe(-1);
  });
});

describe('adc init block', () => {
  it('emits CUTTLEFISH_ADC markers + the SAADC device + per-channel setup', () => {
    const lines = adcInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_ADC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_ADC_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(adc))');
    expect(lines).toContain('adc_channel_setup');
    expect(lines).toContain('__tc_adc0_setup');
    // resolution + vref defines
    expect(lines).toContain('#define __TC_ADC_RESOLUTION 12');
    expect(lines).toContain('#define __TC_ADC_VREF_MV 3000');
  });
});

describe('adc lowering', () => {
  it('adc.read → statement-expression: setup + adc_read + return raw (expression)', () => {
    const out = lowerAdc({ operation: 'adc.read', pin: 2 } as any, XIAO_BLE);
    expect(out.expression).toContain('__tc_adc0_setup()');
    expect(out.expression).toContain('adc_read');
    expect(out.expression).toContain('.channels = BIT(0)');
    expect(out.expression).toContain('.resolution = 12');
  });

  it('adc.read on an unmapped pin emits a -1 channel (caught by profileDiagnostics)', () => {
    const out = lowerAdc({ operation: 'adc.read', pin: 99 } as any, XIAO_BLE);
    expect(out.expression).toContain('__tc_adc-1_setup');
  });

  it('adc.read_voltage → adc_raw_to_millivolts (expression)', () => {
    const out = lowerAdc({ operation: 'adc.read_voltage', pin: 2 } as any, XIAO_BLE);
    expect(out.expression).toContain('adc_raw_to_millivolts(3000, ADC_GAIN_1_4, 12');
  });

  it('adc.get_resolution → chip resolution (expression)', () => {
    expect(lowerAdc({ operation: 'adc.get_resolution' } as any, XIAO_BLE))
      .toEqual({ expression: '12' });
  });

  it('adc.set_reference → no-op comment (configured at channel setup)', () => {
    const out = lowerAdc({ operation: 'adc.set_reference', reference: 'DEFAULT' } as any, XIAO_BLE);
    expect(out.code).toContain('configured at channel setup');
  });

  it('adc.get_reference → 0 (ADC_REF_INTERNAL)', () => {
    const out = lowerAdc({ operation: 'adc.get_reference' } as any, XIAO_BLE);
    expect(out.expression).toContain('0');
  });
});
