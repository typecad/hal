// ---------------------------------------------------------------------------
// @typecode/simulator — Simulated analog input pin
// ---------------------------------------------------------------------------

import type { IAnalogInput } from '@typecode/core';
import { PinMode } from '@typecode/core';
import type { AnalogValue } from '@typecode/core';

/**
 * Simulated analog input pin.
 *
 * Tests can inject values via `injectValue()` and verify readings.
 */
export class SimAnalogPin implements IAnalogInput {
  readonly number: number;
  readonly gpio: number;

  private _value: AnalogValue = 0;
  private _voltage: number = 0;
  private _reference: number = 5.0; // Default 5V reference
  private _resolution: number = 10; // Default 10-bit (0-1023)
  private _pinMode: PinMode = PinMode.INPUT;

  constructor(pinNum: number) {
    this.number = pinNum;
    this.gpio = pinNum;
  }

  // --- IPin ---

  getMode(): PinMode {
    return this._pinMode;
  }

  setMode(mode: PinMode): void {
    this._pinMode = mode;
  }

  // --- Configuration shortcut ---

  analog(): void {
    this._pinMode = PinMode.INPUT;
  }

  // --- IAnalogInput ---

  read(): AnalogValue {
    return this._value;
  }

  readVoltage(): number {
    return this._voltage;
  }

  setReference(voltage: number): void {
    this._reference = voltage as number;
  }

  getResolution(): number {
    return this._resolution;
  }

  // --- Simulation helpers ---

  /**
   * Inject an analog value (e.g., sensor reading).
   * @param value - Raw ADC value (0 to 2^resolution - 1)
   */
  injectValue(value: AnalogValue): void {
    this._value = value;
    // Calculate voltage from ADC value
    const maxAdc = (1 << this._resolution) - 1;
    this._voltage = (value / maxAdc) * this._reference;
  }

  /**
   * Inject a voltage directly. Converts to ADC value based on resolution.
   */
  injectVoltage(voltage: number): void {
    this._voltage = voltage;
    const maxAdc = (1 << this._resolution) - 1;
    this._value = Math.round((voltage / this._reference) * maxAdc);
  }

  /**
   * Set the ADC resolution in bits.
   */
  setResolution(bits: number): void {
    this._resolution = bits;
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    this._value = 0;
    this._voltage = 0;
    this._reference = 5.0;
    this._resolution = 10;
    this._pinMode = PinMode.INPUT;
  }
}
