import { emit } from './emit';

export class WDTClass {
  enable(timeout?: string): void {
    if (timeout) {
      emit(`wdt_enable(${timeout});`);
    } else {
      emit(`wdt_enable(WDTO_4S);`);
    }
  }
  reset(): void { emit(`wdt_reset();`); }
  disable(): void { emit(`wdt_disable();`); }
}

export const WDT = new WDTClass();
