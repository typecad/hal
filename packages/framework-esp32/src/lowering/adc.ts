import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

function resolveAdcChannel(pin: number): { unit: 1 | 2; channel: string } {
  const chip = getActiveChip();
  for (const u of chip.adc.units) {
    const name = u.channelForPin[pin];
    if (name) {
      // Descriptor stores "ADC1_CH4" / "ADC2_CH0"; the v6 oneshot API wants a
      // unit index plus an `ADC_CHANNEL_n` enum value.
      const m = name.match(/^ADC([12])_CH(\d+)$/);
      if (!m) {
        throw new Error(
          `framework-esp32: unrecognized ADC channel name "${name}" in ${chip.id} descriptor`,
        );
      }
      return { unit: Number(m[1]) as 1 | 2, channel: `ADC_CHANNEL_${m[2]}` };
    }
  }
  throw new Error(`framework-esp32: pin ${pin} has no ADC channel on ${chip.id}`);
}

export function adcInitLines(): string[] {
  return [
    `// CUTTLEFISH_ADC_BEGIN`,
    `// ESP-IDF v6 oneshot driver + adc_cali_line_fitting calibration.`,
    `static adc_oneshot_unit_handle_t __tc_adc1_handle = nullptr;`,
    `static adc_oneshot_unit_handle_t __tc_adc2_handle = nullptr;`,
    `static bool __tc_adc1_chan_cfg[ADC_CHANNEL_MAX] = {0};`,
    `static bool __tc_adc2_chan_cfg[ADC_CHANNEL_MAX] = {0};`,
    `static adc_cali_handle_t __tc_adc1_cali[ADC_CHANNEL_MAX] = {nullptr};`,
    `static adc_cali_handle_t __tc_adc2_cali[ADC_CHANNEL_MAX] = {nullptr};`,
    ``,
    `static void __tc_adc_init(void) {`,
    `    if (__tc_adc1_handle) return;`,
    `    adc_oneshot_unit_init_cfg_t __tc_ucfg = {`,
    `        .unit_id = ADC_UNIT_1, .ulp_mode = ADC_ULP_MODE_DISABLE,`,
    `    };`,
    `    (void)adc_oneshot_new_unit(&__tc_ucfg, &__tc_adc1_handle);`,
    `}`,
    ``,
    `static adc_oneshot_unit_handle_t __tc_adc_handle(int unit) {`,
    `    if (unit == 1) { __tc_adc_init(); return __tc_adc1_handle; }`,
    `    if (!__tc_adc2_handle) {`,
    `        adc_oneshot_unit_init_cfg_t __tc_ucfg = {`,
    `            .unit_id = ADC_UNIT_2, .ulp_mode = ADC_ULP_MODE_DISABLE,`,
    `        };`,
    `        (void)adc_oneshot_new_unit(&__tc_ucfg, &__tc_adc2_handle);`,
    `    }`,
    `    return __tc_adc2_handle;`,
    `}`,
    ``,
    `static void __tc_adc_cfg_chan(int unit, adc_channel_t chan) {`,
    `    bool* __tc_arr = (unit == 1) ? __tc_adc1_chan_cfg : __tc_adc2_chan_cfg;`,
    `    if (!__tc_arr[chan]) {`,
    `        adc_oneshot_chan_cfg_t __tc_ccfg = {`,
    `            .atten = ADC_ATTEN_DB_11, .bitwidth = ADC_BITWIDTH_12,`,
    `        };`,
    `        (void)adc_oneshot_config_channel(__tc_adc_handle(unit), chan, &__tc_ccfg);`,
    `        __tc_arr[chan] = true;`,
    `    }`,
    `}`,
    ``,
    `static int __tc_adc_read(int unit, adc_channel_t chan) {`,
    `    __tc_adc_cfg_chan(unit, chan);`,
    `    int __tc_raw = 0;`,
    `    (void)adc_oneshot_read(__tc_adc_handle(unit), chan, &__tc_raw);`,
    `    return __tc_raw;`,
    `}`,
    ``,
    `static int __tc_adc_read_voltage(int unit, adc_channel_t chan) {`,
    `    __tc_adc_cfg_chan(unit, chan);`,
    `    adc_cali_handle_t* __tc_carr = (unit == 1) ? __tc_adc1_cali : __tc_adc2_cali;`,
    `    if (!__tc_carr[chan]) {`,
    `        adc_cali_line_fitting_config_t __tc_kcfg = {`,
    `            .unit_id = (unit == 1) ? ADC_UNIT_1 : ADC_UNIT_2,`,
    `            .atten = ADC_ATTEN_DB_11,`,
    `            .bitwidth = ADC_BITWIDTH_12,`,
    `            .chan = chan,`,
    `        };`,
    `        (void)adc_cali_create_line_fitting(&__tc_kcfg, &__tc_carr[chan]);`,
    `    }`,
    `    int __tc_raw = 0;`,
    `    (void)adc_oneshot_read(__tc_adc_handle(unit), chan, &__tc_raw);`,
    `    int __tc_mv = 0;`,
    `    (void)adc_cali_raw_to_voltage(__tc_carr[chan], __tc_raw, &__tc_mv);`,
    `    return __tc_mv;`,
    `}`,
    `// CUTTLEFISH_ADC_END`,
    ``,
  ];
}

/** Resolve a HAL adc.* op to ESP-IDF C++. */
export function lowerAdc(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'adc.read': {
      const { unit, channel } = resolveAdcChannel(o.pin);
      return { expression: `__tc_adc_read(${unit}, ${channel})` };
    }
    case 'adc.read_voltage': {
      const { unit, channel } = resolveAdcChannel(o.pin);
      return { expression: `__tc_adc_read_voltage(${unit}, ${channel})` };
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
