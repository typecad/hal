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
import { ZEPHYR_ADC_GAINS, ZEPHYR_ADC_REFERENCES } from '@typecad/hal';

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
 * Resolve the owning ADC controller's node label for an adc.read argument.
 * Defaults to the descriptor's primary (`chip.adc.nodeLabel`) — channels on
 * additional controllers (STM32 adc3-only routes, ESP32 adc2 pads) carry
 * their controller explicitly, and their device handle is
 * `__tc_adc_<label>_dev` (the primary keeps the unsuffixed `__tc_adc_dev`
 * so single-controller output is unchanged).
 */
export function adcControllerForPin(chip: ZephyrChipDescriptor, pin: number): string {
  const channels = chip.adc?.channels ?? [];
  const byPin = channels.find((c) => c.pin === pin);
  if (byPin) return byPin.controller ?? chip.adc?.nodeLabel ?? 'adc';
  const byChannel = channels.find((c) => c.channel === pin);
  return byChannel?.controller ?? chip.adc?.nodeLabel ?? 'adc';
}

/** The C++ device-handle symbol for an ADC controller nodelabel. The primary
 *  controller maps to the historical unsuffixed `__tc_adc_dev`. */
function adcDevSymbol(controller: string, primary: string): string {
  return controller === primary ? '__tc_adc_dev' : `__tc_adc_${controller}_dev`;
}

// ── Thin ADC (hal/adc-pin.ts) — gain/reference tokens ──────────────────────
//
// "ADC.GAIN_1_4" / "ADC.REF_INTERNAL" token text maps name-for-
// name onto the enum adc_gain / adc_reference macros. The name sets come from
// the GENERATED Zephyr token tables (scripts/gen-zephyr-hal-tokens.mjs —
// parsed from the pinned tree's headers, so the set cannot drift from
// upstream); empty/absent tokens mean "use the chip descriptor's pair".

const ADC_GAIN_TOKENS: Record<string, string> = Object.fromEntries(
  ZEPHYR_ADC_GAINS.map((g) => [`ADC.GAIN_${g}`, `ADC_GAIN_${g}`]),
);
const ADC_REF_TOKENS: Record<string, string> = Object.fromEntries(
  ZEPHYR_ADC_REFERENCES.map((r) => [`ADC.REF_${r}`, `ADC_REF_${r}`]),
);

/** Resolve one thin-ADC token to its macro; undefined when absent/empty.
 *  Unknown tokens are build errors naming the valid spellings. */
function adcThinToken(token: string | undefined, map: Record<string, string>, kind: string): string | undefined {
  const t = String(token ?? '').trim();
  if (!t || t === '0' || t === "''") return undefined;
  const m = map[t];
  if (!m) {
    throw new Error(
      `ADC ${kind} token '${t}' is not a known ADC.* token — valid ${kind}s: ${Object.keys(map).join(', ')}.`,
    );
  }
  return m;
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
export function adcInitLines(
  chip: ZephyrChipDescriptor,
  usedPins?: ReadonlySet<number>,
  overrideDevices?: ReadonlySet<string>,
): string[] {
  const primary = chip.adc?.nodeLabel ?? 'adc';
  const res = chip.adc?.resolution ?? 12;
  const vref = chip.adc?.vrefMv ?? 3000;
  // Gain/reference are SoC-specific: the nRF SAADC scheme (gain 1/4 against
  // the 0.6V internal ref, vref-mv 3000 = VDD) is the default; the STM32
  // driver requires exactly ADC_GAIN_1 + ADC_REF_INTERNAL (Zephyr maps
  // "internal" to the VREF+ pad) with vref-mv = VDDA. The descriptor carries
  // the SoC's pair so the emitted channel setup validates in the driver.
  const gain = chip.adc?.gain ?? 'ADC_GAIN_1_4';
  const reference = chip.adc?.reference ?? 'ADC_REF_INTERNAL';
  const owns = (c: { controller?: string }, label: string) => (c.controller ?? primary) === label;
  const channels = (chip.adc?.channels ?? []).filter(
    (c) =>
      !usedPins ||
      // Pin-form usage (the ADC/readAnalog path): the exact channel.
      [...usedPins].some((n) => n === c.pin) ||
      // Channel-number fallback (the Arduino-compat ADC.read(n) form) — must
      // match the CONTROLLER too, or colliding indices across controllers
      // (both ESP32 SARADC units expose channel 0) over-include.
      [...usedPins].some((n) => adcChannelForPin(chip, n) === c.channel && owns(c, adcControllerForPin(chip, n))),
  );
  const lines: string[] = ['// CUTTLEFISH_ADC_BEGIN'];
  lines.push(`static const struct device* __tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(${primary}));`);
  // Additional controllers referenced by used channels get their own device
  // handle (sorted for deterministic output). Channel indices collide across
  // controllers, so non-primary setup symbols carry the controller label.
  const extraControllers = [...new Set(channels.map((c) => c.controller).filter((x): x is string => !!x && x !== primary))].sort();
  // Inline-override devices (escape hatch): handles for the DT labels the
  // construction opts name — they may not appear in the manifest at all.
  for (const label of (overrideDevices ?? [])) {
    if (label !== primary && !extraControllers.includes(label)) extraControllers.push(label);
  }
  for (const label of extraControllers) {
    lines.push(`static const struct device* __tc_adc_${label}_dev = DEVICE_DT_GET(DT_NODELABEL(${label}));`);
  }
  for (const c of channels) {
    const n = c.channel;
    const dev = adcDevSymbol(c.controller ?? primary, primary);
    const sym = c.controller && c.controller !== primary ? `__tc_adc_${c.controller}_${n}` : `__tc_adc${n}`;
    lines.push(
      `static bool ${sym}_ready = false;`,
      `static void ${sym}_setup(void) {`,
      `    if (${sym}_ready) return;`,
      `    const struct adc_channel_cfg cfg = {`,
      `        .gain = ${gain},`,
      `        .reference = ${reference},`,
      `        .acquisition_time = ADC_ACQ_TIME_DEFAULT,`,
      `        .channel_id = ${n},`,
      `        .differential = 0,`,
      `    };`,
      `    adc_channel_setup(${dev}, &cfg);`,
      `    ${sym}_ready = true;`,
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
    case 'adc.read_raw':
    case 'adc.read_mv': {
      // Construction-time overrides (hal/adc-pin.ts opts: channel/device/
      // pinctrl): the user vouches for the routing on a pin the facts layer
      // does not cover. The channel and device symbol come from the op; the
      // marker comment carries device/pinctrl to the overlay regen (the
      // transpiler cannot synthesize DT nodes) and suppresses the
      // unavailable-pin diagnostic.
      const hasOverride = (typeof o.channelOverride === 'number' && o.channelOverride >= 0)
        || (typeof o.deviceOverride === 'string' && o.deviceOverride !== '')
        || (typeof o.pinctrlOverride === 'string' && o.pinctrlOverride !== '');
      const ch = hasOverride && typeof o.channelOverride === 'number' && o.channelOverride >= 0
        ? (o.channelOverride as number)
        : adcChannelForPin(chip, o.pin);
      const primary = chip.adc?.nodeLabel ?? 'adc';
      const devCtrl = (typeof o.deviceOverride === 'string' && o.deviceOverride !== '')
        ? (o.deviceOverride as string)
        : adcControllerForPin(chip, o.pin);
      const dev = adcDevSymbol(devCtrl, primary);
      const gainMacro = adcThinToken(o.gain, ADC_GAIN_TOKENS, 'gain');
      const refMacro = adcThinToken(o.reference, ADC_REF_TOKENS, 'reference');
      const g = gainMacro ?? gain;
      const r = refMacro ?? reference;
      const marker = hasOverride
        ? `/* cuttlefish-user-facts: adc pin=${o.pin}`
          + `${typeof o.deviceOverride === 'string' && o.deviceOverride !== '' ? ` device=${o.deviceOverride}` : ''}`
          + `${typeof o.pinctrlOverride === 'string' && o.pinctrlOverride !== '' ? ` pinctrl=${o.pinctrlOverride}` : ''}`
          + ` channel=${ch} */ `
        : '';
      const setup = `static bool __tc_adct${o.pin}_done = false; if (!__tc_adct${o.pin}_done) { const struct adc_channel_cfg __tc_adct${o.pin}_cfg = { .gain = ${g}, .reference = ${r}, .acquisition_time = ADC_ACQ_TIME_DEFAULT, .channel_id = ${ch}, .differential = 0 }; adc_channel_setup(${dev}, &__tc_adct${o.pin}_cfg); __tc_adct${o.pin}_done = true; }`;
      const read = `int16_t __b = 0; struct adc_sequence __s = { .channels = BIT(${ch}), .buffer = &__b, .buffer_size = sizeof(__b), .resolution = ${res} }; adc_read(${dev}, &__s);`;
      if (op.operation === 'adc.read_raw') {
        return { expression: `({ ${marker}${setup} ${read} __b; })` };
      }
      return {
        expression: `({ ${marker}${setup} ${read} int32_t __v = __b; adc_raw_to_millivolts(${vref}, ${g}, ${res}, &__v); __v; })`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
