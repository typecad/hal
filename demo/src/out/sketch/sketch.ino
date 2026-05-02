#include <Arduino.h>

void assignToRefDemo(const int x);
void updateRefDemo(const int x);
void useAfterMoveDemo();
void needsMut(uint8_t* buf);
void borrowMismatchDemo();
void danglingBorrowDemo();
uint8_t* returnLocalRefDemo();
void tempRefWarnDemo();
void suggestConstDemo();
void ownedCopyDemo();
void implicitCopyDemo();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
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
}

// ==========================================================================
// ERROR 1: ownership-assign-to-ref
// Assigning to a Ref (immutable borrow) is forbidden — would break read-only
// contract that C++ emits as 'const'.
// ==========================================================================
void assignToRefDemo(const int x)
{
  x = 99;
  // ERROR: Cannot assign to 'x' — it is an immutable borrow.
}

void updateRefDemo(const int x)
{
  x++;
  // ERROR: Cannot update 'x' — it is an immutable borrow.
}

// ==========================================================================
// ERROR 2: ownership-use-after-move
// After an Owned variable is moved (assigned to another variable), the source
// is invalidated. Any subsequent read triggers use-after-move.
// ==========================================================================
void useAfterMoveDemo()
{
  uint8_t a[] = { 1, 2, 3 };
  const uint8_t* b = a;
  // ownership transfer — 'a' is now invalid
  const uint8_t* c = a;
  // ERROR: 'a' was moved and cannot be used again.
}

// ==========================================================================
// ERROR 3: ownership-borrow-mismatch
// A Ref (immutable) variable cannot be passed where a MutRef (mutable borrow)
// is expected — would allow writes through a read-only reference.
// ==========================================================================
void needsMut(uint8_t* buf)
{
  buf[0] = 255;
}

void borrowMismatchDemo()
{
  uint8_t src[] = { 1, 2, 3 };
  const uint8_t* view = src;
  // immutable borrow
  needsMut(view);
  // ERROR: Cannot pass 'view' (immutable Ref) where MutRef expected.
}

// ==========================================================================
// ERROR 4: ownership-dangling-borrow
// A Ref/MutRef in an outer scope that borrows from an Owned variable in a
// child scope — the source is destroyed when the child scope exits.
// ==========================================================================
void danglingBorrowDemo()
{
  uint8_t outer[] = { 9, 9, 9 };
  uint8_t* saved = outer;
  {
    uint8_t local[] = { 1, 2, 3 };
    saved = local;
    // ERROR: 'saved' borrows 'local' which goes out of scope — dangling reference.
  }
  Serial.println(saved[0]);
  // UB: 'local' has been destroyed
}

// ==========================================================================
// ERROR 5: ownership-return-local-ref
// Returning a Ref/MutRef that borrows from a stack-local Owned variable.
// The owned variable is destroyed when the function returns → dangling reference.
// ==========================================================================
uint8_t* returnLocalRefDemo()
{
  uint8_t local[] = { 4, 5, 6 };
  const uint8_t* view = local;
  return view;
  // ERROR: Returning 'view' borrows 'local' which will be destroyed.
}

// ==========================================================================
// WARNING 6: ownership-temp-ref-warn
// Ref/MutRef initialised from a non-identifier expression (literal, new, etc.).
// C++ cannot bind a const& to an rvalue — emitter falls back to a copy->
// ==========================================================================
void tempRefWarnDemo()
{
  uint8_t view[] = { 1, 2, 3 };
  // WARNING: borrows temporary
  Serial.println(view[0]);
}

// ==========================================================================
// WARNING 7: ownership-suggest-const
// A 'let' variable that is never reassigned. Runs regardless of ownership types.
// ==========================================================================
void suggestConstDemo()
{
  int threshold = 42;
  // WARNING: 'threshold' is never reassigned. Use const.
  Serial.println(threshold);
}

// ==========================================================================
// INFO 8: ownership-owned-copy
// Moving a non-primitive Owned variable into an unannotated variable creates
// a C++ copy — ownership types do not emit std::move().
// ==========================================================================
void ownedCopyDemo()
{
  uint8_t src[] = { 1, 2, 3 };
  const uint8_t* copy = src;
  // INFO: Moving 'src' into 'copy' creates a C++ copy->
}

// ==========================================================================
// INFO 9: ownership-implicit-copy
// Copying a non-primitive non-Owned variable into an unannotated variable
// silently copies — no borrow annotation exists to indicate reference semantics.
// ==========================================================================
void implicitCopyDemo()
{
  uint8_t src[] = { 1, 2, 3 };
  // (also triggers temp-ref-warn)
  const uint8_t* dup = src;
  // INFO: 'dup' silently copies 'src' — no borrow annotation.
  Serial.println(dup[0]);
}

void loop()
{
}
