// ---------------------------------------------------------------------------
// DAC lowering — Zephyr DAC driver via dac_channel_setup / dac_write_value
//
// Targets with a DAC (ESP32: 2× 8-bit channels on GPIO25/26) declare a `dac`
// entry in the chip descriptor: the DT device node label + the pin→channel map.
// The lowering emits a `dac_channel_setup` (lazy, on first write) + a
// `dac_write_value` against DEVICE_DT_GET(DT_NODELABEL(<device>)).
//
// Targets without a DAC (nRF52840, ESP32-S3) omit `dac`; usage there lowers to a
// comment and profileDiagnostics flags it (mirror of the ADC pin-validity gate).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor, ZephyrDacChannel } from '../chips/types.js';

/** Look up a DAC channel by HAL pin number. */
function findDacChannel(chip: ZephyrChipDescriptor, pin: number): ZephyrDacChannel | undefined {
  return chip.dac?.channels.find((c) => c.pin === pin);
}

/**
 * Emit the DAC device handle. Called from shimLines when the program uses the
 * DAC (the chip must declare a `dac` entry, or nothing is emitted).
 */
export function dacInitLines(chip: ZephyrChipDescriptor): string[] {
  if (!chip.dac) return [];
  return [
    '// CUTTLEFISH_DAC_BEGIN',
    `static const struct device* __tc_dac_dev = DEVICE_DT_GET(DT_NODELABEL(${chip.dac.device}));`,
    '// CUTTLEFISH_DAC_END',
  ];
}

/**
 * Resolve a HAL dac.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerDac(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;

  // No DAC on this target (e.g. nRF52840). Return a comment so the resolver
  // reports non-undefined (the manifest validator's probe sends pin:25 on the
  // default chip, which has no DAC). profileDiagnostics flags real misuse.
  if (!chip.dac) {
    return { code: `/* dac on pin ${o.pin}: no DAC on ${chip.id} */` };
  }

  const ch = findDacChannel(chip, o.pin);
  if (!ch) {
    const valid = [...chip.dac.channels].map((c) => c.pin).sort((a, b) => a - b).join(', ');
    return {
      code: `/* dac on pin ${o.pin}: not a DAC pin on ${chip.id} (valid: ${valid}) */`,
    };
  }

  switch (op.operation) {
    case 'dac.write_value': {
      // Thin DAC: raw code with the construction resolution (0 = the
      // descriptor channel's), lazy setup per pin.
      const res = Number(o.resolution) > 0 ? Number(o.resolution) : ch.resolution;
      return {
        code: [
          `{ static bool __tc_dact${o.pin}_done = false;`,
          `  if (!__tc_dact${o.pin}_done) {`,
          `    static const struct dac_channel_cfg __tc_dact${o.pin}_cfg = { .channel_id = ${ch.channel}, .resolution = ${res} };`,
          `    (void)dac_channel_setup(__tc_dac_dev, &__tc_dact${o.pin}_cfg);`,
          `    __tc_dact${o.pin}_done = true;`,
          `  }`,
          `  (void)dac_write_value(__tc_dac_dev, ${ch.channel}, ${o.value}); }`,
        ].join(' '),
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
