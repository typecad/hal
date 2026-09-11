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

/** A seeded pseudo-random number generator: `Random.seed(42)` starts a
 *  reproducible sequence; `Random.upTo(n)`, `Random.between(a, b)`, and
 *  `Random.int()` draw values from it. Without seed(), the sequence
 *  differs on every boot. */
export class Random {
  /** Seed the generator with a starting value — same seed, same sequence
   *  of values on every run. */
  static seed(val: number): void {}

  /** A random integer in [0, max-1]. */
  static upTo(max: number): number { return 0; }

  /** A random integer in [min, max-1]. */
  static between(min: number, max: number): number { return 0; }

  /** A random non-negative integer up to 2147483646. */
  static int(): number { return 0; }
}
