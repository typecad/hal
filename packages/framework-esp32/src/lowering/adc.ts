import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

function resolveAdcChannel(pin: number): { unit: string; channel: string } {
  const chip = getActiveChip();
  for (const u of chip.adc.units) {
    if (u.channelForPin[pin]) {
      // IDF expects ADC1_CHANNEL_n / ADC2_CHANNEL_n form for adc1/adc2 channel config.
      // Our descriptor stores "ADC1_CH4" style; transform to "ADC1_CHANNEL_4".
      const idfChan = u.channelForPin[pin].replace(/_CH(\d+)$/, '_CHANNEL_$1');
      return { unit: u.unit, channel: idfChan };
    }
  }
  throw new Error(`framework-esp32: pin ${pin} has no ADC channel on ${chip.id}`);
}

export function adcInitLines(): string[] {
  return [
    `// CUTTLEFISH_ADC_BEGIN`,
    `static esp_adc_cal_characteristics_t __tc_adc_chars;`,
    `static void __tc_adc_init(void) {`,
    `    adc1_config_width(ADC_WIDTH_BIT_12);`,
    `    (void)esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, 0, &__tc_adc_chars);`,
    `}`,
    `// CUTTLEFISH_ADC_END`,
    ``,
  ];
}

/** Resolve a HAL adc.* op to ESP-IDF C++. v1 uses ADC1 only (ADC2 conflicts with WiFi). */
export function lowerAdc(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'adc.read': {
      const { channel } = resolveAdcChannel(o.pin);
      return { expression: `adc1_get_raw(${channel})` };
    }
    case 'adc.read_voltage': {
      const { channel } = resolveAdcChannel(o.pin);
      return { expression: `esp_adc_cal_raw_to_voltage(adc1_get_raw(${channel}), &__tc_adc_chars)` };
    }
    case 'adc.get_resolution':
      return { expression: `12` };
    case 'adc.set_reference':
      return { code: `/* adc.set_reference(${o.reference}): ESP32 ADC reference is fixed; using ATTN_DB_11 */` };
    case 'adc.get_reference':
      return { expression: `1100 /* mV, internal Vref approx */` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
