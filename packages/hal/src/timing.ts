import { rawCpp, getMillis, getMicros } from './emit.js';
import { callback } from './callback.js';

export class TimingClass {
  static readonly __instance_name = "Timing";
  millis(): number { return getMillis(); }
  micros(): number { return getMicros(); }
  delay(ms: number): void {}
  delayMicroseconds(us: number): void {}
  freeHeap(): number {
    rawCpp("return ESP.getFreeHeap();");
    return 0;
  }


  setInterval(handler: () => void, timeout: number): number {
    rawCpp(`return __tc_setInterval(${callback(handler)}, ${timeout});`);
    return 0;
  }

  setTimeout(handler: () => void, timeout: number): number {
    rawCpp(`return __tc_setTimeout(${callback(handler)}, ${timeout});`);
    return 0;
  }

  clearInterval(id: number): void {
    rawCpp(`__tc_clearInterval(${id});`);
  }

  clearTimeout(id: number): void {
    rawCpp(`__tc_clearTimeout(${id});`);
  }
}

export const Timing = new TimingClass();

export function delay(ms: number): void {}
export function millis(): number { return getMillis(); }
export function micros(): number { return getMicros(); }
export function delayMicroseconds(us: number): void {}
export function freeHeap(): number { return Timing.freeHeap(); }


export function setInterval(handler: () => void, timeout: number): number {
  rawCpp(`return __tc_setInterval(${callback(handler)}, ${timeout});`);
  return 0;
}

export function setTimeout(handler: () => void, timeout: number): number {
  rawCpp(`return __tc_setTimeout(${callback(handler)}, ${timeout});`);
  return 0;
}

export function clearInterval(id: number): void {
  rawCpp(`__tc_clearInterval(${id});`);
}

export function clearTimeout(id: number): void {
  rawCpp(`__tc_clearTimeout(${id});`);
}

export function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number { return 0; }
export function constrain(value: number, low: number, high: number): number { return 0; }
