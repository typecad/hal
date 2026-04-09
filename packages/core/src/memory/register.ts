// ---------------------------------------------------------------------------
// @typecode/core — Register-mapped struct decorators
//
// Compile-time markers for MMIO register definitions.  At runtime they attach
// metadata via WeakMap; the transpiler reads the metadata when emitting C++.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bit field types
// ---------------------------------------------------------------------------

/**
 * A single-bit value (0 or 1).  Used as the type annotation for 1-bit fields.
 *
 * @example
 * ```typescript
 * @bits(0, 0) declare UE: Bit;
 * ```
 */
export type Bit = 0 | 1;

/**
 * An N-bit wide unsigned value.  Used as the type annotation for multi-bit
 * fields.
 *
 * @example
 * ```typescript
 * @bits(9, 8) declare PS: Bits<2>;
 * ```
 */
export type Bits<N extends number = number> = number;

// ---------------------------------------------------------------------------
// Metadata interfaces
// ---------------------------------------------------------------------------

export interface BitFieldMeta {
  /** Field name */
  name: string;
  /** High bit index (inclusive) */
  hi: number;
  /** Low bit index (inclusive) */
  lo: number;
  /** Width in bits (hi - lo + 1) */
  width: number;
}

export interface RegisterClassMeta {
  /** Register address (e.g. 0x40011000) */
  address: number;
  /** Bit field descriptors */
  bitFields: BitFieldMeta[];
}

// ---------------------------------------------------------------------------
// Internal metadata store (WeakMap – no reflect-metadata dependency)
// ---------------------------------------------------------------------------

const registerMetaStore = new WeakMap<Function, RegisterClassMeta>();

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

/**
 * Class decorator that maps a class to a hardware register address.
 * The transpiler emits a `volatile` pointer instead of a C++ class.
 *
 * @example
 * ```typescript
 * @register(0x4001_1000)
 * class USART1 {
 *   @bits(0, 0)   declare UE:   Bit;
 *   @bits(9, 8)   declare PS:   Bits<2>;
 * }
 * ```
 *
 * @param address - The MMIO register address
 */
export function register(address: number): ClassDecorator {
  return (target: Function): void => {
    const existing = registerMetaStore.get(target) ?? { address, bitFields: [] };
    existing.address = address;
    registerMetaStore.set(target, existing);
  };
}

/**
 * Property decorator that defines a bit field range within a register.
 *
 * @param hi - High bit index (inclusive)
 * @param lo - Low bit index (inclusive)
 *
 * @example
 * ```typescript
 * @bits(0, 0)   declare UE:   Bit;     // single bit at position 0
 * @bits(9, 8)   declare PS:   Bits<2>; // bits 8-9 (2 bits wide)
 * @bits(15, 8)  declare BAUD: Bits<8>; // bits 8-15 (8 bits wide)
 * ```
 */
export function bits(hi: number, lo: number): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const ctor = target instanceof Function ? target : target.constructor;
    const existing = registerMetaStore.get(ctor) ?? { address: 0, bitFields: [] };
    existing.bitFields.push({
      name: typeof propertyKey === 'string' ? propertyKey : String(propertyKey),
      hi,
      lo,
      width: hi - lo + 1,
    });
    registerMetaStore.set(ctor, existing);
  };
}

// ---------------------------------------------------------------------------
// Metadata accessors (used by the transpiler)
// ---------------------------------------------------------------------------

/** Read the register metadata previously attached to a class constructor. */
export function getRegisterMeta(target: Function): RegisterClassMeta | undefined {
  return registerMetaStore.get(target);
}

/**
 * Get all bit fields for a register class.
 * Returns an empty array if the class is not a register class.
 */
export function getBitFields(target: Function): BitFieldMeta[] {
  return registerMetaStore.get(target)?.bitFields ?? [];
}