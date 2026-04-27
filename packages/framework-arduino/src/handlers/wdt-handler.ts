// ---------------------------------------------------------------------------
// WDT (Watchdog Timer) namespace handler — maps TypeCode WDT.* calls to
// Arduino/AVR or ESP32 C++.
//
// The watchdog timer is used to automatically reset the microcontroller if
// the software locks up.  On AVR targets this requires <avr/wdt.h>.
// On ESP32 targets the framework uses the ESP-IDF watchdog API instead
// (<esp_task_wdt.h>).
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typecode/core/shared';

/**
 * Watchdog timeout constants.  These map to the wdt_enable() timeout flags
 * defined in <avr/wdt.h>.  The values mirror the standard WDTO_* macros.
 */
const WDT_TIMEOUT_MAP: Record<string, string> = {
  '15ms':  'WDTO_15MS',
  '30ms':  'WDTO_30MS',
  '60ms':  'WDTO_60MS',
  '120ms': 'WDTO_120MS',
  '250ms': 'WDTO_250MS',
  '500ms': 'WDTO_500MS',
  '1s':    'WDTO_1S',
  '2s':    'WDTO_2S',
  '4s':    'WDTO_4S',
  '8s':    'WDTO_8S',
};

/**
 * Render WDT namespace calls to Arduino/AVR or ESP32 C++.
 *
 * AVR (default):
 * - WDT.enable(timeout)  → wdt_enable(WDTO_*) / wdt_enable(timeout)
 * - WDT.reset()          → wdt_reset()
 * - WDT.disable()        → wdt_disable()
 *
 * ESP32:
 * - WDT.enable()         → esp_task_wdt_add(NULL)
 * - WDT.reset()          → esp_task_wdt_reset()
 * - WDT.disable()        → esp_task_wdt_delete(NULL)
 */
export function renderWDTCall(
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  architecture?: string,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  if (architecture === 'esp32') {
    switch (method) {
      case 'enable':  return 'esp_task_wdt_add(NULL)';
      case 'reset':   return 'esp_task_wdt_reset()';
      case 'disable': return 'esp_task_wdt_delete(NULL)';
      default:        return undefined;
    }
  }

  switch (method) {
    case 'enable': {
      if (args.length === 0) return 'wdt_enable(WDTO_2S)';
      const raw = a(0);
      // Strip surrounding quotes from a string literal argument so we can
      // look it up in WDT_TIMEOUT_MAP
      const stripped = raw.replace(/^["']|["']$/g, '');
      const macro = WDT_TIMEOUT_MAP[stripped];
      return `wdt_enable(${macro ?? raw})`;
    }
    case 'reset':
      return 'wdt_reset()';
    case 'disable':
      return 'wdt_disable()';
    default:
      return undefined;
  }
}
