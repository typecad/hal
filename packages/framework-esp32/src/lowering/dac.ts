import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

export function dacInitLines(): string[] {
  return [
    `// CUTTLEFISH_DAC_BEGIN`,
    `// ESP-IDF v6 dac_oneshot driver (per-channel handles, lazy init).`,
    `static dac_oneshot_handle_t __tc_dac0_handle = nullptr;`,
    `static dac_oneshot_handle_t __tc_dac1_handle = nullptr;`,
    ``,
    `static dac_oneshot_handle_t __tc_dac_get(dac_channel_t chan) {`,
    `    if (chan == DAC_CHAN_0 && !__tc_dac0_handle) {`,
    `        dac_oneshot_config_t __tc_dcfg = { .chan = DAC_CHAN_0 };`,
    `        (void)dac_oneshot_output_new_channel(&__tc_dcfg, &__tc_dac0_handle);`,
    `    } else if (chan == DAC_CHAN_1 && !__tc_dac1_handle) {`,
    `        dac_oneshot_config_t __tc_dcfg = { .chan = DAC_CHAN_1 };`,
    `        (void)dac_oneshot_output_new_channel(&__tc_dcfg, &__tc_dac1_handle);`,
    `    }`,
    `    return (chan == DAC_CHAN_0) ? __tc_dac0_handle : __tc_dac1_handle;`,
    `}`,
    `// CUTTLEFISH_DAC_END`,
    ``,
  ];
}

function resolveDacChannel(pin: number): string {
  const chip = getActiveChip();
  if (chip.lacks.includes('dac') || !chip.dac) {
    throw new Error(`framework-esp32: ${chip.id} has no DAC peripheral`);
  }
  const channel = chip.dac.channelForPin[pin];
  if (!channel) {
    throw new Error(`framework-esp32: pin ${pin} is not a DAC pin on ${chip.id}`);
  }
  return channel;
}

/** Resolve a HAL dac.write op to ESP-IDF C++. */
export function lowerDac(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  if (op.operation !== 'dac.write') {
    throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
  const channel = resolveDacChannel(o.pin);
  return { code: `dac_oneshot_output_voltage(__tc_dac_get(${channel}), ${o.value});` };
}
