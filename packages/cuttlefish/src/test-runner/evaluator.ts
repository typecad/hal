// ---------------------------------------------------------------------------
// cuttlefish test-runner — Assertion evaluator
//
// All assertion logic runs on the host (computer) side.  The firmware only
// sends raw actual/expected values over serial — the host does the math.
// ---------------------------------------------------------------------------

import type { MatcherName } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single assertion on the host side.
 *
 * @param matcher   The matcher name (e.g. `'toBe'`, `'toBeLessThan'`).
 * @param expected  The expected value(s) as a raw string from the serial protocol.
 * @param actual    The actual value as a raw string from the serial protocol.
 * @returns `true` if the assertion passes.
 */
export function evaluate(matcher: MatcherName, expected: string, actual: string): boolean {
  switch (matcher) {
    case 'toBe':
      return evaluateToBe(expected, actual);

    case 'toNotBe':
      return !evaluateToBe(expected, actual);

    case 'toBeGreaterThan':
      return toNum(actual) > toNum(expected);

    case 'toBeGreaterThanOrEqual':
      return toNum(actual) >= toNum(expected);

    case 'toBeLessThan':
      return toNum(actual) < toNum(expected);

    case 'toBeLessThanOrEqual':
      return toNum(actual) <= toNum(expected);

    case 'toBeCloseTo': {
      // expected format: "value,precision" e.g. "3.14,2"
      const parts = expected.split(',');
      const expVal = toNum(parts[0] ?? '0');
      const precision = parts.length > 1 ? parseInt(parts[1], 10) : 2;
      const tolerance = Math.pow(10, -precision);
      return Math.abs(toNum(actual) - expVal) < tolerance;
    }

    case 'toBeWithinRange': {
      // expected format: "min,max"
      const parts = expected.split(',');
      const min = toNum(parts[0] ?? '0');
      const max = toNum(parts[1] ?? '0');
      const val = toNum(actual);
      return val >= min && val <= max;
    }

    case 'toBeTruthy':
      return toNum(actual) !== 0;

    case 'toBeFalsy':
      return toNum(actual) === 0;

    case 'toContain':
      return actual.includes(expected);

    case 'toHaveLength':
      return actual.length === parseInt(expected, 10);

    default: {
      const _exhaustive: never = matcher;
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Public — Human-readable descriptions
// ---------------------------------------------------------------------------

/**
 * Return a human-readable description of what the matcher checks.
 */
export function describeExpected(matcher: MatcherName, expected: string): string {
  switch (matcher) {
    case 'toBe':              return `to be ${expected}`;
    case 'toNotBe':           return `to not be ${expected}`;
    case 'toBeGreaterThan':   return `to be > ${expected}`;
    case 'toBeGreaterThanOrEqual': return `to be >= ${expected}`;
    case 'toBeLessThan':      return `to be < ${expected}`;
    case 'toBeLessThanOrEqual': return `to be <= ${expected}`;
    case 'toBeCloseTo': {
      const parts = expected.split(',');
      const precision = parts[1] ?? '2';
      return `to be close to ${parts[0]} (±${Math.pow(10, -parseInt(precision, 10))})`;
    }
    case 'toBeWithinRange': {
      const parts = expected.split(',');
      return `to be within ${parts[0]}–${parts[1]}`;
    }
    case 'toBeTruthy':        return 'to be truthy (≠ 0)';
    case 'toBeFalsy':         return 'to be falsy (= 0)';
    case 'toContain':         return `to contain "${expected}"`;
    case 'toHaveLength':      return `to have length ${expected}`;
    default: {
      const _exhaustive: never = matcher;
      return `${matcher}(${expected})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function evaluateToBe(expected: string, actual: string): boolean {
  // Try numeric comparison first
  // Use Number() instead of parseFloat() so hex literals like "0x10" are
  // correctly parsed (parseFloat stops at the "x" and returns 0).
  const numExp = Number(expected);
  const numAct = Number(actual);
  if (!isNaN(numExp) && !isNaN(numAct)) {
    return numAct === numExp;
  }
  // Fall back to string comparison
  return actual === expected;
}

function toNum(s: string): number {
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}
