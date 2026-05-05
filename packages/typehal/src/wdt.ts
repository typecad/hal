import { emit } from './emit';

export class WDTClass {
  static readonly __instance_name = "WDT";

  enable(timeout: number | string): void {
    emit(`wdt_enable(${timeout});`);
  }
  reset(): void {
    emit(`wdt_reset();`);
  }
  disable(): void {
    emit(`wdt_disable();`);
  }
}

export const WDT = new WDTClass();

export function wdt_enable(timeout: number | string): void {}
export function wdt_reset(): void {}
export function wdt_disable(): void {}
