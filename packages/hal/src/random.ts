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

  /** Returns a random 32-bit integer. */
  static int(): number {
    // Arduino random() returns long (32-bit on most platforms)
    rawCpp(`return random(2147483647);`); 
    return 0;
  }
}
