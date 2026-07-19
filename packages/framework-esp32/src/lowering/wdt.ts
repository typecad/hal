import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

export function wdtInitLines(): string[] {
  return [
    `// CUTTLEFISH_WDT_BEGIN`,
    `static void __tc_wdt_init(uint32_t timeout_ms) {`,
    `    // esp_task_wdt_init may already be called by the IDF default startup`,
    `    // (CONFIG_ESP_TASK_WDT_INIT=y). If so, reconfigure with our timeout.`,
    `    esp_task_wdt_config_t cfg = {`,
    `        .timeout_ms = timeout_ms,`,
    `        .idle_core_mask = 0x03,  // Subscribe idle tasks on both cores`,
    `        .trigger_panic = true,`,
    `    };`,
    `    esp_task_wdt_init(&cfg);`,
    `    esp_task_wdt_add(NULL);`,
    `}`,
    `// CUTTLEFISH_WDT_END`,
    ``,
  ];
}

/** Resolve a HAL wdt.* op to ESP-IDF C++ (task watchdog, not RTC watchdog). */
export function lowerWdt(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'wdt.enable': {
      // timeout may be a duration string ("250ms"), WDTO_* name, or a number (ms).
      // For v1 we pass it through; the IDF init takes ms.
      return { code: `__tc_wdt_init(${o.timeout});` };
    }
    case 'wdt.reset':
      return { code: `esp_task_wdt_reset();` };
    case 'wdt.disable':
      return { code: `esp_task_wdt_delete(NULL); esp_task_wdt_deinit();` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
