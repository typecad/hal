import { rawCpp } from './emit.js';
import { HIGH, LOW } from './constants.js';
import type { Pin, InputPin } from './gpio.js';

export function pulseIn(pin: number, value: number, timeout?: number): number {
  if (timeout !== undefined) {
    rawCpp(`return pulseIn(${pin}, ${value}, ${timeout});`);
  } else {
    rawCpp(`return pulseIn(${pin}, ${value});`);
  }
  return 0;
}
export function pulseInLong(pin: number, value: number, timeout?: number): number {
  if (timeout !== undefined) {
    rawCpp(`return pulseInLong(${pin}, ${value}, ${timeout});`);
  } else {
    rawCpp(`return pulseInLong(${pin}, ${value});`);
  }
  return 0;
}

export class Pulse {
  /** 
   * Functional entrypoint for measuring pulses.
   * @example Pulse.on(D7).high()
   */
  static on(pin: Pin | InputPin): PulseMeasurement {
    return new PulseMeasurement(pin);
  }

  /** Measure long pulses using high-precision 64-bit timers. */
  static long(pin: Pin | InputPin, value: number): number {
    rawCpp(`return pulseInLong(${pin.number}, ${value});`);
    return 0;
  }
}

class PulseMeasurement {
  private _pin: number;
  private _timeout: number | undefined;

  constructor(pin: Pin | InputPin) {
    this._pin = pin.number;
  }

  /** Set the maximum wait time for a pulse (in microseconds). */
  timeout(us: number): this {
    this._timeout = us;
    return this;
  }

  /** Measures the next HIGH pulse duration in microseconds. */
  high(): number {
    rawCpp(`return pulseIn(${this._pin}, HIGH${this._timeout !== undefined ? `, ${this._timeout}` : ""});`);
    return 0;
  }

  /** Measures the next LOW pulse duration in microseconds. */
  low(): number {
    rawCpp(`return pulseIn(${this._pin}, LOW${this._timeout !== undefined ? `, ${this._timeout}` : ""});`);
    return 0;
  }
}
