// ---------------------------------------------------------------------------
// ADC lowering — nRF SAADC via raw adc_read
//
// The XIAO nRF52840 has no pre-declared ADC channel nodes in devicetree, so we
// cannot use the `adc_dt_spec` convenience. Instead the lowering configures the
// channel up-front against DEVICE_DT_GET(DT_NODELABEL(adc)) and reads it with
// `adc_read`. The channel index comes from the chip descriptor's pin→channel
// map (XIAO D0–D3 = AIN0–AIN3).
//
// Channel setup is emitted in adcInitLines() (one per channel used); the ops
// then just read. A static `adc_channel_cfg` + a per-channel "configured" flag
// guards the setup, so repeated reads don't reconfigure.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';

/** Resolve the SAADC channel index for a HAL pin number; -1 if unmapped. */
export function adcChannelForPin(chip: ZephyrChipDescriptor, pin: number): number {
  const ch = chip.adc?.channels.find((c) => c.pin === pin);
  return ch ? ch.channel : -1;
}

/**
 * Emit the per-channel ADC setup state. One block per channel in the chip
 * descriptor, each guarded by a `static bool __tc_adc<N>_ready` so the first
 * read configures it and subsequent reads skip. Called from shimLines when
 * the program uses ADC.
 */
export function adcInitLines(chip: ZephyrChipDescriptor): string[] {
  const dev = `DEVICE_DT_GET(DT_NODELABEL(${chip.adc?.nodeLabel ?? 'adc'}))`;
  const res = chip.adc?.resolution ?? 12;
  const vref = chip.adc?.vrefMv ?? 3000;
  const lines: string[] = ['// CUTTLEFISH_ADC_BEGIN'];
  lines.push(`static const struct device* __tc_adc_dev = ${dev};`);
  for (const c of chip.adc?.channels ?? []) {
    const n = c.channel;
    lines.push(
      `static bool __tc_adc${n}_ready = false;`,
      `static void __tc_adc${n}_setup(void) {`,
      `    if (__tc_adc${n}_ready) return;`,
      `    const struct adc_channel_cfg cfg = {`,
      `        .gain = ADC_GAIN_1_4,`,
      `        .reference = ADC_REF_INTERNAL,`,
      `        .acquisition_time = ADC_ACQ_TIME_DEFAULT,`,
      `        .channel_id = ${n},`,
      `        .differential = 0,`,
      `    };`,
      `    adc_channel_setup(__tc_adc_dev, &cfg);`,
      `    __tc_adc${n}_ready = true;`,
      `}`,
    );
  }
  lines.push(`#define __TC_ADC_VREF_MV ${vref}`);
  lines.push(`#define __TC_ADC_RESOLUTION ${res}`);
  lines.push('// CUTTLEFISH_ADC_END');
  return lines;
}

/**
 * Resolve a HAL adc.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerAdc(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const res = chip.adc?.resolution ?? 12;
  const vref = chip.adc?.vrefMv ?? 3000;

  switch (op.operation) {
    case 'adc.read': {
      const ch = adcChannelForPin(chip, o.pin);
      // GCC statement-expression: configures-on-first-call, reads, returns raw.
      return {
        expression: `({ __tc_adc${ch}_setup(); int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(${ch}), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = ${res} }; adc_read(__tc_adc_dev, &__s); __b; })`,
      };
    }
    case 'adc.read_voltage': {
      const ch = adcChannelForPin(chip, o.pin);
      // Read raw, convert to millivolts via adc_raw_to_millivolts (gain 1/4,
      // internal ref). Returns mV as int.
      return {
        expression: `({ __tc_adc${ch}_setup(); int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(${ch}), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = ${res} }; adc_read(__tc_adc_dev, &__s); int32_t __v = __b; adc_raw_to_millivolts(${vref}, ADC_GAIN_1_4, ${res}, &__v); __v; })`,
      };
    }
    case 'adc.get_resolution':
      return { expression: String(res) };
    case 'adc.set_reference':
      // Zephyr configures the reference at channel-setup time; runtime switching
      // would require re-setup. Record the intent as a no-op statement.
      return { code: `/* adc.set_reference(${o.reference}): configured at channel setup (ADC_REF_INTERNAL) */` };
    case 'adc.get_reference':
      return { expression: `0 /* DEFAULT (ADC_REF_INTERNAL) */` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
