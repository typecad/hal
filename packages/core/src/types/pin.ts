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

/** Output pin configuration - callable, with optional initial value. */
export interface IOutputConfig {
  /** Set pin as OUTPUT (no initial value). */
  (): void;
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

/** PWM output configuration - callable, with optional initial duty cycle. */
export interface IPWMOutputConfig {
  /** Set pin as PWM output (no initial value). */
  (): void;
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

// ---------------------------------------------------------------------------
// Pin Groups (for parallel operations)
// ---------------------------------------------------------------------------

/**
 * A group of digital output pins that can be controlled together.
 * Useful for LED arrays, segment displays, or parallel data buses.
 */
export interface IPinGroup<T extends IDigitalPin = IDigitalPin> {
  /** Name identifier for this group. */
  readonly name: string;
  /** Number of pins in the group. */
  readonly count: number;
  /** Individual pins in the group. */
  readonly pins: readonly T[];
  
  // --- Bulk operations ---
  /** Write the same value to all pins in the group. */
  writeAll(value: DigitalValue): void;
  /** Set all pins HIGH. */
  allHigh(): void;
  /** Set all pins LOW. */
  allLow(): void;
  /** Toggle all pins. */
  allToggle(): void;
  
  // --- Pattern operations ---
  /** Write a bit pattern to the group (LSB = first pin). */
  writePattern(pattern: number): void;
  /** Read current state as a bit pattern (LSB = first pin). */
  readPattern(): number;
  
  // --- Iteration ---
  /** Iterate over pins with index. */
  forEach(callback: (pin: T, index: number) => void): void;
}

/**
 * A parallel port for reading/writing byte values across 8 pins.
 * Commonly used for LCD data buses, shift register interfaces, etc.
 */
export interface IParallelPort {
  /** Name identifier for this port. */
  readonly name: string;
  /** Data pins (typically 8 for a full byte). */
  readonly pins: readonly IDigitalPin[];
  /** Number of data pins. */
  readonly width: number;
  
  // --- Byte operations ---
  /** Write a byte value to the parallel port. */
  writeByte(value: number): void;
  /** Read a byte value from the parallel port. */
  readByte(): number;
  
  // --- Nibble operations (4-bit) ---
  /** Write low nibble (bits 0-3). */
  writeLowNibble(value: number): void;
  /** Write high nibble (bits 4-7). */
  writeHighNibble(value: number): void;
  /** Read low nibble. */
  readLowNibble(): number;
  /** Read high nibble. */
  readHighNibble(): number;
}

/**
 * Factory options for creating a pin group.
 */
export interface IPinGroupOptions {
  /** Optional name for the group. */
  name?: string;
}

/**
 * Create a pin group for bulk operations.
 * @param pins Array of digital pins to group together.
 * @param options Optional configuration.
 */
export declare function createPinGroup<T extends IDigitalPin>(
  pins: T[],
  options?: IPinGroupOptions
): IPinGroup<T>;

/**
 * Create a parallel port from an array of pins.
 * @param pins Array of pins (typically 8 for full byte, or 4 for nibble).
 * @param name Optional name for the port.
 */
export declare function createParallelPort(
  pins: IDigitalPin[],
  name?: string
): IParallelPort;

// ---------------------------------------------------------------------------
// Pin Capability Validation (Compile-time utilities)
// ---------------------------------------------------------------------------

/**
 * Type guard to check if a pin supports PWM output.
 * Accepts unknown for flexibility with runtime validation.
 * Usage: if (isPWMPin(pin)) { pin.pwm(50); }
 */
export declare function isPWMPin(pin: unknown): pin is IPWMPin;

/**
 * Type guard to check if a pin supports analog input.
 * Accepts unknown for flexibility with runtime validation.
 * Usage: if (isAnalogPin(pin)) { const val = pin.read(); }
 */
export declare function isAnalogPin(pin: unknown): pin is IAnalogInput;

/**
 * Type guard to check if a pin supports hardware interrupts.
 * Accepts unknown for flexibility with runtime validation.
 * Usage: if (isInterruptPin(pin)) { pin.on.falling(handler); }
 */
export declare function isInterruptPin(pin: unknown): pin is IInterruptPin;

/**
 * Type guard to check if a pin is a digital I/O pin.
 * Accepts unknown for flexibility with runtime validation.
 * Usage: if (isDigitalPin(pin)) { pin.high(); }
 */
export declare function isDigitalPin(pin: unknown): pin is IDigitalPin;

/**
 * Utility type to extract only PWM-capable pins from a union.
 * Usage: type PWMPins = FilterPWM<typeof D9 | typeof D10>;
 */
export type FilterPWM<T> = T extends IPWMPin ? T : never;

/**
 * Utility type to extract only analog-capable pins from a union.
 * Usage: type AnalogPins = FilterAnalog<typeof A0 | typeof A1>;
 */
export type FilterAnalog<T> = T extends IAnalogInput ? T : never;

/**
 * Utility type to extract only interrupt-capable pins from a union.
 * Usage: type InterruptPins = FilterInterrupt<typeof D2 | typeof D3>;
 */
export type FilterInterrupt<T> = T extends IInterruptPin ? T : never;

/**
 * Assert that a pin supports PWM. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 * Usage: assertPWM(D9); D9.pwm(50);
 */
export declare function assertPWM(pin: IPin, message?: string): asserts pin is IPWMPin;

/**
 * Assert that a pin supports analog input. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 * Usage: assertAnalog(A0); const val = A0.read();
 */
export declare function assertAnalog(pin: IPin, message?: string): asserts pin is IAnalogInput;

/**
 * Assert that a pin supports interrupts. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 * Usage: assertInterrupt(D2); D2.on.falling(handler);
 */
export declare function assertInterrupt(pin: IPin, message?: string): asserts pin is IInterruptPin;

/**
 * Require a pin to have specific capabilities at compile time.
 * Usage: function fadeLed(pin: RequirePWM<IDigitalPin>) { pin.pwm(50); }
 */
export type RequirePWM<T extends IPin> = T & IPWMPin;

/**
 * Require a pin to support analog input at compile time.
 * Usage: function readSensor(pin: RequireAnalog<IPin>) { return pin.read(); }
 */
export type RequireAnalog<T extends IPin> = T & IAnalogInput;

/**
 * Require a pin to support interrupts at compile time.
 * Usage: function attachHandler(pin: RequireInterrupt<IPin>) { pin.on.falling(fn); }
 */
export type RequireInterrupt<T extends IPin> = T & IInterruptPin;
