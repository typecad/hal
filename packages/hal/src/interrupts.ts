// ---------------------------------------------------------------------------
// @typecad/hal — Interrupt helpers
// ---------------------------------------------------------------------------

import type { InterruptHandler } from './core/pin';
import type { InterruptMode } from './core/gpio';

/**
 * Globally disable interrupts.
 */
export declare function noInterrupts(): void;

/**
 * Re-enable interrupts after `noInterrupts()`.
 */
export declare function interrupts(): void;

/**
 * Attach an interrupt handler to a pin.
 */
export declare function attachInterrupt(
  pin: number,
  handler: InterruptHandler,
  mode: InterruptMode,
): void;

/**
 * Detach a previously attached interrupt.
 */
export declare function detachInterrupt(pin: number): void;
