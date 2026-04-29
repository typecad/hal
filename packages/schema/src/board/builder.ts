// ---------------------------------------------------------------------------
// Board builder utilities
//
// Helpers used by board definition packages.
// ---------------------------------------------------------------------------

/**
 * A branded type representing a physical pin number on the MCU package.
 * Use `pinNumber()` to create from a raw number.
 */
interface PinNumber {
  readonly __brand: unique symbol;
  readonly value: number;
}

/**
 * Create a PinNumber from a raw number.
 * @param n The physical pin number
 */
export function pinNumber(n: number): PinNumber {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid pin number: ${n}. Must be a non-negative integer.`);
  }
  return { value: n } as PinNumber;
}
