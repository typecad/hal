// ---------------------------------------------------------------------------
// Example 22 — Ownership & Borrowing Safety (Opt-In)
//
// Demonstrates Rust-inspired ownership types for memory-safe embedded code.
// These phantom types are erased at transpile time — zero runtime cost — but
// the transpiler enforces safety rules at build time.
//
// Three ownership kinds:
//
//   Owned<T>   — The variable owns its data. Assignment moves ownership.
//                Use after move is a transpile-time error.
//
//   Ref<T>     — An immutable borrow. The transpiler emits `const` in C++.
//                Assignment to a Ref is a transpile-time error.
//
//   MutRef<T>  — A mutable borrow. Allows in-place modification.
//
// All rules are opt-in: if you don't use these types, no diagnostics are
// generated and your code compiles exactly as before.
// ---------------------------------------------------------------------------

// Phantom type declarations (these are erased during transpilation)
type Owned<T> = T;
type Ref<T> = T;
type MutRef<T> = T;

// --- Example 1: Immutable borrow (Ref<T>) --------------------------------
// The transpiler emits `const int data` in C++, preventing accidental mutation.

function processData(data: Ref<number>): void {
  console.log(data);
  // data = 99;  // ERROR: Cannot assign to immutable borrow 'data'
}

// --- Example 2: Mutable borrow (MutRef<T>) -------------------------------
// Allows in-place modification through the borrow.

function increment(value: MutRef<number>): void {
  value = value + 1;
}

// --- Example 3: Ownership transfer (Owned<T>) ----------------------------
// Moving an owned variable transfers ownership; the original is no longer usable.

function transferExample(): void {
  let buffer: Owned<number[]> = [1, 2, 3];
  let consumer = buffer;
  // console.log(buffer);  // ERROR: 'buffer' was moved and cannot be used
  console.log(consumer);    // OK: consumer now owns the data
}

// --- Example 4: Const suggestion -----------------------------------------
// The transpiler warns when a `let` variable is never reassigned,
// suggesting `const` for clearer intent.

function constSuggestion(): void {
  let threshold = 42;       // WARNING: Consider using 'const' instead
  console.log(threshold);
}

// --- Entry point ----------------------------------------------------------
// Call the examples
processData(100);
