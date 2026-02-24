// ---------------------------------------------------------------------------
// @typecode/core — Pin type hierarchy
// ---------------------------------------------------------------------------

import type { PinNumber, DigitalValue, AnalogValue } from './gpio';
import { PinMode, InterruptMode } from './gpio';

// ---------------------------------------------------------------------------
// Base pin
// ---------------------------------------------------------------------------

/** Minimal contract shared by every pin. */
export interface IPin {
  /** Physical pin number on the package. */
  readonly number: PinNumber;
  /** GPIO / logical pin number (may differ from physical). */
  readonly gpio: PinNumber;
  /** Current pin mode. */
  getMode(): PinMode;
  /** Change pin mode. */
  setMode(mode: PinMode): void;
}

// ---------------------------------------------------------------------------
// Digital
// ---------------------------------------------------------------------------

export interface IDigitalInput extends IPin {
  read(): DigitalValue;
  isHigh(): boolean;
  isLow(): boolean;
  waitForRising(timeout?: number): Promise<void>;
  waitForFalling(timeout?: number): Promise<void>;
}

export interface IDigitalOutput extends IPin {
  write(value: DigitalValue): void;
  high(): void;
  low(): void;
  toggle(): void;
  pulse(duration: number): void;
}

/**
 * A pin that can be switched between input and output at runtime.
 * Inherits both IDigitalInput and IDigitalOutput.
 */
export interface IDigitalPin extends IDigitalInput, IDigitalOutput {
  asInput(): void;
  asOutput(): void;
  asInputPullUp(): void;
  asInputPullDown(): void;
}

// ---------------------------------------------------------------------------
// Analog
// ---------------------------------------------------------------------------

export interface IAnalogInput extends IPin {
  read(): AnalogValue;
  readVoltage(): number;
  setReference(voltage: number): void;
  getResolution(): number;
}

export interface IAnalogOutput extends IPin {
  write(value: AnalogValue): void;
  writeVoltage(voltage: number): void;
  getResolution(): number;
}

// ---------------------------------------------------------------------------
// PWM
// ---------------------------------------------------------------------------

export interface IPWMPin extends IDigitalPin {
  /** Write a digital value **or** an analog duty-cycle value. */
  write(value: DigitalValue | AnalogValue): void;
  setFrequency(hz: number): void;
  setDutyCycle(duty: number): void;
  getFrequency(): number;
  getResolution(): number;
  attach(): void;
  detach(): void;
}

// ---------------------------------------------------------------------------
// Interrupt
// ---------------------------------------------------------------------------

export type InterruptHandler = () => void;

export interface IInterruptPin extends IPin {
  attachInterrupt(handler: InterruptHandler, mode: InterruptMode): void;
  detachInterrupt(): void;
  hasInterrupt(): boolean;
}

// ---------------------------------------------------------------------------
// Touch (ESP32)
// ---------------------------------------------------------------------------

export interface ITouchPin extends IPin {
  read(): number;
  setThreshold(threshold: number): void;
  attachTouchInterrupt(handler: () => void): void;
}

// ---------------------------------------------------------------------------
// Extended ADC / DAC
// ---------------------------------------------------------------------------

export interface IADCPin extends IAnalogInput {
  setAttenuation(db: number): void;
  startContinuousSampling(): void;
  stopContinuousSampling(): void;
  readAveraged(samples: number): AnalogValue;
}

export interface IDACPin extends IAnalogOutput {
  outputSine(frequency: number): void;
  stopOutput(): void;
  setChannel(channel: number): void;
}
