// ---------------------------------------------------------------------------
// Rng.ts — seeded splitmix32 generator (deterministic).
//
// SUPPORT_MATRIX tour:
//   §1.2  uint32_t pass-through (number→double would break bitwise, §1.3)
//   §4.1  class with private field, static factory, instance methods
//   §5.1  bitwise mix (*, ^, <<, >>>)
// ---------------------------------------------------------------------------

export class Rng {
  private state: uint32_t;

  constructor(seed: uint32_t) {
    this.state = seed === 0 ? 0x9E3779B9 : seed;
  }

  static fromSeed(seed: uint32_t): Rng {
    return new Rng(seed);
  }

  next(): uint32_t {
    let z: uint32_t = this.state + 0x9E3779B9;
    this.state = z;
    z = (z ^ (z >>> 16)) * 0x85EBCA6B;
    z = (z ^ (z >>> 13)) * 0xC2B2AE35;
    z = z ^ (z >>> 16);
    return z >>> 0;
  }

  // int in [lo, hi] inclusive.
  range(lo: int16_t, hi: int16_t): int16_t {
    const span = hi - lo + 1;
    return (this.next() % span) + lo;
  }

  // boolean with probability p in [0,1].
  chance(p: number): boolean {
    return this.next() / 4294967296 < p;
  }
}
