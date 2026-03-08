// ---------------------------------------------------------------------------
// @typecode/core — Random number utilities (random, randomSeed)
// ---------------------------------------------------------------------------

/**
 * Random number namespace with both direct and fluent APIs.
 */
export interface IRandomNamespace {
  // --- Direct functions (Arduino-compatible) ---
  
  /**
   * Initialize the pseudo-random number generator.
   * Maps to Arduino `randomSeed()`.
   */
  seed(seed: number): void;
  
  /**
   * Generate a random number up to max (exclusive).
   * Maps to Arduino `random(max)`.
   */
  next(max: number): number;
  
  /**
   * Generate a random number in range [min, max).
   * Maps to Arduino `random(min, max)`.
   */
  next(min: number, max: number): number;
  
  // --- Fluent builders ---
  
  /**
   * Initialize with a seed value (fluent alias for seed).
   * @example Random.seedWith(A0.read())
   */
  seedWith(seed: number): void;
  
  /**
   * Generate a random number in range [min, max).
   * @example Random.between(10, 20)
   */
  between(min: number, max: number): number;
  
  /**
   * Generate a random number from 0 to max-1.
   * @example Random.upTo(100)  // 0-99
   */
  upTo(max: number): number;
  
  /**
   * Generate a random 32-bit integer.
   */
  int(): number;
}

/** Stub for type checking. The transpiler replaces these with Arduino built-ins. */
declare const Random: IRandomNamespace;

export { Random };