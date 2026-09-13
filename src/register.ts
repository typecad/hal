// ---------------------------------------------------------------------------
// Register-mapped struct decorators — compile-time markers
//
// `@register(address)` and `@bits(hi, lo)` are recognized by-name by the
// typecad-hal transpiler (packages/cuttlefish/src/ir/register-decorators.ts).
// The transpiler intercepts a class carrying @register, lowers it to a
// `volatile uint32_t*` pointer at the given address, and rewrites field
// reads/writes to shift/mask arithmetic. The decorators themselves are erased
// and never execute, so these are ambient stubs that exist purely so user code
// type-checks under tsc before transpilation.
//
//   @register(0x40011000)
//   class USART1 {
//     @bits(0, 0)  static UE:   Bit       = 0;
//     @bits(9, 8)  static PS:   Bits<2>   = 0;
//     @bits(15, 8) static BAUD: Bits<8>   = 0;
//   }
//   USART1.UE = 1;              // (*USART1 & ~1UL) | ((1 & 1UL) << 0)
//   const parity = USART1.PS;   // ((*USART1 >> 8) & ((1UL << 2) - 1))
// ---------------------------------------------------------------------------

/** A single-bit register field (0 or 1). */
export type Bit = 0 | 1;

/** A multi-bit register field spanning N bits. The numeric type arg carries
 *  the bit width for documentation only; the value is the raw field contents. */
export type Bits<N extends number = number> = number;

/** Class decorator: treat the class as a memory-mapped 32-bit register at
 *  `address`. Fields marked with `@bits` read and write their bit ranges
 *  of that register directly — see the example above. */
export function register(_address: number): ClassDecorator {
  return () => {};
}

/** Property decorator: this field maps the bit range [lo, hi] (inclusive)
 *  of its register. Reading returns the field's bits; writing replaces
 *  them without touching the rest of the register. */
export function bits(_hi: number, _lo: number): PropertyDecorator {
  return () => {};
}
