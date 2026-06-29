// ---------------------------------------------------------------------------
// @typecad/cuttlefish — Unified Pin Interface
//
// Single flattened interface with compile-time mode safety and capability
// checking. All methods are visible in autocomplete, and invalid operations
// are prevented at compile time.
//
// DESIGN PRINCIPLE: One obvious way to do each thing.
//   - Configure: asInput(), asInputPullUp(), asOutput(initial?)
//   - Act: set(value), setHigh(), setLow(), toggle(), pwm(duty)
//   - Sense: read(), readAnalog(), readVoltage()
//   - Events: onRising(), onFalling(), onChange(), offInterrupts()
// ---------------------------------------------------------------------------

import type { DigitalValue, AnalogValue } from './gpio.js';
import { PinMode } from './gpio.js';
import type { PinCapabilityFlags } from './capabilities.js';

// ---------------------------------------------------------------------------
// Branded types for mode safety
// ---------------------------------------------------------------------------

declare const PinModeBrand: unique symbol;

/** Pin branded with current mode for compile-time safety. */
export type Pin<Mode extends PinMode = PinMode> = BasePin & {
  readonly [PinModeBrand]: Mode;
};

// ---------------------------------------------------------------------------
// Tone Attachment
// ---------------------------------------------------------------------------

/** Returned by tone() to allow chaining .for() duration. */
export interface IToneAttachment {
  for(duration: number): void;
}

// ---------------------------------------------------------------------------
// Interrupt Types
// ---------------------------------------------------------------------------

export type InterruptHandler = () => void;

export interface InterruptOptions {
  debounce?: number;
}

// ---------------------------------------------------------------------------
// Base Unified Pin Interface
// ---------------------------------------------------------------------------

/**
 * Unified pin interface with all possible operations.
 * Capability-specific methods are optional and type guarded.
 *
 * INTENT-BASED DESIGN:
 *   Configure — one way to set mode:
 *     pin.asInput() / pin.asInputPullUp() / pin.asOutput() / pin.asOutput(initial)
 *
 *   Act — one way to change state:
 *     pin.set(HIGH) / pin.set(LOW) / pin.toggle() / pin.pwm(duty)
 *
 *   Sense — one way to read:
 *     pin.read() / pin.readAnalog() / pin.readVoltage()
 *
 *   Events — one way to handle interrupts:
 *     pin.onRising(fn) / pin.onFalling(fn) / pin.offInterrupts()
 */
export interface BasePin {
  /** Physical pin number on the MCU package. */
  readonly number: number;
  /** GPIO / logical pin number. */
  readonly gpio: number;
  /** Capabilities supported by this pin. */
  readonly capabilities: PinCapabilityFlags;

  // -------------------------------------------------------------------------
  // Digital I/O (all digital pins)
  // -------------------------------------------------------------------------

  /** Read current digital value. */
  read(): DigitalValue;
  /** Check if pin is HIGH. */
  isHigh(): boolean;
  /** Check if pin is LOW. */
  isLow(): boolean;

  /** Write digital value. Implicitly sets OUTPUT mode. */
  write(value: DigitalValue): void;
  /** Set pin HIGH. Implicitly sets OUTPUT mode. */
  high(): void;
  /** Set pin LOW. Implicitly sets OUTPUT mode. */
  low(): void;
  /** Toggle pin state. Implicitly sets OUTPUT mode. */
  toggle(): void;
  /** Pulse pin HIGH for duration ms. Implicitly sets OUTPUT mode. */
  pulse(duration: number): void;

  /** Play tone at specified frequency. */
  tone(frequency: number): IToneAttachment;
  /** Stop playing tone. */
  noTone(): void;

  // -------------------------------------------------------------------------
  // Mode configuration
  // -------------------------------------------------------------------------

  /** Set as INPUT with internal pull-up. */
  inputPullUp(): void;
  /** Set as INPUT with internal pull-down (if supported). */
  inputPullDown?(): void;
  /** Set as OUTPUT in open drain mode. */
  outputOpenDrain(initial?: DigitalValue): void;

  // -------------------------------------------------------------------------
  // Fluent mode conversion (mode-specific type safety)
  // -------------------------------------------------------------------------

  /** Return pin typed as OUTPUT mode — only write operations available. */
  asOutput(initial?: DigitalValue): IOutputModePin;
  /** Return pin typed as INPUT mode — only read operations available. */
  asInput(): IInputModePin;
  /** Return pin typed as INPUT_PULLUP mode — only read operations available. */
  asInputPullUp(): IInputModePin;

  // -------------------------------------------------------------------------
  // Capability-based optional methods
  // -------------------------------------------------------------------------

  /** PWM output (only if pin has 'pwm' capability). */
  pwm?(percent: number): void;
  /** Get PWM frequency. */
  getPwmFrequency?(): number;
  /** Get PWM resolution in bits. */
  getPwmResolution?(): number;

  /** Analog input read (only if pin has 'analog' capability). */
  readAnalog?(): AnalogValue;
  /** Read analog voltage in volts. */
  readVoltage?(): number;
  /** Set ADC reference voltage. */
  setAnalogReference?(voltage: number): void;
  /** Get ADC resolution in bits. */
  getAnalogResolution?(): number;

  /** Attach interrupt on rising edge (only if pin has 'interrupt' capability). */
  onRising?(handler: InterruptHandler, options?: InterruptOptions): void;
  /** Attach interrupt on falling edge. */
  onFalling?(handler: InterruptHandler, options?: InterruptOptions): void;
  /** Attach interrupt on any state change. */
  onChange?(handler: InterruptHandler, options?: InterruptOptions): void;
  /** Remove all interrupt handlers. */
  offInterrupts?(): void;

  // -------------------------------------------------------------------------
  // Wait operations
  // -------------------------------------------------------------------------

  /** Wait for rising edge with optional timeout. */
  waitForRising(timeout?: number): Promise<void>;
  /** Wait for falling edge with optional timeout. */
  waitForFalling(timeout?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mode-Restricted Pin Interfaces
//
// After calling asOutput() or asInput(), only the appropriate I/O methods
// are available on the returned type. Mode-switching methods remain available
// on all mode types so transitions are always possible.
// ---------------------------------------------------------------------------

/** Pin in OUTPUT mode — only write operations available. */
export interface IOutputModePin {
  /** Physical pin number on the MCU package. */
  readonly number: number;
  /** GPIO / logical pin number. */
  readonly gpio: number;
  /** Capabilities supported by this pin. */
  readonly capabilities: PinCapabilityFlags;

  // --- Write operations (output mode) --------------------------------------

  /** Write digital value. */
  write(value: DigitalValue): void;
  /** Set pin HIGH. */
  high(): void;
  /** Set pin LOW. */
  low(): void;
  /** Toggle pin state. */
  toggle(): void;
  /** Pulse pin HIGH for duration ms. */
  pulse(duration: number): void;
  /** Play tone at specified frequency. */
  tone(frequency: number): IToneAttachment;
  /** Stop playing tone. */
  noTone(): void;

  // --- Capability-dependent output methods ---------------------------------

  /** PWM output (only if pin has 'pwm' capability). */
  pwm?(percent: number): void;
  /** Get PWM frequency. */
  getPwmFrequency?(): number;
  /** Get PWM resolution in bits. */
  getPwmResolution?(): number;

  // --- Mode switching (always available) -----------------------------------

  /** Switch to OUTPUT mode. Returns output-typed pin. */
  asOutput(initial?: DigitalValue): IOutputModePin;
  /** Switch to INPUT mode. Returns input-typed pin. */
  asInput(): IInputModePin;
  /** Switch to INPUT_PULLUP mode. Returns input-typed pin. */
  asInputPullUp(): IInputModePin;

  // --- Non-fluent mode setters ---------------------------------------------

  /** Set as INPUT with internal pull-up. */
  inputPullUp(): void;
  /** Set as INPUT with internal pull-down (if supported). */
  inputPullDown?(): void;
  /** Set as OUTPUT in open drain mode. */
  outputOpenDrain(initial?: DigitalValue): void;
}

/** Pin in INPUT mode — only read operations available. */
export interface IInputModePin {
  /** Physical pin number on the MCU package. */
  readonly number: number;
  /** GPIO / logical pin number. */
  readonly gpio: number;
  /** Capabilities supported by this pin. */
  readonly capabilities: PinCapabilityFlags;

  // --- Read operations (input mode) ----------------------------------------

  /** Read current digital value. */
  read(): DigitalValue;
  /** Check if pin is HIGH. */
  isHigh(): boolean;
  /** Check if pin is LOW. */
  isLow(): boolean;

  // --- Capability-dependent input methods ----------------------------------

  /** Analog input read (only if pin has 'analog' capability). */
  readAnalog?(): AnalogValue;
  /** Read analog voltage in volts. */
  readVoltage?(): number;
  /** Set ADC reference voltage. */
  setAnalogReference?(voltage: number): void;
  /** Get ADC resolution in bits. */
  getAnalogResolution?(): number;

  // --- Interrupts (input-mode only) ----------------------------------------

  /** Attach interrupt on rising edge (only if pin has 'interrupt' capability). */
  onRising?(handler: InterruptHandler, options?: InterruptOptions): void;
  /** Attach interrupt on falling edge. */
  onFalling?(handler: InterruptHandler, options?: InterruptOptions): void;
  /** Attach interrupt on any state change. */
  onChange?(handler: InterruptHandler, options?: InterruptOptions): void;
  /** Remove all interrupt handlers. */
  offInterrupts?(): void;

  // --- Wait operations (input-mode only) -----------------------------------

  /** Wait for rising edge with optional timeout. */
  waitForRising(timeout?: number): Promise<void>;
  /** Wait for falling edge with optional timeout. */
  waitForFalling(timeout?: number): Promise<void>;

  // --- Mode switching (always available) -----------------------------------

  /** Switch to OUTPUT mode. Returns output-typed pin. */
  asOutput(initial?: DigitalValue): IOutputModePin;
  /** Switch to INPUT mode. Returns input-typed pin. */
  asInput(): IInputModePin;
  /** Switch to INPUT_PULLUP mode. Returns input-typed pin. */
  asInputPullUp(): IInputModePin;

  // --- Non-fluent mode setters ---------------------------------------------

  /** Set as INPUT with internal pull-up. */
  inputPullUp(): void;
  /** Set as INPUT with internal pull-down (if supported). */
  inputPullDown?(): void;
  /** Set as OUTPUT in open drain mode. */
  outputOpenDrain(initial?: DigitalValue): void;
}

// ---------------------------------------------------------------------------
// Pin Groups
// ---------------------------------------------------------------------------

export type { IPinGroup } from './gpio.js';

// ---------------------------------------------------------------------------
// Capability-narrowed pin types
// ---------------------------------------------------------------------------

/** Pin with PWM output capability. */
export type PWMPin = BasePin & { pwm: NonNullable<BasePin['pwm']> };

/** Pin with analog input capability. */
export type AnalogPin = BasePin & { readAnalog: NonNullable<BasePin['readAnalog']> };

/** Pin with interrupt capability. */
export type InterruptPin = BasePin & { onRising: NonNullable<BasePin['onRising']> };
