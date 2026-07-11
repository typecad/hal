import { powerDeepSleep, powerLightSleep, powerSetCpuFrequency } from './emit.js';

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

  lightSleep(): void {
    powerLightSleep();
  }

  setCpuFrequency(mhz: number): void {
    powerSetCpuFrequency(mhz);
  }
}

export const Power = new PowerClass();
