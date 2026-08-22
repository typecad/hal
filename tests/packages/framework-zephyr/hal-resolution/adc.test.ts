import { describe, it, expect } from 'vitest';
import { lowerAdc, adcChannelForPin, adcInitLines } from '../../../../packages/framework-zephyr/src/lowering/adc';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

// SoC-aware ADC chip (the Black Pill shape): the STM32 driver requires
// exactly ADC_GAIN_1 + ADC_REF_INTERNAL with vref = VDDA (3300 mV).
const STM32_ADC: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  adc: {
    nodeLabel: 'adc1', resolution: 12, vrefMv: 3300,
    gain: 'ADC_GAIN_1', reference: 'ADC_REF_INTERNAL',
    channels: [{ pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' }],
  },
};

// All ten bonded ADC1 channels (the real Black Pill descriptor shape).
const STM32_ADC_ALL: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  adc: {
    nodeLabel: 'adc1', resolution: 12, vrefMv: 3300,
    gain: 'ADC_GAIN_1', reference: 'ADC_REF_INTERNAL',
    channels: [
      { pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' },
      { pin: 1, channel: 1, pinctrl: 'adc1_in1_pa1' },
      { pin: 2, channel: 2, pinctrl: 'adc1_in2_pa2' },
      { pin: 3, channel: 3, pinctrl: 'adc1_in3_pa3' },
      { pin: 4, channel: 4, pinctrl: 'adc1_in4_pa4' },
      { pin: 5, channel: 5, pinctrl: 'adc1_in5_pa5' },
      { pin: 6, channel: 6, pinctrl: 'adc1_in6_pa6' },
      { pin: 7, channel: 7, pinctrl: 'adc1_in7_pa7' },
      { pin: 16, channel: 8, pinctrl: 'adc1_in8_pb0' },
      { pin: 17, channel: 9, pinctrl: 'adc1_in9_pb1' },
    ],
  },
};

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

describe('per-use ADC channel gating (unused functions must not be emitted)', () => {
  it('emits setup functions only for the channels the program reads', () => {
    // Only PA1 (channel 1) read: the other nine descriptor channels' static
    // setup functions would trip -Wunused-function in the single TU.
    const used = new Set<number>([1]);
    const lines = adcInitLines(STM32_ADC_ALL, used).join('\n');
    expect(lines).toContain('__tc_adc1_setup');
    expect(lines).not.toContain('__tc_adc0_setup');
    expect(lines).not.toContain('__tc_adc9_setup');
  });

  it('emits every descriptor channel when no usage set is given (probe path)', () => {
    const lines = adcInitLines(STM32_ADC_ALL).join('\n');
    expect(lines).toContain('__tc_adc0_setup');
    expect(lines).toContain('__tc_adc9_setup');
  });
});

describe('SoC-aware ADC channel setup (descriptor-driven gain/reference)', () => {
  it('uses the descriptor gain/reference (STM32: ADC_GAIN_1 + ADC_REF_INTERNAL)', () => {
    const lines = adcInitLines(STM32_ADC).join('\n');
    expect(lines).toContain('.gain = ADC_GAIN_1,');
    expect(lines).toContain('.reference = ADC_REF_INTERNAL,');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(adc1))');
  });

  it('read_voltage converts with the descriptor gain + vref', () => {
    const out = lowerAdc({ operation: 'adc.read_voltage', pin: 0 } as any, STM32_ADC);
    expect(out.expression).toContain('adc_raw_to_millivolts(3300, ADC_GAIN_1, 12');
  });

  it("defaults to the nRF SAADC scheme when the descriptor omits gain/reference (XIAO regression)", () => {
    const lines = adcInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('.gain = ADC_GAIN_1_4,');
    const out = lowerAdc({ operation: 'adc.read_voltage', pin: 2 } as any, XIAO_BLE);
    expect(out.expression).toContain('adc_raw_to_millivolts(3000, ADC_GAIN_1_4, 12');
  });
});
