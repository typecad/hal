import { emit } from './emit';
import { callback } from './callback';

export class TimingClass {
  static readonly __instance_name = "Timing";
  millis(): number { return 0; }
  micros(): number { return 0; }
  delay(ms: number): void {}
  delayMicroseconds(us: number): void {}

  setInterval(handler: () => void, timeout: number): number {
    emit(`return __tc_setInterval(${callback(handler)}, ${timeout});`);
    return 0;
  }

  setTimeout(handler: () => void, timeout: number): number {
    emit(`return __tc_setTimeout(${callback(handler)}, ${timeout});`);
    return 0;
  }

  clearInterval(id: number): void {
    emit(`__tc_clearInterval(${id});`);
  }

  clearTimeout(id: number): void {
    emit(`__tc_clearTimeout(${id});`);
  }
}

export const Timing = new TimingClass();

export function delay(ms: number): void {}
export function millis(): number { return 0; }
export function micros(): number { return 0; }
export function delayMicroseconds(us: number): void {}

export function setInterval(handler: () => void, timeout: number): number {
  return Timing.setInterval(handler, timeout);
}

export function setTimeout(handler: () => void, timeout: number): number {
  return Timing.setTimeout(handler, timeout);
}

export function clearInterval(id: number): void {
  Timing.clearInterval(id);
}

export function clearTimeout(id: number): void {
  Timing.clearTimeout(id);
}

export function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number { return 0; }
export function constrain(value: number, low: number, high: number): number { return 0; }
