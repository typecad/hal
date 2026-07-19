import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

export function dacInitLines(): string[] {
  return [
    `// CUTTLEFISH_DAC_BEGIN`,
    `static bool __tc_dac_ready = false;`,
    `static void __tc_dac_init(void) {`,
    `    if (__tc_dac_ready) return;`,
    `    dac_output_enable(DAC_CHAN_0);`,
    `    dac_output_enable(DAC_CHAN_1);`,
    `    __tc_dac_ready = true;`,
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
  return { code: `__tc_dac_init(); dac_output_voltage(${channel}, ${o.value});` };
}
