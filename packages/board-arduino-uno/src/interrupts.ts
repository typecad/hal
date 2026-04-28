// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Interrupt helpers
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typehal/core';

/**
 * Globally disable interrupts.  Maps to Arduino `noInterrupts()` / `cli()`.
 */
export declare function noInterrupts(): void;

/**
 * Re-enable interrupts after `noInterrupts()`.  Maps to `interrupts()` / `sei()`.
 */
export declare function interrupts(): void;

/**
 * Attach an interrupt handler to the given digital pin number.
 * On the Uno only pins 2 (INT0) and 3 (INT1) support external interrupts.
 *
 * @param pin      Digital pin number (2 or 3 on Uno)
 * @param handler  Callback to run on interrupt
 * @param mode     Trigger mode (RISING, FALLING, CHANGE, LOW)
 *
 * Maps to Arduino `attachInterrupt(digitalPinToInterrupt(pin), handler, mode)`.
 */
export declare function attachInterrupt(
  pin: number,
  handler: InterruptHandler,
  mode: InterruptMode,
): void;

/**
 * Detach a previously attached interrupt.
 *
 * Maps to Arduino `detachInterrupt(digitalPinToInterrupt(pin))`.
 */
export declare function detachInterrupt(pin: number): void;
