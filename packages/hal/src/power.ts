// ---------------------------------------------------------------------------
// Power — the thin power-management verbs
//
// Power is stateless on Zephyr (sleep entry goes through the power-management
// policy / sys_pm), so the surface is bare verbs with no construction facts:
//
//   deepSleep(ms)        → deep sleep for ms (wake resets the chip)
//   deepSleepUntil(pin, level) → deep sleep until the pin reaches level
//                          (RTC-capable pins only; the framework flags
//                          non-RTC pins at compile time; never returns)
//   lightSleep()         → light sleep until any wake source
//   setCpuFrequency(mhz) → relock the CPU clock
// ----------------------------------------------------------------------------

import { powerDeepSleep, powerLightSleep, powerSetCpuFrequency, powerDeepSleepPin } from './emit.js';

export class Power {
  /** Enter deep sleep for `ms`. Wakeup resets the chip — this call never
   *  returns. */
  deepSleep(ms: number): void {
    powerDeepSleep(ms);
  }

  /** Enter deep sleep until `pin` reaches `level` (0 = low, 1 = high).
   *  Lowers to ext0 wakeup (Xtensa ESP32/S3, RTC pins only) or the
   *  gpio-wakeup variant (RISC-V C3/C6) depending on the target. Wakeup
   *  resets the chip — this call never returns. */
  deepSleepUntil(pin: number, level: 0 | 1): void {
    powerDeepSleepPin(pin, level);
  }

  /** Enter light sleep until any wake source (GPIO/timer). */
  lightSleep(): void {
    powerLightSleep();
  }

  /** Set the CPU frequency in MHz. */
  setCpuFrequency(mhz: number): void {
    powerSetCpuFrequency(mhz);
  }
}

export const PowerDefault = new Power();
