// The blink cadence, shared across modules — exercises cross-file import
// lowering (const array + functions) alongside main.ts's entry surface.

export const BLINK_PATTERN_MS: readonly number[] = [100, 100, 100, 400, 400, 900];

/** Total length of one pattern pass, in ms. */
export function patternPeriodMs(pattern: readonly number[]): number {
  let total = 0;
  for (const step of pattern) total += step;
  return total;
}

/** The on-duration for pattern index i (even indices are LED-on). */
export function stepDurationMs(pattern: readonly number[], i: number): number {
  return pattern[i % pattern.length];
}
