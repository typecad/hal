import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

export function powerInitLines(): string[] {
  return [
    `// CUTTLEFISH_POWER_BEGIN`,
    `// No runtime init needed for esp_sleep/esp_pm; flags carried by individual ops.`,
    `// CUTTLEFISH_POWER_END`,
    ``,
  ];
}

/** Map chip id to its esp_pm config struct name. */
function pmConfigStruct(chipId: string): string {
  switch (chipId) {
    case 'esp32s3': return 'esp_pm_config_esp32s3_t';
    case 'esp32c3': return 'esp_pm_config_esp32c3_t';
    case 'esp32c6': return 'esp_pm_config_esp32c6_t';
    case 'esp32':
    default:        return 'esp_pm_config_esp32_t';
  }
}

/** Resolve a HAL power.* op to ESP-IDF C++.
 *  Note: power.deep_sleep takes `ms` per HAL; convert to us for the IDF call. */
export function lowerPower(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'power.deep_sleep':
      return { code: `esp_sleep_enable_timer_wakeup(((uint64_t)${o.ms}) * 1000ULL); esp_deep_sleep_start();` };
    case 'power.deep_sleep_pin': {
      // Pin wakeup. Classic ESP32/S3 use ext0 (single RTC pin, level-triggered);
      // the pin must be initialized as an RTC GPIO first. C3/C6 have no ext0/ext1
      // and use the gpio_wakeup variant. profileDiagnostics flags non-RTC pins;
      // both API families only reliably wake from deep sleep on RTC-capable GPIO.
      const chip = getActiveChip();
      const pin = o.pin;
      const level = o.level ? 1 : 0;
      if (chip.gpio.wakeupApi === 'ext0_ext1') {
        return {
          code: `rtc_gpio_init((gpio_num_t)${pin}); esp_sleep_enable_ext0_wakeup((gpio_num_t)${pin}, ${level}); esp_deep_sleep_start();`,
        };
      }
      // gpio_wakeup (C3/C6): a pin-mask + level. level 1 → HIGH, 0 → LOW.
      const lvlMacro = level ? 'ESP_GPIO_WAKEUP_GPIO_HIGH' : 'ESP_GPIO_WAKEUP_GPIO_LOW';
      return {
        code: `esp_sleep_enable_gpio_wakeup((1ULL << ${pin}), ${lvlMacro}); esp_deep_sleep_start();`,
      };
    }
    case 'power.light_sleep':
      return { code: `esp_light_sleep_start();` };
    case 'power.set_cpu_frequency': {
      const chip = getActiveChip();
      const mhz = o.mhz;
      const structName = pmConfigStruct(chip.id);
      // esp_pm_configure pins the CPU frequency via max=min=requested. DFS is
      // disabled (max==min) so the radio/peripherals get a stable clock.
      const note = typeof mhz === 'number'
        ? `/* clamped to ${chip.cpu.minFreqMhz}-${chip.cpu.maxFreqMhz} MHz on ${chip.id} */`
        : `/* ${chip.id} supports ${chip.cpu.minFreqMhz}-${chip.cpu.maxFreqMhz} MHz */`;
      return {
        code: `${note} { ${structName} __tc_pm = { .max_freq_mhz = ${mhz}, .min_freq_mhz = ${mhz}, .light_sleep_enable = false }; (void)esp_pm_configure(&__tc_pm); }`,
      };
    }
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
