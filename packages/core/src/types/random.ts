// ---------------------------------------------------------------------------
// @typecode/core — Random number utilities
// ---------------------------------------------------------------------------

/**
 * Random number namespace with both direct and fluent APIs.
 */
export interface IRandomNamespace {
  // --- Direct functions ---

  /** Initialize the pseudo-random number generator. */
  seed(seed: number): void;

  /** Generate a random number in range [0, max). */
  next(max: number): number;

  /** Generate a random number in range [min, max). */
  next(min: number, max: number): number;

  // --- Fluent builders ---

  /** Generate a random number from 0 to max-1. */
  upTo(max: number): number;

  /** Generate a random number in range [min, max). */
  between(min: number, max: number): number;

  /** Generate a random 32-bit integer. */
  int(): number;
}

/** Stub for type checking. The transpiler replaces these with built-ins. */
declare const Random: IRandomNamespace;

export { Random };
