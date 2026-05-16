import { pulseIn_, pulseInLong_, rawCpp } from './emit';
import { HIGH, LOW } from './constants';
import type { Pin, InputPin } from './gpio';

export declare function pulseIn(pin: number, value: number, timeout?: number): number;
export declare function pulseInLong(pin: number, value: number, timeout?: number): number;

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
    rawCpp(`return pulseInLong(${(pin as any)._pin}, ${value});`);
    return 0;
  }
}

class PulseMeasurement {
  private _pin: number;
  private _timeout: number | undefined;

  constructor(pin: Pin | InputPin) {
    this._pin = (pin as any)._pin;
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
