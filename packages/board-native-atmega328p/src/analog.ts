// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Analog I/O functions
//
// Native AVR implementations of analogRead and analogWrite.
// Uses direct ADC and timer register access for maximum performance.
// ---------------------------------------------------------------------------

import type { PinNumber, AnalogValue } from '@typecode/core';

// ---------------------------------------------------------------------------
// ADC reference voltage constants
// ---------------------------------------------------------------------------

/**
 * ADC reference voltage source selection.
 * These values correspond to the REFS1:0 bits in the ADMUX register.
 */
export enum AnalogReference {
  /** Default: AVcc (5V on Arduino) as reference voltage */
  DEFAULT = 0,    // REFS1:0 = 00 (actually 01 for AVcc, but Arduino uses this naming)
  
  /** Internal 1.1V reference voltage */
  INTERNAL = 3,   // REFS1:0 = 11 (internal 1.1V)
  
  /** External reference voltage on AREF pin */
  EXTERNAL = 0,   // REFS1:0 = 00 (AREF pin, internal reference disabled)
}

// ---------------------------------------------------------------------------
// ADC prescaler constants
// ---------------------------------------------------------------------------

/**
 * ADC prescaler values for controlling the ADC clock.
 * The ADC requires a clock between 50kHz and 200kHz for maximum resolution.
 * With a 16MHz system clock:
 * - Prescaler 128 → 125kHz ADC clock (default Arduino setting)
 * - Prescaler 64  → 250kHz ADC clock (faster but slightly lower resolution)
 */
export enum ADCPrescaler {
  /** ADC clock = system clock / 2 */
  DIV2 = 1,
  /** ADC clock = system clock / 4 */
  DIV4 = 2,
  /** ADC clock = system clock / 8 */
  DIV8 = 3,
  /** ADC clock = system clock / 16 */
  DIV16 = 4,
  /** ADC clock = system clock / 32 */
  DIV32 = 5,
  /** ADC clock = system clock / 64 */
  DIV64 = 6,
  /** ADC clock = system clock / 128 (default for 16MHz) */
  DIV128 = 7,
}

// ---------------------------------------------------------------------------
// Analog I/O function declarations
// ---------------------------------------------------------------------------

/**
 * Set the ADC reference voltage source.
 * 
 * This affects all subsequent analogRead() calls.
 * 
 * @param ref - The reference voltage source (DEFAULT, INTERNAL, or EXTERNAL)
 * 
 * @example
 * ```typescript
 * import { analogReference, AnalogReference } from '@typecode/board-native-atmega328p';
 * 
 * analogReference(AnalogReference.INTERNAL);  // Use 1.1V internal reference
 * ```
 * 
 * Generated C++ (analogReference(INTERNAL)):
 * ```cpp
 * ADMUX = (ADMUX & 0x3F) | (3 << REFS0);
 * ```
 */
export declare function analogReference(ref: AnalogReference): void;

/**
 * Read the analog value from the specified pin.
 * 
 * Uses the ATmega328P's 10-bit ADC (0-1023) with direct register access.
 * The conversion takes approximately 13 ADC clock cycles (104µs at 125kHz).
 * 
 * @param pin - The analog pin number (14-19 for A0-A5, or 0-5 for channel numbers)
 * @returns A 10-bit value (0-1023) representing the voltage
 * 
 * @example
 * ```typescript
 * import { analogRead } from '@typecode/board-native-atmega328p';
 * 
 * const value = analogRead(14);  // Read from A0
 * const voltage = (value / 1023.0) * 5.0;  // Convert to voltage
 * ```
 * 
 * Generated C++ (analogRead(14)):
 * ```cpp
 * ADMUX = (1 << REFS0) | 0;       // AVcc reference, channel 0
 * ADCSRA |= (1 << ADSC);          // Start conversion
 * while (ADCSRA & (1 << ADSC));   // Wait for completion
 * ADC                              // Return result
 * ```
 */
export declare function analogRead(pin: PinNumber): number;

/**
 * Write an analog value (PWM) to the specified pin.
 * 
 * Uses the ATmega328P's timer/counter modules to generate PWM output.
 * Only pins 3, 5, 6, 9, 10, and 11 support PWM output.
 * 
 * The PWM frequency is approximately:
 * - Pins 5, 6:   ~976Hz (Timer0, phase correct PWM)
 * - Pins 9, 10:  ~490Hz (Timer1, 8-bit phase correct PWM)
 * - Pins 3, 11:  ~490Hz (Timer2, phase correct PWM)
 * 
 * @param pin - The PWM-capable pin number (3, 5, 6, 9, 10, or 11)
 * @param value - The duty cycle value (0-255 for 8-bit PWM)
 * 
 * @example
 * ```typescript
 * import { analogWrite } from '@typecode/board-native-atmega328p';
 * 
 * analogWrite(9, 128);   // 50% duty cycle on pin 9
 * analogWrite(9, 255);   // 100% duty cycle (always HIGH)
 * analogWrite(9, 0);     // 0% duty cycle (always LOW)
 * ```
 * 
 * Generated C++ (analogWrite(9, 128)):
 * ```cpp
 * // Configure Timer1 for 8-bit phase correct PWM on OC1A (pin 9)
 * TCCR1A |= (1 << COM1A1) | (1 << WGM10);
 * TCCR1B |= (1 << CS10);   // No prescaler, start timer
 * OCR1A = 128;             // Set duty cycle
 * ```
 */
export declare function analogWrite(pin: PinNumber, value: AnalogValue): void;

// ---------------------------------------------------------------------------
// Advanced ADC functions
// ---------------------------------------------------------------------------

/**
 * Configure the ADC prescaler for faster or slower conversions.
 * 
 * Lower prescaler values give faster conversions but may reduce accuracy.
 * The ADC clock should be between 50kHz and 200kHz for full 10-bit resolution.
 * 
 * @param prescaler - The prescaler division factor
 * 
 * @example
 * ```typescript
 * import { setADCPrescaler, ADCPrescaler } from '@typecode/board-native-atmega328p';
 * 
 * setADCPrescaler(ADCPrescaler.DIV64);  // Faster ADC at slight accuracy cost
 * ```
 */
export declare function setADCPrescaler(prescaler: ADCPrescaler): void;

/**
 * Check if a pin supports PWM output via analogWrite().
 * 
 * @param pin - The pin number to check
 * @returns true if the pin supports PWM output
 */
export declare function isPWMCapable(pin: PinNumber): boolean;

/**
 * Disable PWM output on a pin and set it to a digital state.
 * 
 * @param pin - The pin number to disable PWM on
 * @param value - The digital value to set (HIGH or LOW)
 */
export declare function disablePWM(pin: PinNumber, value: number): void;
