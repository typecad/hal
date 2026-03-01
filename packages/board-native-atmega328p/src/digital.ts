// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Digital I/O functions
//
// Native AVR implementations of digitalRead, digitalWrite, and pinMode.
// These functions use direct register access for maximum performance.
// ---------------------------------------------------------------------------

import type { PinNumber, DigitalValue } from '@typecode/core';

// ---------------------------------------------------------------------------
// Pin mode constants (match Arduino values for compatibility)
// ---------------------------------------------------------------------------

/** Pin mode constants for native AVR */
export const INPUT = 0x00;
export const OUTPUT = 0x01;
export const INPUT_PULLUP = 0x02;

// ---------------------------------------------------------------------------
// Digital value constants
// ---------------------------------------------------------------------------

/** Digital LOW (0) */
export const LOW = 0;
/** Digital HIGH (1) */
export const HIGH = 1;

// ---------------------------------------------------------------------------
// Digital I/O function declarations
// ---------------------------------------------------------------------------

/**
 * Configure the specified pin to behave either as an input or an output.
 * 
 * Uses direct DDR register manipulation for maximum performance.
 * 
 * @param pin - The pin number (0-19 for ATmega328P)
 * @param mode - INPUT, OUTPUT, or INPUT_PULLUP
 * 
 * @example
 * ```typescript
 * import { pinMode, OUTPUT } from '@typecode/board-native-atmega328p';
 * 
 * pinMode(13, OUTPUT);  // Set LED pin as output
 * ```
 * 
 * Generated C++ (pinMode(13, OUTPUT)):
 * ```cpp
 * DDRB |= (1 << PB5);  // Set bit 5 of DDRB
 * ```
 */
export declare function pinMode(pin: PinNumber, mode: number): void;

/**
 * Read the value from a specified digital pin.
 * 
 * Uses direct PIN register access for maximum performance.
 * 
 * @param pin - The pin number (0-19 for ATmega328P)
 * @returns HIGH or LOW (1 or 0)
 * 
 * @example
 * ```typescript
 * import { digitalRead, pinMode, INPUT } from '@typecode/board-native-atmega328p';
 * 
 * pinMode(2, INPUT);
 * const value = digitalRead(2);  // Returns HIGH or LOW
 * ```
 * 
 * Generated C++ (digitalRead(2)):
 * ```cpp
 * (PIND & (1 << PD2)) ? 1 : 0
 * ```
 */
export declare function digitalRead(pin: PinNumber): number;

/**
 * Write a HIGH or LOW value to a digital pin.
 * 
 * Uses direct PORT register manipulation for maximum performance.
 * 
 * @param pin - The pin number (0-19 for ATmega328P)
 * @param value - HIGH or LOW (or true/false)
 * 
 * @example
 * ```typescript
 * import { digitalWrite, pinMode, OUTPUT, HIGH, LOW } from '@typecode/board-native-atmega328p';
 * 
 * pinMode(13, OUTPUT);
 * digitalWrite(13, HIGH);  // Turn LED on
 * digitalWrite(13, LOW);   // Turn LED off
 * ```
 * 
 * Generated C++ (digitalWrite(13, HIGH)):
 * ```cpp
 * PORTB |= (1 << PB5);  // Set bit 5 of PORTB
 * ```
 * 
 * Generated C++ (digitalWrite(13, LOW)):
 * ```cpp
 * PORTB &= ~(1 << PB5);  // Clear bit 5 of PORTB
 * ```
 */
export declare function digitalWrite(pin: PinNumber, value: DigitalValue): void;

// ---------------------------------------------------------------------------
// Convenience functions for common patterns
// ---------------------------------------------------------------------------

/**
 * Set a pin HIGH.
 * Equivalent to digitalWrite(pin, HIGH) but slightly faster.
 */
export declare function setHigh(pin: PinNumber): void;

/**
 * Set a pin LOW.
 * Equivalent to digitalWrite(pin, LOW) but slightly faster.
 */
export declare function setLow(pin: PinNumber): void;

/**
 * Toggle a pin's output state.
 * Uses the PIN register toggle feature (PINx |= (1 << bit) toggles the output).
 */
export declare function togglePin(pin: PinNumber): void;
