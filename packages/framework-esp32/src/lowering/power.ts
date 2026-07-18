import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

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
      // HAL gives ms; esp_sleep_enable_timer_wakeup takes microseconds.
      return { code: `esp_sleep_enable_timer_wakeup(((uint64_t)${o.ms}) * 1000ULL); esp_deep_sleep_start();` };
    case 'power.light_sleep':
      return { code: `esp_light_sleep_start();` };
    case 'power.set_cpu_frequency':
      // SPIKE: confirm against IDF 5.x headers. Likely rtc_clk_cpu_freq_set_freq_hz.
      // If no clean mapping, this becomes a documented no-op + warning.
      return { code: `rtc_clk_cpu_freq_set_freq_hz(${o.mhz});` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
