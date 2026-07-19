import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

export function powerInitLines(): string[] {
  return [
    `// CUTTLEFISH_POWER_BEGIN`,
    `// No runtime init needed for esp_sleep; flags carried by individual ops.`,
    `// CUTTLEFISH_POWER_END`,
    ``,
  ];
}

/** Resolve a HAL power.* op to ESP-IDF C++.
 *  Note: power.deep_sleep takes `ms` per HAL; convert to us for the IDF call. */
export function lowerPower(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'power.deep_sleep':
      return { code: `esp_sleep_enable_timer_wakeup(((uint64_t)${o.ms}) * 1000ULL); esp_deep_sleep_start();` };
    case 'power.light_sleep':
      return { code: `esp_light_sleep_start();` };
    case 'power.set_cpu_frequency': {
      const chip = getActiveChip();
      const mhz = o.mhz;
      // Clamp to chip-supported range at emit time when the value is a literal.
      const note = typeof mhz === 'number'
        ? `/* clamped to ${chip.cpu.minFreqMhz}-${chip.cpu.maxFreqMhz} MHz on ${chip.id} */`
        : `/* ${chip.id} supports ${chip.cpu.minFreqMhz}-${chip.cpu.maxFreqMhz} MHz */`;
      return {
        code: `${note} ({ rtc_cpu_freq_config_t __tc_cpu_cfg; rtc_clk_cpu_freq_mhz_to_config(${mhz}, &__tc_cpu_cfg); rtc_clk_cpu_freq_set_config(&__tc_cpu_cfg); });`,
      };
    }
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
