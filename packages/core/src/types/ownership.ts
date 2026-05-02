// ---------------------------------------------------------------------------
// Ownership & Borrowing Safety Types
//
// Phantom types that provide Rust-inspired memory safety at transpile time.
// These types are erased during C++ emission but used for:
//   1. Static analysis — transpiler validates ownership rules
//   2. C++ const emission — Shared<T> emits 'const' for compiler-enforced immutability
//
// These are opt-in: if you never use them, no diagnostics are generated.
// ---------------------------------------------------------------------------

/**
 * Ownership kind for a variable or parameter.
 *
 * - 'owned'   — Exclusive ownership. Assignment transfers (moves) ownership.
 * - 'shared'   — Immutable borrow. Read-only access. Emits 'const' in C++.
 * - 'mutable'  — Mutable borrow. Read-write access. Only one at a time.
 */
export type OwnershipKind = 'owned' | 'shared' | 'mutable';

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
 * Immutable borrow — read-only access. Multiple Shared borrows can coexist.
 *
 * ```typescript
 * function readByte(buf: Shared<Uint8Array>, idx: uint8): uint8 {
 *   return buf[idx];  // OK: read access
 *   // buf[idx] = 0;  // ERROR: cannot assign to immutable borrow
 * }
 * ```
 *
 * C++ emission: adds 'const' qualifier for compiler-enforced immutability.
 */
export type Shared<T = any> = T;

/**
 * Mutable borrow — read-write access. Only one Mutable can exist at a time.
 *
 * ```typescript
 * function writeByte(buf: Mutable<Uint8Array>, idx: uint8, val: uint8): void {
 *   buf[idx] = val;  // OK: mutable borrow allows writes
 * }
 * ```
 *
 * C++ emission: no const annotation (mutable reference).
 */
export type Mutable<T = any> = T;

