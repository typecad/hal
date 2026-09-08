// ---------------------------------------------------------------------------
// @typecad/hal/sim — Simulated digital pin
// ---------------------------------------------------------------------------

import type {
  BasePin,
  PinCapabilityFlags,
} from '../contracts.js';
import { PinMode } from '../../index.js';
import type { DigitalValue } from '../../index.js';

/**
 * Tracks the history of pin state changes for test assertions.
 */
export interface PinStateChange {
  /** Timestamp (ms since simulation start) */
  timestamp: number;
  /** Previous value (0 or 1) */
  from: number;
  /** New value (0 or 1) */
  to: number;
}

/**
 * Convert a DigitalValue to a plain 0/1 number.
 */
function toBitValue(value: DigitalValue): number {
  return value ? 1 : 0;
}

/**
 * Simulated digital pin that tracks state transitions.
 */
/** Default capability flags for a digital pin. */
const DEFAULT_DIGITAL_CAPS: PinCapabilityFlags = {
  digitalInput: true,
  digitalOutput: true,
  analogInput: false,
  analogOutput: false,
  pwm: false,
  interrupt: false,
  pullUp: true,
  pullDown: false,
  touch: false,
  openDrain: false,
};

export class SimDigitalPin implements BasePin {
  readonly number: number;
  readonly gpio: number;
  readonly capabilities: PinCapabilityFlags;

  private _value: number = 0;
  private _pinMode: PinMode = PinMode.OUTPUT;
  private _history: PinStateChange[] = [];
  protected _startTime: number = Date.now();

  constructor(pinNum: number, caps?: Partial<PinCapabilityFlags>) {
    this.number = pinNum;
    this.gpio = pinNum;
    this.capabilities = { ...DEFAULT_DIGITAL_CAPS, ...caps };
  }

  // --- BasePin ---

  getMode(): PinMode {
    return this._pinMode;
  }

  setMode(mode: PinMode): void {
    this._pinMode = mode;
  }

  has(capability: keyof PinCapabilityFlags): boolean {
    return this.capabilities[capability];
  }

  // --- Pin configuration ---

  inputPullUp(): void {
    this._pinMode = PinMode.INPUT_PULLUP;
    this._setBitValue(1);
  }

  inputPullDown(): void {
    this._pinMode = PinMode.INPUT_PULLDOWN;
    this._setBitValue(0);
  }

  outputOpenDrain(initial?: DigitalValue): void {
    this._pinMode = PinMode.OUTPUT_OPEN_DRAIN;
    if (initial !== undefined) {
      this._setBitValue(toBitValue(initial));
    }
  }

  // --- Fluent mode conversion ---

  asOutput(initial?: DigitalValue): any {
    this._pinMode = PinMode.OUTPUT;
    if (initial !== undefined) {
      this._setBitValue(toBitValue(initial));
    }
    return this;
  }

  asInput(): any {
    this._pinMode = PinMode.INPUT;
    return this;
  }

  asInputPullUp(): any {
    this.inputPullUp();
    return this;
  }

  // --- IDigitalInput ---

  read(): DigitalValue {
    return this._value === 1;
  }

  isHigh(): boolean {
    return this._value === 1;
  }

  isLow(): boolean {
    return this._value === 0;
  }

  async waitForRising(_timeout?: number): Promise<void> {
    // In simulation, this resolves immediately.
    // Tests should use injectValue() + explicit assertions instead.
  }

  async waitForFalling(_timeout?: number): Promise<void> {
    // In simulation, this resolves immediately.
  }

  // --- IDigitalOutput ---

  write(value: DigitalValue): void {
    this._setBitValue(toBitValue(value));
  }

  high(): void {
    this._setBitValue(1);
  }

  low(): void {
    this._setBitValue(0);
  }

  toggle(): void {
    this._setBitValue(this._value === 1 ? 0 : 1);
  }

  pulse(_duration: number): void {
    // In simulation the pulse duration is not awaited, so a pulse produces no
    // observable transition — leave both pin state and history unchanged.
  }

  // --- Simulation helpers ---

  /**
   * Inject a value into this pin (simulates external signal).
   * Use this in tests to simulate button presses, sensor triggers, etc.
   */
  injectValue(value: number): void {
    this._setBitValue(value & 1);
  }

  /**
   * Get the history of all state changes on this pin.
   */
  getHistory(): readonly PinStateChange[] {
    return this._history;
  }

  /**
   * Clear the state change history.
   */
  clearHistory(): void {
    this._history = [];
  }

  /**
   * Get the current value as a plain number (0 or 1).
   */
  getBitValue(): number {
    return this._value;
  }

  /**
   * Reset the pin to its initial state.
   */
  reset(): void {
    this._value = 0;
    this._pinMode = PinMode.OUTPUT;
    this._history = [];
    this._startTime = Date.now();
  }

  // --- Internal ---

  private _setBitValue(newValue: number): void {
    const oldValue = this._value;
    this._value = newValue & 1;
    if (oldValue !== this._value) {
      this._history.push({
        timestamp: Date.now() - this._startTime,
        from: oldValue,
        to: this._value,
      });
    }
  }
}
