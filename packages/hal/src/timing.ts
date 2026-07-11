import { rawCpp, getMillis, getMicros, getFreeHeap, delayMs, delayMicro } from './emit.js';
import { callback } from './callback.js';

export class TimingClass {
  static readonly __instance_name = "Timing";
  millis(): number { return getMillis(); }
  micros(): number { return getMicros(); }
  delay(ms: number): void { delayMs(ms); }
  delayMicroseconds(us: number): void { delayMicro(us); }
  freeHeap(): number {
    return getFreeHeap();
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

export function delay(ms: number): void { delayMs(ms); }
export function millis(): number { return getMillis(); }
export function micros(): number { return getMicros(); }
export function delayMicroseconds(us: number): void { delayMicro(us); }
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

/** Re-map a number from one range to another. Passes through to the Arduino
 *  core `map()` macro — the transpiler lowers this to a bare `map(...)` call,
 *  so the target framework must provide the implementation (Arduino.h does). */
export function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number { return 0; }
/** Constrain a number to a range. Passes through to the Arduino core
 *  `constrain()` macro — see note on `map()` above. */
export function constrain(value: number, low: number, high: number): number { return 0; }
