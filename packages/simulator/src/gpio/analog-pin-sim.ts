// ---------------------------------------------------------------------------
// @typecad/simulator — Simulated analog input pin
// ---------------------------------------------------------------------------

import type { AnalogPin } from '../contracts.js';
import type { AnalogValue } from '@typecad/hal';
import { SimDigitalPin } from './digital-pin-sim.js';

/**
 * Simulated analog input pin.
 *
 * Extends SimDigitalPin with analog read capabilities.
 * Tests can inject values via `injectValue()` and verify readings.
 *
 * - `read()` returns a digital boolean (HIGH if above half-scale).
 * - `readAnalog()` returns the raw ADC value.
 */
export class SimAnalogPin extends SimDigitalPin implements AnalogPin {
  private _analogValue: AnalogValue = 0;
  private _voltage: number = 0;
  private _reference: number = 5.0; // Default 5V reference
  private _resolution: number = 10; // Default 10-bit (0-1023)

  constructor(pinNum: number) {
    super(pinNum, { analogInput: true });
  }

  // --- AnalogPin capability methods ---

  /** Convenience: set pin to analog input mode. */
  analog(): void {
    this.asInput();
  }

  readAnalog(): AnalogValue {
    return this._analogValue;
  }

  readVoltage(): number {
    return this._voltage;
  }

  setAnalogReference(voltage: number): void {
    this._reference = voltage;
  }

  getAnalogResolution(): number {
    return this._resolution;
  }

  // --- Simulation helpers ---

  /**
   * Inject an analog value (e.g., sensor reading).
   * Also updates the digital read state based on threshold.
   * @param value - Raw ADC value (0 to 2^resolution - 1)
   */
  override injectValue(value: AnalogValue): void {
    this._analogValue = value;
    // Calculate voltage from ADC value
    const maxAdc = (1 << this._resolution) - 1;
    this._voltage = (value / maxAdc) * this._reference;
    // Update digital state: HIGH if above half-scale
    super.injectValue(value > (maxAdc / 2) ? 1 : 0);
  }

  /**
   * Inject a voltage directly. Converts to ADC value based on resolution.
   */
  injectVoltage(voltage: number): void {
    this._voltage = voltage;
    const maxAdc = (1 << this._resolution) - 1;
    this._analogValue = Math.round((voltage / this._reference) * maxAdc);
    super.injectValue(this._analogValue > (maxAdc / 2) ? 1 : 0);
  }

  /**
   * Set the ADC resolution in bits.
   */
  setResolution(bits: number): void {
    this._resolution = bits;
  }

  override reset(): void {
    super.reset();
    this._analogValue = 0;
    this._voltage = 0;
    this._reference = 5.0;
    this._resolution = 10;
  }
}
