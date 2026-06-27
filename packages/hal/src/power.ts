import { rawCpp } from './emit.js';
import { board } from './board.js';

/**
 * PowerClass provides control over MCU power states and clock frequencies.
 */
export class PowerClass {
  static readonly __instance_name = "Power";

  deepSleep(ms: number): void {
    const arch: any = board("architecture");
    if (arch === "esp32") {
      rawCpp(`esp_sleep_enable_timer_wakeup(${ms} * 1000);`);
      rawCpp(`esp_deep_sleep_start();`);
    } else {
      rawCpp(`// Architecture ${board("architecture")} does not support deep sleep yet`);
    }
  }

  lightSleep(): void {
    const arch: any = board("architecture");
    if (arch === "esp32") {
      rawCpp(`esp_light_sleep_start();`);
    } else {
      rawCpp(`// Architecture ${board("architecture")} does not support light sleep yet`);
    }
  }

  setCpuFrequency(mhz: number): void {
    rawCpp(`setCpuFrequencyMhz(${mhz});`);
  }
}

export const Power = new PowerClass();
