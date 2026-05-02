import { Owned, Shared, Mutable } from '@typehal';

// ==========================================================================
// ERROR 1: ownership-assign-to-ref
// Assigning to a Ref (immutable borrow) is forbidden — would break read-only
// contract that C++ emits as 'const'.
// ==========================================================================

function assignToRefDemo(x: Shared<number>): void {
  x = 99;         // ERROR: Cannot assign to 'x' — it is an immutable borrow.
}

function updateRefDemo(x: Shared<number>): void {
  x++;            // ERROR: Cannot update 'x' — it is an immutable borrow.
}

// ==========================================================================
// ERROR 2: ownership-use-after-move
// After an Owned variable is moved (assigned to another variable), the source
// is invalidated. Any subsequent read triggers use-after-move.
// ==========================================================================

function useAfterMoveDemo(): void {
  const a: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);
  const b = a;    // ownership transfer — 'a' is now invalid
  const c = a;    // ERROR: 'a' was moved and cannot be used again.
}

// ==========================================================================
// ERROR 3: ownership-borrow-mismatch
// A Ref (immutable) variable cannot be passed where a MutRef (mutable borrow)
// is expected — would allow writes through a read-only reference.
// ==========================================================================

function needsMut(buf: Mutable<Uint8Array>): void {
  buf[0] = 0xFF;
}

function borrowMismatchDemo(): void {
  const src: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);
  const view: Shared<Uint8Array> = src;   // immutable borrow
  needsMut(view);                      // ERROR: Cannot pass 'view' (immutable Ref) where MutRef expected.
}

// ==========================================================================
// ERROR 4: ownership-dangling-borrow
// A Ref/MutRef in an outer scope that borrows from an Owned variable in a
// child scope — the source is destroyed when the child scope exits.
// ==========================================================================

function danglingBorrowDemo(): void {
  const outer: Owned<Uint8Array> = new Uint8Array([9, 9, 9]);
  let saved: Mutable<Uint8Array> = outer;
  {
    const local: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);
    saved = local;    // ERROR: 'saved' borrows 'local' which goes out of scope — dangling reference.
  }
  console.log(saved[0]);   // UB: 'local' has been destroyed
}

// ==========================================================================
// ERROR 5: ownership-return-local-ref
// Returning a Ref/MutRef that borrows from a stack-local Owned variable.
// The owned variable is destroyed when the function returns → dangling reference.
// ==========================================================================

function returnLocalRefDemo(): Shared<Uint8Array> {
  const local: Owned<Uint8Array> = new Uint8Array([4, 5, 6]);
  const view: Shared<Uint8Array> = local;
  return view;       // ERROR: Returning 'view' borrows 'local' which will be destroyed.
}

// ==========================================================================
// WARNING 6: ownership-temp-ref-warn
// Ref/MutRef initialised from a non-identifier expression (literal, new, etc.).
// C++ cannot bind a const& to an rvalue — emitter falls back to a copy.
// ==========================================================================

function tempRefWarnDemo(): void {
  const view: Shared<Uint8Array> = new Uint8Array([1, 2, 3]);   // WARNING: borrows temporary
  console.log(view[0]);
}

// ==========================================================================
// WARNING 7: ownership-suggest-const
// A 'let' variable that is never reassigned. Runs regardless of ownership types.
// ==========================================================================

function suggestConstDemo(): void {
  let threshold = 42;    // WARNING: 'threshold' is never reassigned. Use const.
  console.log(threshold);
}

// ==========================================================================
// INFO 8: ownership-owned-copy
// Moving a non-primitive Owned variable into an unannotated variable creates
// a C++ copy — ownership types do not emit std::move().
// ==========================================================================

function ownedCopyDemo(): void {
  const src: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);
  const copy = src;      // INFO: Moving 'src' into 'copy' creates a C++ copy.
}

// ==========================================================================
// INFO 9: ownership-implicit-copy
// Copying a non-primitive non-Owned variable into an unannotated variable
// silently copies — no borrow annotation exists to indicate reference semantics.
// ==========================================================================

function implicitCopyDemo(): void {
  const src: Shared<Uint8Array> = new Uint8Array([1, 2, 3]);   // (also triggers temp-ref-warn)
  const dup = src;       // INFO: 'dup' silently copies 'src' — no borrow annotation.
  console.log(dup[0]);
}

// ==========================================================================
// Exercise all diagnostics
// ==========================================================================

assignToRefDemo(0);
updateRefDemo(0);
useAfterMoveDemo();
borrowMismatchDemo();
danglingBorrowDemo();
returnLocalRefDemo();
tempRefWarnDemo();
suggestConstDemo();
ownedCopyDemo();
implicitCopyDemo();
