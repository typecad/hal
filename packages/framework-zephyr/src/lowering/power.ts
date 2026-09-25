// ---------------------------------------------------------------------------
// Power lowering — sys_poweroff() for explicit soft-off entry
//
// Both SoC families implement the kernel's sys_poweroff(): ESP32 parks the
// RTC domain and calls esp_deep_sleep_start(); STM32 enters standby-class
// deep sleep. The call never returns — wake is a reset or a wake source
// (board-specific: the Black Pill's WKUP pin is PA0; ESP32 GPIOs armed as
// wake triggers). Statement emission continues after the call site, but
// nothing there runs — the transpiler treats it as any other void call.
// ----------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';

/**
 * Resolve a HAL power.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerPower(op: HALOpIR, chip?: ZephyrChipDescriptor): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'power.off':
      return { code: 'sys_poweroff();' };
    case 'power.off_for': {
      // DAC discipline: without the RTC wake-timer fact, a timed off would
      // sleep with no wake source — lower to a comment naming it.
      if (!chip?.powerWakeTimer) {
        return { code: `/* Power.offFor(${o.ms} ms): this board's SoC declares no RTC wake timer — soft-off here has no armed wake; use Power.off() */` };
      }
      // Arm the RTC timer (µs), then enter soft-off; wake is a reboot.
      return {
        code: `{ esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(${o.ms}) * 1000ULL); sys_poweroff(); }`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
