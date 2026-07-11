import { wdtEnable, wdtReset, wdtDisable } from './emit.js';

export class WDTClass {
  static readonly __instance_name = "WDT";

  enable(timeout: number | string): void {
    wdtEnable(timeout);
  }
  reset(): void {
    wdtReset();
  }
  disable(): void {
    wdtDisable();
  }
}

export const WDT = new WDTClass();
