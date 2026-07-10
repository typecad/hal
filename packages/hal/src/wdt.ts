import { rawCpp } from './emit.js';

export class WDTClass {
  static readonly __instance_name = "WDT";

  enable(timeout: number | string): void {
    rawCpp(`wdt_enable(${timeout});`);
  }
  reset(): void {
    rawCpp(`wdt_reset();`);
  }
  disable(): void {
    rawCpp(`wdt_disable();`);
  }
}

export const WDT = new WDTClass();
