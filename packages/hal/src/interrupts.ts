// ---------------------------------------------------------------------------
// @typecad/hal — Interrupt helpers
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from './types.js';

/**
 * Globally disable interrupts.
 */
export function noInterrupts(): void {}

/**
 * Re-enable interrupts after `noInterrupts()`.
 */
export function interrupts(): void {}

/**
 * Attach an interrupt handler to a pin.
 */
export function attachInterrupt(
  pin: number,
  handler: InterruptHandler,
  mode: InterruptMode,
): void {}

/**
 * Detach a previously attached interrupt.
 */
export function detachInterrupt(pin: number): void {}
