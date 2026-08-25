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

/**
 * Resolve the SAADC channel index for an adc.read argument; -1 if unmapped.
 *
 * The numeric argument serves two HAL forms: `InputPin.readAnalog()` passes
 * a GPIO number, while the Arduino-compat `ADC.read(channel)` passes an ADC
 * channel number. Pin-first resolution keeps readAnalog behavior unchanged;
 * the channel fallback makes `ADC.read(n)` resolve on targets where channel
 * n does not alias GPIO n (e.g. the XIAO's AIN2 = P0.28). Where a number
 * matches both a mapped pin and another channel's index, the pin wins.
 */
export function adcChannelForPin(chip: ZephyrChipDescriptor, pin: number): number {
  const channels = chip.adc?.channels ?? [];
  const byPin = channels.find((c) => c.pin === pin);
  if (byPin) return byPin.channel;
  const byChannel = channels.find((c) => c.channel === pin);
  return byChannel ? byChannel.channel : -1;
}

/**
 * Emit the per-channel ADC setup state. One block per channel in the chip
 * descriptor that the PROGRAM ACTUALLY READS (`usedPins`) — an unread
 * channel's `static` setup function would trip -Wunused-function in the
 * single generated TU. When `usedPins` is omitted (probe paths with no
 * program), every descriptor channel is emitted. Each block is guarded by a
 * `static bool __tc_adc<N>_ready` so the first read configures it and
 * subsequent reads skip. Called from shimLines when the program uses ADC.
 */
export function adcInitLines(chip: ZephyrChipDescriptor, usedPins?: ReadonlySet<number>): string[] {
  const dev = `DEVICE_DT_GET(DT_NODELABEL(${chip.adc?.nodeLabel ?? 'adc'}))`;
  const res = chip.adc?.resolution ?? 12;
  const vref = chip.adc?.vrefMv ?? 3000;
  // Gain/reference are SoC-specific: the nRF SAADC scheme (gain 1/4 against
  // the 0.6V internal ref, vref-mv 3000 = VDD) is the default; the STM32
  // driver requires exactly ADC_GAIN_1 + ADC_REF_INTERNAL (Zephyr maps
  // "internal" to the VREF+ pad) with vref-mv = VDDA. The descriptor carries
  // the SoC's pair so the emitted channel setup validates in the driver.
  const gain = chip.adc?.gain ?? 'ADC_GAIN_1_4';
  const reference = chip.adc?.reference ?? 'ADC_REF_INTERNAL';
  const channels = (chip.adc?.channels ?? []).filter(
    (c) => !usedPins || usedPins.has(c.pin) || [...usedPins].some((n) => adcChannelForPin(chip, n) === c.channel),
  );
  const lines: string[] = ['// CUTTLEFISH_ADC_BEGIN'];
  lines.push(`static const struct device* __tc_adc_dev = ${dev};`);
  for (const c of channels) {
    const n = c.channel;
    lines.push(
      `static bool __tc_adc${n}_ready = false;`,
      `static void __tc_adc${n}_setup(void) {`,
      `    if (__tc_adc${n}_ready) return;`,
      `    const struct adc_channel_cfg cfg = {`,
      `        .gain = ${gain},`,
      `        .reference = ${reference},`,
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
  const gain = chip.adc?.gain ?? 'ADC_GAIN_1_4';
  const reference = chip.adc?.reference ?? 'ADC_REF_INTERNAL';

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
      // Read raw, convert to millivolts via adc_raw_to_millivolts with the
      // descriptor's gain (raw_to_millivolts divides out the gain the channel
      // was set up with). Returns mV as int.
      return {
        expression: `({ __tc_adc${ch}_setup(); int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(${ch}), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = ${res} }; adc_read(__tc_adc_dev, &__s); int32_t __v = __b; adc_raw_to_millivolts(${vref}, ${gain}, ${res}, &__v); __v; })`,
      };
    }
    case 'adc.get_resolution':
      return { expression: String(res) };
    case 'adc.set_reference':
      // Zephyr configures the reference at channel-setup time; runtime switching
      // would require re-setup. Record the intent as a no-op statement.
      return { code: `/* adc.set_reference(${o.reference}): configured at channel setup (${reference}) */` };
    case 'adc.get_reference':
      return { expression: `0 /* DEFAULT (${reference}) */` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
