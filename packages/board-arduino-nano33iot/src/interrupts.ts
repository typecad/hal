// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Interrupt helpers
//
// The SAMD21 routes all external interrupts through the External Interrupt
// Controller (EIC), giving most I/O pins full interrupt capability.
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typecode/core';

/**
 * Globally disable interrupts.  Maps to Arduino `noInterrupts()` / `__disable_irq()`.
 */
export declare function noInterrupts(): void;

/**
 * Re-enable interrupts after `noInterrupts()`.  Maps to `interrupts()` / `__enable_irq()`.
 */
export declare function interrupts(): void;

/**
 * Attach an interrupt handler to the given digital pin number.
 * On the NANO 33 IoT (SAMD21) virtually all digital pins support external
 * interrupts via the EIC — pass the Arduino pin number directly.
 *
 * @param pin      Arduino pin number
 * @param handler  Callback to run on interrupt (must be a zero-argument void function)
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
 * Remove the interrupt handler attached to `pin`.
 * Maps to Arduino `detachInterrupt(digitalPinToInterrupt(pin))`.
 */
export declare function detachInterrupt(pin: number): void;
