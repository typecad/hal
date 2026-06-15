// ---------------------------------------------------------------------------
// Rng.ts — deterministic PRNG.
// SUPPORT_MATRIX: §4.1 (private static), §5.1 (bitwise), §1.2 (uint32_t).
// ---------------------------------------------------------------------------

export class Rng {
  private static state: uint32_t = 0x6D5A56A8;

  public static seed(value: uint32_t): void {
    Rng.state = (value ^ 0x9E3779B9) & 0xFFFFFFFF;
  }

  private static next(): uint32_t {
    let s: uint32_t = Rng.state;
    s = (s ^ (s << 13)) & 0xFFFFFFFF;
    s = (s ^ (s >> 17)) & 0xFFFFFFFF;
    s = (s ^ (s << 5)) & 0xFFFFFFFF;
    Rng.state = s;
    return s;
  }

  public static nextInt(min: number, max: number): number {
    if (max <= min) {
      return min;
    }
    const span: uint32_t = (max - min) + 1;
    return min + (Rng.next() % span);
  }

  public static nextUnit(): number {
    return Rng.next() / 4294967296;
  }
}
