// ---------------------------------------------------------------------------
// Interrupt helpers
//
// Typed wrappers around Arduino interrupt functions.
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typecode/core';

/** Disable all interrupts. Maps to `noInterrupts()`. */
export declare function noInterrupts(): void;

/** Re-enable interrupts. Maps to `interrupts()`. */
export declare function interrupts(): void;

/** Attach an interrupt handler to a pin. Maps to `attachInterrupt()`. */
export declare function attachInterrupt(pin: number, handler: InterruptHandler, mode: InterruptMode): void;

/** Detach an interrupt handler from a pin. Maps to `detachInterrupt()`. */
export declare function detachInterrupt(pin: number): void;
