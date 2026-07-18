import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

export function dacInitLines(): string[] {
  return [
    `// CUTTLEFISH_DAC_BEGIN`,
    `static void __tc_dac_init(void) {`,
    `    dac_output_enable(DAC_CHAN_0);`,
    `    dac_output_enable(DAC_CHAN_1);`,
    `}`,
    `// CUTTLEFISH_DAC_END`,
    ``,
  ];
}

/** Resolve a HAL dac.write op to ESP-IDF C++.
 *  DAC1 = GPIO25, DAC2 = GPIO26 on classic ESP32. */
export function lowerDac(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  if (op.operation !== 'dac.write') {
    throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
  const channel = o.pin === 25 ? 'DAC_CHAN_0' : o.pin === 26 ? 'DAC_CHAN_1' : 'DAC_CHAN_0';
  return { code: `dac_output_voltage(${channel}, ${o.value});` };
}
