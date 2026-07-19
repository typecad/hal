import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

function resolveAdcChannel(pin: number): { unit: 'ADC_UNIT_1' | 'ADC_UNIT_2'; channel: string } {
  const chip = getActiveChip();
  for (const u of chip.adc.units) {
    if (u.channelForPin[pin]) {
      // Descriptor stores "ADC1_CH4"; IDF expects "ADC1_CHANNEL_4".
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
    `static bool __tc_adc_ready = false;`,
    `static void __tc_adc_init(void) {`,
    `    if (__tc_adc_ready) return;`,
    `    adc1_config_width(ADC_WIDTH_BIT_12);`,
    `    (void)esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, 0, &__tc_adc_chars);`,
    `    __tc_adc_ready = true;`,
    `}`,
    `// CUTTLEFISH_ADC_END`,
    ``,
  ];
}

function rawReadExpr(unit: 'ADC_UNIT_1' | 'ADC_UNIT_2', channel: string): string {
  if (unit === 'ADC_UNIT_1') {
    return `({ __tc_adc_init(); adc1_config_channel_atten(${channel}, ADC_ATTEN_DB_11); adc1_get_raw(${channel}); })`;
  }
  // adc2_get_raw writes through an out-param.
  return `({ __tc_adc_init(); int __tc_adc2_raw = 0; adc2_config_channel_atten(${channel}, ADC_ATTEN_DB_11); adc2_get_raw(${channel}, ADC_WIDTH_BIT_12, &__tc_adc2_raw); __tc_adc2_raw; })`;
}

/** Resolve a HAL adc.* op to ESP-IDF C++. */
export function lowerAdc(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'adc.read': {
      const { unit, channel } = resolveAdcChannel(o.pin);
      return { expression: rawReadExpr(unit, channel) };
    }
    case 'adc.read_voltage': {
      const { unit, channel } = resolveAdcChannel(o.pin);
      return {
        expression: `esp_adc_cal_raw_to_voltage(${rawReadExpr(unit, channel)}, &__tc_adc_chars)`,
      };
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
