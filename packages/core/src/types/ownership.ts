// ---------------------------------------------------------------------------
// Ownership & Borrowing Safety Types
//
// Phantom types that provide Rust-inspired memory safety at transpile time.
// These types are erased during C++ emission but used for:
//   1. Static analysis — transpiler validates ownership rules
//   2. C++ const emission — Ref<T> emits 'const' for compiler-enforced immutability
//
// These are opt-in: if you never use them, no diagnostics are generated.
// ---------------------------------------------------------------------------

/**
 * Ownership kind for a variable or parameter.
 *
 * - 'owned'   — Exclusive ownership. Assignment transfers (moves) ownership.
 * - 'ref'     — Immutable borrow. Read-only access. Emits 'const' in C++.
 * - 'mut_ref' — Mutable borrow. Read-write access. Only one at a time.
 */
export type OwnershipKind = 'owned' | 'ref' | 'mut_ref';

/**
 * Marks a value as exclusively owned. Assignment transfers ownership.
 * The source variable becomes invalid after a move.
 *
 * ```typescript
 * let buffer: Owned<Uint8Array> = new Uint8Array(32);
 * let moved = buffer;  // ownership transferred — buffer is now invalid
 * ```
 *
 * C++ emission: no const annotation (same as bare type).
 */
export type Owned<T = any> = T;

/**
 * Immutable borrow — read-only access. Multiple Ref borrows can coexist.
 *
 * ```typescript
 * function readByte(buf: Ref<Uint8Array>, idx: uint8): uint8 {
 *   return buf[idx];  // OK: read access
 *   // buf[idx] = 0;  // ERROR: cannot assign to immutable borrow
 * }
 * ```
 *
 * C++ emission: adds 'const' qualifier for compiler-enforced immutability.
 */
export type Ref<T = any> = T;

/**
 * Mutable borrow — read-write access. Only one MutRef can exist at a time.
 *
 * ```typescript
 * function writeByte(buf: MutRef<Uint8Array>, idx: uint8, val: uint8): void {
 *   buf[idx] = val;  // OK: mutable borrow allows writes
 * }
 * ```
 *
 * C++ emission: no const annotation (mutable reference).
 */
export type MutRef<T = any> = T;

/**
 * Extract the ownership kind from a type annotation string.
 * Returns 'owned' as default (no special wrapper).
 *
 * @param typeText - The C++ type string, possibly wrapped with ownership annotation
 * @returns The detected ownership kind
 */
export function extractOwnershipKind(typeText: string): OwnershipKind {
  if (typeText.startsWith('Ref<') || typeText.startsWith('const ')) {
    return 'ref';
  }
  if (typeText.startsWith('MutRef<')) {
    return 'mut_ref';
  }
  if (typeText.startsWith('Owned<')) {
    return 'owned';
  }
  return 'owned';
}

/**
 * Strip the ownership wrapper from a type string, returning the inner type.
 *
 * @param typeText - The type string, possibly wrapped (e.g., "Ref<uint8[]>")
 * @returns The unwrapped type (e.g., "uint8[]")
 */
export function unwrapOwnershipType(typeText: string): string {
  const refMatch = typeText.match(/^Ref<(.+)>$/);
  if (refMatch) return refMatch[1];

  const mutRefMatch = typeText.match(/^MutRef<(.+)>$/);
  if (mutRefMatch) return mutRefMatch[1];

  const ownedMatch = typeText.match(/^Owned<(.+)>$/);
  if (ownedMatch) return ownedMatch[1];

  return typeText;
}
