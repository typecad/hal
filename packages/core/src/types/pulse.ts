// ---------------------------------------------------------------------------
// @typehal/core — Pulse measurement utilities (pulseIn, pulseInLong)
// ---------------------------------------------------------------------------

import type { BasePin } from './pin';

/**
 * Chainable pulse measurement builder.
 */
interface IPulseChain {
  /** Measure HIGH pulse with default timeout */
  high(): number;
  /** Measure LOW pulse with default timeout */
  low(): number;
  /** Set timeout in microseconds */
  timeout(us: number): this;
  /** Use pulseInLong for longer pulses */
  long(): number;
}

/**
 * Pulse measurement namespace with both direct and fluent APIs.
 */
export interface IPulseNamespace {
  // --- Direct functions (platform-compatible) ---

  /**
   * Measure the length of a pulse in microseconds.
   * Maps to platform-specific `pulseIn` equivalent.
   */
  in(pin: BasePin, value: boolean, timeout?: number): number;

  /**
   * Measure the length of a pulse (for longer pulses).
   * Maps to platform-specific `pulseInLong` equivalent.
   */
  long(pin: BasePin, value: boolean, timeout?: number): number;

  // --- Fluent builders ---

  /** Start a fluent pulse measurement chain */
  on(pin: BasePin): IPulseChain;
}

/** Stub for type checking. The transpiler replaces these with platform-specific built-ins. */
declare const Pulse: IPulseNamespace;

export { Pulse };
