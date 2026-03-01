// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Interrupt helpers
//
// Native AVR interrupt functions using direct register access.
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typecode/core';

/**
 * Globally disable interrupts.
 * Uses AVR `cli()` instruction (clear global interrupt flag).
 */
export declare function noInterrupts(): void;

/**
 * Re-enable interrupts after `noInterrupts()`.
 * Uses AVR `sei()` instruction (set global interrupt flag).
 */
export declare function interrupts(): void;

/**
 * Attach an interrupt handler to the given digital pin number.
 * On ATmega328P only pins 2 (INT0) and 3 (INT1) support external interrupts.
 *
 * @param pin      Digital pin number (2 or 3)
 * @param handler  Callback to run on interrupt
 * @param mode     Trigger mode (RISING, FALLING, CHANGE, LOW)
 *
 * Native implementation configures EICRA and EIMSK registers.
 */
export declare function attachInterrupt(
  pin: number,
  handler: InterruptHandler,
  mode: InterruptMode,
): void;

/**
 * Detach a previously attached interrupt.
 *
 * Native implementation clears the appropriate bit in EIMSK.
 */
export declare function detachInterrupt(pin: number): void;
