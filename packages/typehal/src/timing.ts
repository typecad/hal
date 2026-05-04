export class TimingClass {
  millis(): number { return 0; }
  micros(): number { return 0; }
  delay(ms: number): void {}
  delayMicroseconds(us: number): void {}
}

export const Timing = new TimingClass();

export function delay(ms: number): void {}
export function millis(): number { return 0; }
export function micros(): number { return 0; }
export function delayMicroseconds(us: number): void {}

export function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number { return 0; }
export function constrain(value: number, low: number, high: number): number { return 0; }
