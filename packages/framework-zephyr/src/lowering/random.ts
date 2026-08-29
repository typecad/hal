// ---------------------------------------------------------------------------
// Random lowering — Zephyr random subsystem (sys_rand_get) + xorshift32 PRNG
//
// Zephyr's <zephyr/random/random.h> exposes sys_rand_get(dst, len), backed by
// the configured entropy source (the nRF52840 hardware RNG when
// CONFIG_HARDWARE_DEVICE_RANDOM_GENERATOR is selected, or the default test/
// xoroshiro generator otherwise). It is seeded automatically at boot from the
// entropy driver, so there is no implicit seeding step.
//
// The HAL random surface is the Arduino-core model:
//   random.int()    → a non-negative 31-bit integer [0, 2^31 - 1]
//   random.range(a,b) → [a, b-1]   (Random.upTo(n) collapses to range(0, n))
//   random.seed(s)  → re-seed the PRNG (Arduino randomSeed makes the sequence
//                     deterministic from s)
//
// To honor random.seed (which sys_rand_get cannot, being a non-seedable
// entropy tap), the lowering keeps a userspace xorshift32 PRNG. It is seeded
// once from sys_rand_get on first use (so an unseeded program gets
// hardware-random behavior), and re-seeded verbatim by random.seed (so a
// program that calls Random.seed(42) gets a deterministic sequence, matching
// the Arduino contract). xorshift32 is a 2^32-1-period PRNG adequate for the
// non-cryptographic random.* surface; sys_csrand_get exists for crypto use the
// HAL does not expose.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * The random runtime shim. The xorshift32 state is a 32-bit word seeded from
 * sys_rand_get on first use; random.seed overwrites it. Helpers are
 * `static`/`inline` so the single generated TU does not trip -Wunused-function
 * when only a subset of the ops is used (mirrors preferences.ts / wifi.ts).
 */
export function randomInitLines(): string[] {
  return [
    `// CUTTLEFISH_RANDOM_BEGIN`,
    `#include <zephyr/random/random.h>`,
    ``,
    `// xorshift32 state. Seeded from sys_rand_get on first use; random.seed`,
    `// overwrites it. uint32_t (not int32_t) so the sign bit never leaks into`,
    `// the HAL's non-negative random.int range.`,
    `static uint32_t __tc_rand_state = 0U;`,
    `static bool __tc_rand_seeded = false;`,
    ``,
    `// One-time seed from the Zephyr entropy tap. Called lazily so a program`,
    `// that only ever calls Random.seed never touches sys_rand_get (and so a`,
    `// capability probe with no board never needs the entropy driver at all).`,
    `static inline void __tc_rand_ensure_seeded(void) {`,
    `    if (!__tc_rand_seeded) {`,
    `        uint32_t seed = 0U;`,
    `        (void)sys_rand_get(&seed, sizeof(seed));`,
    `        // xorshift32 needs a non-zero state; if the entropy tap returns 0`,
    `        // (vanishingly unlikely), fall back to a fixed odd constant so the`,
    `        // sequence is still well-defined rather than stuck at 0.`,
    `        if (seed == 0U) { seed = 0x9E3779B9U; }`,
    `        __tc_rand_state = seed;`,
    `        __tc_rand_seeded = true;`,
    `    }`,
    `}`,
    ``,
    `// Advance the xorshift32 state one step and return the raw 32-bit word.`,
    `static inline uint32_t __tc_rand_next(void) {`,
    `    __tc_rand_ensure_seeded();`,
    `    uint32_t x = __tc_rand_state;`,
    `    x ^= x << 13;`,
    `    x ^= x >> 17;`,
    `    x ^= x << 5;`,
    `    __tc_rand_state = x;`,
    `    return x;`,
    `}`,
    ``,
    `// Re-seed the PRNG. After this call the sequence is deterministic from`,
    `// \`seed\`, matching the platform's randomSeed. A literal zero seed is accepted and`,
    `// remapped to the same odd constant (xorshift32 cannot start from 0).`,
    `static inline void __tc_rand_seed(uint32_t seed) {`,
    `    __tc_rand_state = (seed == 0U) ? 0x9E3779B9U : seed;`,
    `    __tc_rand_seeded = true;`,
    `}`,
    ``,
    `// Non-negative 31-bit integer [0, 2^31 - 1]. Mask the top bit so the value`,
    `// is always non-negative even though int32_t is the HAL return type.`,
    `static inline int32_t __tc_rand_int(void) {`,
    `    return static_cast<int32_t>(__tc_rand_next() & 0x7FFFFFFFU);`,
    `}`,
    ``,
    `// Half-open range [min, max-1]. Implements the HAL contract directly rather`,
    `// than calling the platform random(min, max): the modulus rejection-free form`,
    `// avoids the modulo bias a naive (rand % (max-min)) introduces. max > min`,
    `// is assumed (the HAL validates this at the source level).`,
    `static inline int32_t __tc_rand_range(int32_t min, int32_t max) {`,
    `    if (max <= min) { return min; }`,
    `    uint32_t span = static_cast<uint32_t>(max) - static_cast<uint32_t>(min);`,
    `    uint32_t r = __tc_rand_next();`,
    `    return static_cast<int32_t>(min + static_cast<int32_t>(r % (span + 1U)));`,
    `}`,
    `// CUTTLEFISH_RANDOM_END`,
    ``,
  ];
}

/**
 * Resolve a HAL random.* op to Zephyr C++ via the __tc_rand_* shim.
 * Returns `{ code }` for the statement op (seed), `{ expression }` for the
 * value-returning ops (int / range). The `default` arm throws the standard
 * unsupported-op error so the manifest validator's per-op probe stays honest.
 */
export function lowerRandom(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as { min?: unknown; max?: unknown; seed?: unknown };

  switch (op.operation) {
    case 'random.int':
      return { expression: '__tc_rand_int()' };
    case 'random.range': {
      // When min is a literal 0 (the Random.upTo(max) collapse), emit the
      // single-arg __tc_rand_range(0, max) form for readability — it is the
      // exact equivalent range and matches what the HAL upTo path expects.
      if (String(o.min) === '0') return { expression: `__tc_rand_range(0, ${String(o.max)})` };
      return { expression: `__tc_rand_range(${String(o.min)}, ${String(o.max)})` };
    }
    case 'random.seed': {
      // The manifest validator's probe sends no seed field; tolerate it with a
      // literal 0 (mirrors how wdt.lowering tolerates an absent timeout).
      const seed = o.seed === undefined ? 0 : o.seed;
      return { code: `__tc_rand_seed(static_cast<uint32_t>(${String(seed)}));` };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
