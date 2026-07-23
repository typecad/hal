import { powerDeepSleep, powerLightSleep, powerSetCpuFrequency, powerDeepSleepPin } from './emit.js';

/**
 * PowerClass provides control over MCU power states and clock frequencies.
 *
 * The arch guard (ESP32 family vs AVR) lives in the strategy, not here — it
 * relies on the FQBN-derived architecture which is always available at
 * transpile time, unlike `board("architecture")` which needs a board package.
 */
export class PowerClass {
  static readonly __instance_name = "Power";

  deepSleep(ms: number): void {
    powerDeepSleep(ms);
  }

  /** Enter deep sleep until `pin` reaches `level` (0 = low, 1 = high).
   *
   *  Lowers to ext0 wakeup (Xtensa ESP32/S3, RTC pins only) or the gpio-wakeup
   *  variant (RISC-V C3/C6) depending on the target. `pin` must be RTC-capable;
   *  the framework flags non-RTC pins at compile time. Wakeup resets the chip,
   *  so this call never returns. */
  deepSleepPin(pin: number, level: 0 | 1): void {
    powerDeepSleepPin(pin, level);
  }

  lightSleep(): void {
    powerLightSleep();
  }

  setCpuFrequency(mhz: number): void {
    powerSetCpuFrequency(mhz);
  }
}

export const Power = new PowerClass();
