// ---------------------------------------------------------------------------
// Random — the thin PRNG surface
//
// The Random namespace methods (seed/upTo/between/int) are intercepted by the
// transpiler's namespace-method resolver and lowered to the random.* HAL op
// family (random.seed / random.range / random.int), which each framework lowers
// to its platform PRNG (Zephyr: a userspace xorshift32 seeded from
// sys_rand_get). The bodies below are inert runtime stubs for host-side
// type-checking only — never emitted.
// ---------------------------------------------------------------------------

export class Random {
  /** Seeds the PRNG with a starting value. */
  static seed(val: number): void {}

  /** Returns a random number in range [0, max-1]. */
  static upTo(max: number): number { return 0; }

  /** Returns a random number in range [min, max-1]. */
  static between(min: number, max: number): number { return 0; }

  /** Returns a random non-negative 31-bit integer [0, 2147483646]. */
  static int(): number { return 0; }
}
