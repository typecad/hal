// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Interrupt helpers
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typecode/core';

/**
 * Globally disable interrupts. Maps to Arduino `noInterrupts()`.
 */
export declare function noInterrupts(): void;

/**
 * Re-enable interrupts after `noInterrupts()`. Maps to `interrupts()`.
 */
export declare function interrupts(): void;

/**
 * Attach an interrupt handler to the given GPIO pin number.
 * On the ESP32, ALL GPIO pins support interrupts (unlike AVR which
 * is limited to specific pins).
 *
 * @param pin      GPIO pin number
 * @param handler  Callback to run on interrupt
 * @param mode     Trigger mode (RISING, FALLING, CHANGE, LOW, HIGH)
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
