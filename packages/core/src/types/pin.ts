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
// Pin Configuration (fluent API)
// ---------------------------------------------------------------------------

/** Output pin configuration builder. */
export interface IOutputConfig {
  /** Set pin as OUTPUT with initial value. */
  initial(value: DigitalValue): void;
}

/** Input pin configuration builder. */
export interface IInputConfig {
  /** Set pin as INPUT (floating). */
  float(): void;
  /** Set pin as INPUT_PULLUP. */
  pullup(): void;
  /** Set pin as INPUT_PULLDOWN (if supported). */
  pulldown(): void;
}

/** Pin configuration namespace. */
export interface IPinConfig {
  /** Configure as output. */
  readonly output: IOutputConfig;
  /** Configure as input. */
  readonly input: IInputConfig;
}

/** PWM output configuration builder. */
export interface IPWMOutputConfig {
  /** Set pin as PWM output with initial duty cycle (0-100 percent). */
  initial(percent: number): void;
}

/** PWM pin configuration namespace. */
export interface IPWMConfig extends IPinConfig {
  /** Configure as PWM output. */
  readonly pwm: IPWMOutputConfig;
}

/** Analog input configuration builder. */
export interface IAnalogInputConfig {
  /** Set pin as analog input. */
  analog(): void;
}

/** Analog pin configuration namespace. */
export interface IAnalogConfig {
  /** Configure as analog input. */
  readonly config: IAnalogInputConfig;
}

// ---------------------------------------------------------------------------
// Tone API (available on all digital output pins)
// ---------------------------------------------------------------------------

/** Returned by tone() to allow chaining .for() duration. */
export interface IToneAttachment {
  /** Set duration for the tone in milliseconds. */
  for(duration: number): void;
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
  /** Play a tone at the specified frequency in Hz. */
  tone(frequency: number): IToneAttachment;
  /** Stop any playing tone. */
  noTone(): void;
}

/**
 * A pin that can be switched between input and output at runtime.
 * Inherits both IDigitalInput and IDigitalOutput.
 */
export interface IDigitalPin extends IDigitalInput, IDigitalOutput {
  /** Pin configuration namespace. */
  readonly config: IPinConfig;
}

// ---------------------------------------------------------------------------
// Analog
// ---------------------------------------------------------------------------

export interface IAnalogInput extends IPin {
  /** Pin configuration namespace. */
  readonly config: IAnalogInputConfig;
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
  /** Pin configuration namespace (extends base with pwm). */
  readonly config: IPWMConfig;
  /** Write a digital value **or** an analog duty-cycle value. */
  write(value: DigitalValue | AnalogValue): void;
  /** Set PWM duty cycle as percentage (0-100). Converts to resolution-specific value. */
  pwm(percent: number): void;
  /** Stop any playing tone (alias for noTone). */
  stop(): void;
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

/**
 * Returned by interrupt attachment methods to allow chaining debounce().
 * Ensures debounce can only be called after setting an interrupt handler.
 */
export interface IInterruptAttachment {
  /** Apply debounce delay (in milliseconds) to this interrupt. */
  debounce(ms: number): void;
}

/**
 * Fluent interrupt attachment API.
 * Usage: D2.on.falling(() => LED.toggle()).debounce(50)
 */
export interface IInterruptOn {
  /** Trigger interrupt when pin goes from LOW to HIGH. */
  rising(handler: InterruptHandler): IInterruptAttachment;
  /** Trigger interrupt when pin goes from HIGH to LOW. */
  falling(handler: InterruptHandler): IInterruptAttachment;
  /** Trigger interrupt on any change. */
  change(handler: InterruptHandler): IInterruptAttachment;
  /** Trigger interrupt while pin is LOW (platform-specific). */
  low?(handler: InterruptHandler): IInterruptAttachment;
  /** Trigger interrupt while pin is HIGH (platform-specific). */
  high?(handler: InterruptHandler): IInterruptAttachment;
}

/**
 * Fluent interrupt removal API.
 * Usage: D2.off.falling() or D2.off.all()
 */
export interface IInterruptOff {
  /** Remove rising-edge interrupt. */
  rising(): void;
  /** Remove falling-edge interrupt. */
  falling(): void;
  /** Remove change interrupt. */
  change(): void;
  /** Remove all interrupts on this pin. */
  all(): void;
}

export interface IInterruptPin extends IPin {
  /** Check if this pin has an interrupt attached. */
  hasInterrupt(): boolean;
  /** Fluent interrupt attachment: D2.on.falling(() => ...) */
  readonly on: IInterruptOn;
  /** Fluent interrupt removal: D2.off.all() */
  readonly off: IInterruptOff;
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
