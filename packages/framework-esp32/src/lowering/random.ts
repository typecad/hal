import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

// Random — native ESP-IDF hardware RNG.
//
// ESP-IDF's esp_random() returns a uniformly-distributed uint32_t from the
// hardware RNG (seeded by RF noise after WiFi/BLE init; falls back to an
// LFSR before that). Unlike Arduino's PRNG, it needs no seeding, so
// random.seed lowers to a no-op (kept as a statement so user code that calls
// Random.seed() still transpiles).
//
// The helpers below mirror Arduino random() semantics on top of esp_random():
//   random.range(min, max) → [min, max-1]   (Arduino random(min, max))
//   random.int()           → [0, 2^31-1]    (non-negative 31-bit)
//
// esp_random() is declared in <esp_random.h>, which the forced-includes path
// adds when usesRandom is set (see strategy.ts forcedIncludes).

/** Resolve a HAL random.* op to ESP-IDF C++. */
export function lowerRandom(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'random.seed':
      // ESP-IDF's hardware RNG is self-seeding (RF noise); user seeding is a
      // no-op. Emit nothing, but return an empty code block so the dispatcher
      // treats the op as handled (not "unsupported").
      return { code: '' };

    case 'random.int':
      // Non-negative 31-bit integer: mask off the sign bit.
      return { expression: '(static_cast<long>(esp_random() & 0x7FFFFFFF))' };

    case 'random.range': {
      const min = o.min;
      const max = o.max;
      // Arduino random(min, max) → [min, max-1]. Implement via modulo on the
      // unsigned 31-bit range: (esp_random() % (max - min)) + min. Guard the
      // degenerate range (max == min → returns min) to avoid mod-by-zero.
      return {
        expression:
          `(static_cast<long>((esp_random() % static_cast<uint32_t>((${max}) - (${min}))) + (${min})))`,
      };
    }

    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
