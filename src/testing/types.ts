// ---------------------------------------------------------------------------
// @typecad/hal/testing — Firmware-side types
//
// These interfaces define the fluent API that users write in test files.
// They exist purely for TypeScript IntelliSense — the preprocessor rewrites
// all calls to Serial protocol statements before transpilation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Numeric assertion chain
// ---------------------------------------------------------------------------

/**
 * Numeric assertion — provides matchers that compare a numeric `actual` value
 * against an `expected` value.  Each matcher returns the parent `Suite` so
 * the chain can continue with `.it()` or another `.expect()`.
 */
export interface Expectation {
  /** Exact equality: `actual === expected`. */
  toBe(expected: number): Suite;

  /** Strict greater-than: `actual > expected`. */
  toBeGreaterThan(n: number): Suite;

  /** Greater-than or equal: `actual >= expected`. */
  toBeGreaterThanOrEqual(n: number): Suite;

  /** Strict less-than: `actual < expected`. */
  toBeLessThan(n: number): Suite;

  /** Less-than or equal: `actual <= expected`. */
  toBeLessThanOrEqual(n: number): Suite;

  /**
   * Approximate equality: `|actual − expected| < 10^(−precision)`.
   * @param n        The expected value.
   * @param precision  Number of decimal digits (default 2 → 0.01 tolerance).
   */
  toBeCloseTo(n: number, precision?: number): Suite;

  /** Range check: `actual >= min && actual <= max`. */
  toBeWithinRange(min: number, max: number): Suite;

  /** Truthy: `actual !== 0`. */
  toBeTruthy(): Suite;

  /** Falsy: `actual === 0`. */
  toBeFalsy(): Suite;

  /** Not-equal: `actual !== expected`. */
  toNotBe(expected: number): Suite;
}

// ---------------------------------------------------------------------------
// String assertion chain
// ---------------------------------------------------------------------------

/**
 * String assertion — provides matchers that compare a string `actual` value.
 */
export interface StringExpectation {
  /** Exact string equality. */
  toBe(expected: string): Suite;

  /** Substring check. */
  toContain(substring: string): Suite;

  /** Length check. */
  toHaveLength(n: number): Suite;

  /** Not-equal. */
  toNotBe(expected: string): Suite;
}

// ---------------------------------------------------------------------------
// Suite (describe / it chain)
// ---------------------------------------------------------------------------

/**
 * A test suite — the return value of `describe()`.  Supports fluent chaining
 * of `.it()` and `.expect()` calls.
 *
 * @example
 * ```ts
 * describe("A0 reads")
 *   .it("reads zero when grounded")
 *     .expect(A0.readAnalog()).toBe(0)
 *   .it("reads less than 100")
 *     .expect(A0.readAnalog()).toBeLessThan(100);
 * ```
 */
export interface Suite {
  /** Start a new test case within the current describe group. */
  it(name: string): Suite;

  /** Assert a numeric value (or a function that returns one). */
  expect(actual: number | (() => number)): Expectation;

  /** Assert a string value (or a function that returns one). */
  expectString(actual: string | (() => string)): StringExpectation;
}
