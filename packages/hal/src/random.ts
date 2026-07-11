import { rawCpp } from './emit.js';

export function randomSeed(seed: number): void {}
export function random(minOrMax: number, max?: number): number { return 0; }

export class Random {
  /** Seeds the PRNG with a starting value. */
  static seed(val: number): void {
    rawCpp(`randomSeed(${val});`);
  }

  /** Returns a random number in range [0, max-1]. */
  static upTo(max: number): number {
    rawCpp(`return random(${max});`);
    return 0;
  }

  /** Returns a random number in range [min, max-1]. */
  static between(min: number, max: number): number {
    rawCpp(`return random(${min}, ${max});`);
    return 0;
  }

  /** Returns a random non-negative 31-bit integer [0, 2147483646]. */
  static int(): number {
    // Arduino random(max) returns [0, max-1]; 2147483647 = INT_MAX gives a
    // non-negative 31-bit range (sign bit always 0).
    rawCpp(`return random(2147483647);`);
    return 0;
  }
}
