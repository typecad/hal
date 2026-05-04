import { emit } from './emit';

export class WDTClass {
  enable(timeout: number): void {
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
