export class WDTClass {
  enable(timeout: number | string): void {}
  reset(): void {}
  disable(): void {}
}

export const WDT = new WDTClass();

export function wdt_enable(timeout: number | string): void {}
export function wdt_reset(): void {}
export function wdt_disable(): void {}
