import { emit } from './emit';
import { board } from './board';

/**
 * PowerClass provides control over MCU power states and clock frequencies.
 */
export class PowerClass {
  static readonly __instance_name = "Power";

  deepSleep(ms: number): void {
    if (board("architecture") === "esp32") {
      emit(`esp_sleep_enable_timer_wakeup(${ms} * 1000);`);
      emit(`esp_deep_sleep_start();`);
    } else {
      emit(`// Architecture ${board("architecture")} does not support deep sleep yet`);
    }
  }

  lightSleep(): void {
    if (board("architecture") === "esp32") {
      emit(`esp_light_sleep_start();`);
    } else {
      emit(`// Architecture ${board("architecture")} does not support light sleep yet`);
    }
  }

  setCpuFrequency(mhz: number): void {
    emit(`setCpuFrequencyMhz(${mhz});`);
  }
}

export const Power = new PowerClass();
