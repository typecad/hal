
// // ==========================================================================
// // Feature 1: Immutable borrow (Ref)
// // Ref<number[]> → const std::vector<int>&   (zero-copy, read-only)
// // Ref<number>   → const int                 (primitive by value)
// // DIAGNOSTIC: assigning to a Ref parameter → ownership-assign-to-ref (error)
// // ==========================================================================

// function readBuffer(buf: Ref): void {
//   console.log(buf[0]);
// }
 
// // Intentional diagnostic: assigning to an immutable borrow
// function assignToRefDemo(x: Ref): void {
//   x = 99;  // error  [ownership-assign-to-ref]: Cannot assign to 'x' — it is an immutable borrow.
//            //   ↳  change 'x: Ref' → 'x: MutRef'  // MutRef allows mutation
// }

// // ==========================================================================
// // Feature 2: Mutable borrow (MutRef)
// // MutRef<number[]> → std::vector<int>&   (read/write reference)
// // ==========================================================================

// function zeroFirst(buf: MutRef): void {
//   buf[0] = 0;   // OK: MutRef allows writes
// }

// // ==========================================================================
// // Feature 3: Ownership transfer + use-after-move
// // DIAGNOSTIC: using an Owned variable after it has been moved → ownership-use-after-move (error)
// // ==========================================================================

// function useAfterMoveDemo(): void {
//   let a: Owned = [1, 2, 3];
//   let b = a;  // move — 'a' is now invalid
//   let c = a;  // error [ownership-use-after-move]: 'a' was moved and cannot be used again.
//               //   ↳  const a_ref: Ref = a;  // add this before the move
// }

// // ==========================================================================
// // Feature 4: Zero-copy borrow  (Ref = ownedVar)
// // `const view: Ref = source` emits `const std::vector<int>& view = source` — no copy.
// // DIAGNOSTIC: assigning Owned to bare variable → ownership-owned-copy (info)
// // ==========================================================================

// function zeroCopyDemo(): void {
//   const source: Owned = [1, 2, 3];
//   const view: Ref = source;   // const std::vector<int>& view = source;  ← zero copy ✓
//   readBuffer(view);

//   const source2: Owned = [4, 5, 6];
//   const copy = source2;       // info  [ownership-owned-copy]: Moving 'source2' into 'copy'
//                               //         creates a C++ copy — ownership types do not emit std::move()
//                               //   ↳  const copy: Ref = source2;  // borrow by reference instead
// }

// // ==========================================================================
// // Feature 5: Borrow-mismatch guard
// // DIAGNOSTIC: Ref argument passed to MutRef parameter → ownership-borrow-mismatch (error)
// // ==========================================================================

// function doubleFirst(buf: MutRef): void {
//   buf[0] = buf[0] * 2;
// }

// function borrowMismatchDemo(): void {
//   const source: Owned = [1, 2, 3];
//   const data: Ref = source;  // zero-copy borrow
//   doubleFirst(data);  // error [ownership-borrow-mismatch]: Cannot pass 'data' (immutable Ref)
//                       //         to 'doubleFirst' which expects a mutable borrow.
//                       //   ↳  change 'data: Ref = ...' → 'data: MutRef = ...'
// }

// // ==========================================================================
// // Feature 6: Temp-ref warning  (Ref from literal)
// // C++ cannot bind const& to an rvalue — emitter falls back to a copy.
// // DIAGNOSTIC: Ref initialised from non-identifier → ownership-temp-ref-warn (warning)
// // ==========================================================================

// function tempRefDemo(): void {
//   const view: Ref = [1, 2, 3];  // warning [ownership-temp-ref-warn]:
//                                            //   'view: Ref' borrows a temporary — C++ cannot bind
//                                            //   a reference to an rvalue. Emitter falls back to copy.
//                                            //   ↳  const _tmp: Owned = ...;
//                                            //      const view: Ref = _tmp;
//   readBuffer(view);
// }

// // ==========================================================================
// // Feature 7: Dangling-borrow detection  (NEW)
// // A borrow that outlives its Owned source → undefined behaviour in C++.
// // DIAGNOSTIC: borrow outlives scope of owning variable → ownership-dangling-borrow (error)
// // ==========================================================================

// function danglingDemo(): void {
//   const outer: Owned = [9, 9, 9];
//   let saved: MutRef = outer;  // initial safe borrow of a local variable
//   {
//     const local: Owned = [1, 2, 3];
//     saved = local;  // error [ownership-dangling-borrow]: 'saved' borrows 'local'
//                     //         which goes out of scope here — potential dangling reference.
//                     //   ↳  move 'local' to the outer scope, or ensure 'saved' does not outlive it
//   }
//   readBuffer(saved);  // ← C++ UB: 'local' has been destroyed
// }

// // ==========================================================================
// // Feature 8: Return-local-ref detection  (NEW)
// // Returning a Ref whose source is a stack-local Owned variable is UB in C++.
// // DIAGNOSTIC: returning borrow of local → ownership-return-local-ref (error)
// // ==========================================================================

// function returnLocalRefDemo(): Ref {
//   const local: Owned = [4, 5, 6];
//   const view: Ref = local;
//   return view;  // error [ownership-return-local-ref]: Returning 'view' borrows 'local'
//                 //         which will be destroyed when this function returns — dangling reference.
//                 //   ↳  return local directly as Owned, or change the function to accept
//                 //         'local: Ref' as a parameter
// }

// // ==========================================================================
// // Feature 9: Const suggestion
// // DIAGNOSTIC: let variable never reassigned → ownership-suggest-const (warning)
// // ==========================================================================

// function constSuggestionDemo(): void {
//   let threshold = 42;   // warning [ownership-suggest-const]: 'threshold' is never reassigned.
//                         //   ↳  const threshold = ...;
//   console.log(threshold);
// }

// // ==========================================================================
// // Entry point — all demos run
// // ==========================================================================

// const buf: Owned = [1, 2, 3];

// readBuffer(buf);
// zeroFirst(buf);
// assignToRefDemo(10);
// useAfterMoveDemo();
// zeroCopyDemo();
// borrowMismatchDemo();
// tempRefDemo();
// danglingDemo();
// constSuggestionDemo();

// Accepts a read-only view of the buffer.
// C++: void printFirst(const std::vector<int>& buf)
function printFirst(buf: Ref): void {
  console.log(buf[0]);
}

// Accepts a mutable reference — can write back.
// C++: void clear(std::vector<int>& buf)
function clear(buf: MutRef): void {
  buf[0] = 0;
}

// Demonstrates safe borrow — no copy, no UB.
function demo(): void {
  const data: Owned = [10, 20, 30];  // data owns the array

  const view: Ref  = data;  // zero-copy const reference
  printFirst(view);          // OK

  clear(data);               // OK: data is still Owned in this scope
  printFirst(data);          // OK: data is still alive

  const moved = data;     // ownership transfer
  printFirst(data);       // If 'data' had been moved, this would be
  //                         // caught as ownership-use-after-move here.
}
demo();