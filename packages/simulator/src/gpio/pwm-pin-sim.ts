// ---------------------------------------------------------------------------
// @typecode/simulator — Simulated PWM pin
// ---------------------------------------------------------------------------

import type { IPWMPin, IToneAttachment, AnalogValue } from '@typecode/core';
import { PinMode } from '@typecode/core';
import type { DigitalValue } from '@typecode/core';
import { SimDigitalPin } from './digital-pin-sim';

/**
 * Simulated PWM pin. Extends digital pin with PWM duty cycle control.
 */
export class SimPWMPin extends SimDigitalPin implements IPWMPin {
  private _pwmPercent: number = 0;
  private _pwmFrequency: number = 490; // Default Arduino PWM frequency
  private _pwmResolution: number = 8; // Default 8-bit
  private _attached: boolean = false;

  constructor(pinNum: number) {
    super(pinNum);
  }

  // --- IPWMPin ---

  write(value: DigitalValue | AnalogValue): void {
    if (typeof value === 'number' && value > 1) {
      // Analog write — treat as PWM duty cycle value
      this.pwm((value / ((1 << this._pwmResolution) - 1)) * 100);
    } else {
      super.write(value as DigitalValue);
    }
  }

  pwm(percent?: number): void {
    // Calling pwm() (no args) activates PWM mode, pwm(x) sets duty cycle
    // 0% duty cycle means PWM is inactive
    this._attached = percent === undefined || percent > 0;
    if (percent !== undefined) {
      this._pwmPercent = Math.max(0, Math.min(100, percent));
    }
  }

  setFrequency(hz: number): void {
    this._pwmFrequency = hz;
  }

  getFrequency(): number {
    return this._pwmFrequency;
  }

  getResolution(): number {
    return this._pwmResolution;
  }

  // --- Simulation helpers ---

  /**
   * Get the current PWM duty cycle as a percentage (0-100).
   */
  getPwmPercent(): number {
    return this._pwmPercent;
  }

  /**
   * Get the current PWM duty cycle as a raw value (0 to 2^resolution - 1).
   */
  getPwmValue(): number {
    return Math.round((this._pwmPercent / 100) * ((1 << this._pwmResolution) - 1));
  }

  /**
   * Check if PWM is currently active.
   */
  isPwmActive(): boolean {
    return this._attached;
  }

  /**
   * Set the PWM resolution in bits.
   */
  setResolution(bits: number): void {
    this._pwmResolution = bits;
  }

  override reset(): void {
    super.reset();
    this._pwmPercent = 0;
    this._pwmFrequency = 490;
    this._pwmResolution = 8;
    this._attached = false;
  }
}
