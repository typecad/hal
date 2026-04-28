# Ownership & Borrowing Safety

TypeHAL provides opt-in, Rust-inspired ownership types that enforce memory safety rules at **transpile time** with **zero runtime cost**. The types are phantom types — they erase to plain C++ types during emission — so there is no code-size or performance penalty on the target device.

---

## Why This Matters for Embedded C++

Embedded C++ has no garbage collector and no bounds-checked containers. The most common crash causes are:

| Bug | What happens on a microcontroller |
|-----|----------------------------------|
| **Dangling pointer / reference** | Program accesses freed or out-of-scope stack memory. Reads return garbage; writes corrupt adjacent data or the return address. |
| **Use-after-free** | Same as dangling pointer when the object was heap-allocated. On a device with no heap this usually manifests as use-after-scope. |
| **Double-free** | Destructor called twice; in practice this corrupts the allocator's linked list and causes silent memory corruption. |
| **Segmentation fault** | Hardware fault triggered by an invalid memory access. On bare-metal AVR devices there is no MMU — the program simply reads/writes a random address and continues, producing unpredictable behaviour. |

TypeHAL's ownership system addresses **dangling references** and **use-after-scope** — the two most common of the above in typical embedded C++ code — entirely at transpile time, before any C++ compiler is ever invoked.

---

## Overview

Three phantom type annotations are available. Use them bare (no `<T>`) or with an explicit type parameter — both are valid:

```typescript
type Owned<T = any> = T;
type Ref<T = any>   = T;
type MutRef<T = any> = T;
```

| Annotation | Meaning | C++ emission (non-primitive) | C++ emission (primitive) |
|------------|---------|------------------------------|--------------------------|
| `Owned` | Exclusive owner. Assignment transfers ownership — source becomes invalid. | `T` | `T` |
| `Ref` | Immutable borrow. Read-only. Multiple simultaneous `Ref` borrows are allowed. | `const T&` | `const T` |
| `MutRef` | Mutable borrow. Read-write. Only one active mutable borrow allowed at a time. | `T&` | `T` |

> **Primitives** (`int`, `bool`, `float`, `uint8_t`, …) are always passed by value even with `Ref` — a `const int&` reference to a 4-byte value would be slower than passing by value, so the transpiler does the right thing automatically.

## When to Use Each One

### Use `Owned` when:

- the variable is the **main owner** of the data
- you create a buffer, object, or array that should live in the current scope
- you want moves and accidental reuse to be caught
- the value may later be lent out as `Ref` or `MutRef`

```typescript
const readings: Owned = [10, 20, 30];
```

**Rule of thumb:** if this is the “real” storage location, use `Owned`.

### Use `Ref` when:

- you want to **read** data without copying it
- a function should promise **not to mutate** the caller’s value
- you want `const T&` semantics in emitted C++ for non-primitives
- you want to avoid accidental deep copies of vectors, strings, or structs

```typescript
function printFirst(buf: Ref): void {
  console.log(buf[0]);
}
```

**Rule of thumb:** if you only need to look at the data, use `Ref`.

### Use `MutRef` when:

- a function must **modify** the caller’s data in place
- you want explicit write access without transferring ownership
- you want the caller to keep ownership while still allowing mutation

```typescript
function clear(buf: MutRef): void {
  buf[0] = 0;
}
```

**Rule of thumb:** if you need to change the caller’s data but not take it over, use `MutRef`.

### Quick decision guide

| If you want to... | Use |
|-------------------|-----|
| create and keep the value | `Owned` |
| read without copying | `Ref` |
| mutate without taking ownership | `MutRef` |
| transfer the value to a new owner | `Owned` |

---

## Opt-In Design

If you do not use `Owned`, `Ref`, or `MutRef` anywhere in a file, **no ownership diagnostics are generated**. Your existing code transpiles exactly as before. The system only activates when at least one ownership annotation appears in the file.

---

## The Nine Validation Rules

### Rule 1 — `ownership-assign-to-ref` (error)

**What it catches:** Mutation through an immutable borrow.

**Why it matters:** In C++, writing to a `const` reference is undefined behaviour. More commonly the intent is to mutate the actual object, but the programmer forgot they passed it as a const reference. The diagnostic tells you exactly what to change.

```typescript
function clamp(value: Ref): void {
  if (value > 100) {
    value = 100;  // error [ownership-assign-to-ref]
    //   ↳  change 'value: Ref' → 'value: MutRef'
  }
}
```

**Fix:** Change the parameter annotation from `Ref` to `MutRef`, which emits a mutable C++ reference `int&` and allows the assignment.

**C++ prevented:**
```cpp
// Emitted without TypeHAL safety — reads just fine, writes are UB:
void clamp(const int value) { value = 100; }  // C++ compile error caught by TypeHAL first
```

---

### Rule 2 — `ownership-use-after-move` (error)

**What it catches:** Reading or passing a variable after its ownership was transferred.

**Why it matters:** Rust has this rule natively. In C++ there is no equivalent compile-time check — using a moved-from object (`std::move`) is legal code that silently reads an indeterminate value. The transpiler catches the pattern before emission.

```typescript
function fill(buf: MutRef): void { buf[0] = 0; }

function example(): void {
  let sensor: Owned = [0, 0, 0];
  fill(sensor);           // ownership moves into fill
  fill(sensor);           // error [ownership-use-after-move]: 'sensor' was moved
  //   ↳  const sensor_ref: Ref = sensor;  // add this before the move
}
```

**Fix:** If you intended to lend the value rather than move it, annotate the destination as `Ref` or `MutRef`. If a true transfer was intended, remove the second use.

---

### Rule 3 — `ownership-borrow-mismatch` (error)

**What it catches:** Passing an immutable borrow (`Ref`) to a function that requires a mutable borrow (`MutRef`).

**Why it matters:** A function that declares `buf: MutRef` intends to write through the reference. Silently accepting an immutable `const&` borrow and writing to it would violate the const contract — either a C++ compile error or, in unsafe casts, undefined behaviour.

```typescript
function zero(buf: MutRef): void { buf[0] = 0; }

function example(): void {
  const data: Ref = readings;
  zero(data);  // error [ownership-borrow-mismatch]
  //   ↳  change 'data: Ref = ...' → 'data: MutRef = ...'
}
```

**Fix:** If `data` should be mutable, change its annotation to `MutRef`. If `zero` should accept read-only data, change its parameter to `Ref`.

---

### Rule 4 — `ownership-temp-ref-warn` (warning)

**What it catches:** A `Ref` or `MutRef` variable initialised from a literal or temporary expression.

**Why it matters:** In C++, binding a `const T&` to an rvalue (e.g. `const std::vector<int>& v = {1,2,3}`) extends the temporary's lifetime in some contexts, but once the reference is passed to another function or stored, the lifetime guarantee disappears and the reference becomes dangling. The transpiler warns and falls back to a copy.

```typescript
function snapshot(): void {
  const view: Ref = [10, 20, 30];  // warning [ownership-temp-ref-warn]
  //   ↳  const _tmp: Owned = ...;
  //      const view: Ref   = _tmp;
  process(view);
}
```

**Fix:** Store the data in an `Owned` variable first, then borrow from that:

```typescript
function snapshot(): void {
  const tmp: Owned = [10, 20, 30];
  const view: Ref  = tmp;   // safe: borrows a named variable
  process(view);
}
```

---

### Rule 5 — `ownership-owned-copy` (info)

**What it catches:** Assigning an `Owned` non-primitive to an unannotated or `Owned` destination without using a borrow — causes a C++ deep copy.

**Why it matters:** On a microcontroller with limited RAM, an accidental `std::vector` copy in a tight loop wastes both time and memory. Ownership types let you express intent and make copies visible.

```typescript
function process(): void {
  const source: Owned = [1, 2, 3];
  const snapshot = source;  // info [ownership-owned-copy]: creates a C++ copy
  //   ↳  const snapshot: Ref = source;  // borrow by reference, zero copy
}
```

**Fix:** If a copy was intended, leave it as-is. If you only need to read the data, use `Ref` instead.

---

### Rule 6 — `ownership-implicit-copy` (info)

**What it catches:** Assigning from an existing borrow to an unannotated variable — another silent C++ copy.

**Why it matters:** Similar to Rule 5, but the source is already a borrowed reference. Re-copying a reference is almost always unintentional.

```typescript
function example(readings: Ref): void {
  const local = readings;  // info [ownership-implicit-copy]: silent copy
  //   ↳  const local: Ref = readings;  // borrow by const reference, zero copy
}
```

---

### Rule 7 — `ownership-suggest-const` (warning)

**What it catches:** A `let` variable that is declared but never reassigned.

**Why it matters:** Using `const` instead of `let` communicates intent and allows the C++ compiler to apply additional optimisations. Annotating with `Ref` goes further: it also enforces `const T&` at the C++ level.

```typescript
function init(): void {
  let threshold = 512;   // warning [ownership-suggest-const]
  //   ↳  const threshold = ...;
  if (readADC() > threshold) { /* … */ }
}
```

---

### Rule 8 — `ownership-dangling-borrow` (error) ★ new

**What it catches:** A borrow (`Ref` or `MutRef`) that outlives the `Owned` variable it was created from.

**Why it matters:** This is the most insidious class of bug in embedded C++. The stack frame is reused — so a dangling reference silently reads the next function's local variables or the interrupt stack. The data looks plausible, the code "runs", and the bug only manifests under specific call sequences. Traditional C++ compilers do not catch this; Rust's borrow checker does; TypeHAL now catches it too.

```typescript
function readSensor(): void {
  let saved: MutRef = baseline;   // initially safe
  {
    const reading: Owned = acquireSample();   // lives only in this block
    saved = reading;              // error [ownership-dangling-borrow]:
    //   'saved' borrows 'reading' which goes out of scope here
    //   ↳  move 'reading' to the outer scope, or ensure 'saved' does not outlive it
  }
  // 'reading' is destroyed here — 'saved' is now a dangling C++ reference
  transmit(saved);  // would read garbage / corrupt memory
}
```

**Fix:** Move the owned variable to the outer scope so its lifetime encompasses all uses of the borrow:

```typescript
function readSensor(): void {
  const reading: Owned = acquireSample();   // lives for the whole function
  let saved: MutRef    = reading;           // safe: both in the same scope
  transmit(saved);
}
```

**C++ analogy:**
```cpp
int* dangling() {
  int x = 42;
  return &x;  // x is destroyed on return — classic stack-use-after-return
}
```

---

### Rule 9 — `ownership-return-local-ref` (error) ★ new

**What it catches:** Returning a `Ref` or `MutRef` whose underlying data is a local `Owned` variable in the same function.

**Why it matters:** Returning a reference to a local variable is classic undefined behaviour — it is so common that modern C++ compilers warn about it, but only for simple cases. When the reference is stored via a `Ref` intermediate variable the warning is often silenced. TypeHAL traces the borrow chain and catches it regardless.

```typescript
function getBuffer(): Ref {
  const local: Owned = [1, 2, 3];
  const view: Ref    = local;
  return view;   // error [ownership-return-local-ref]:
  // Returning 'view' borrows 'local' which will be destroyed when this
  // function returns — dangling reference.
  //   ↳  return local directly as Owned, or change the function to accept
  //        'local: Ref' as a parameter
}
```

**Fix — option A:** Return the owned value directly (caller gets a copy):

```typescript
function getBuffer(): number[] {
  const local: Owned = [1, 2, 3];
  return local;   // OK: value is copied to the caller's stack frame
}
```

**Fix — option B:** Accept the storage as a parameter so the caller controls the lifetime:

```typescript
function fillBuffer(buf: MutRef): void {
  buf[0] = 1; buf[1] = 2; buf[2] = 3;
}
// Caller owns the buffer — lifetime is unambiguous
const storage: Owned = [0, 0, 0];
fillBuffer(storage);
```

**C++ analogy:**
```cpp
const int* getPtr() {
  int local = 42;
  return &local;  // UB: local is destroyed on return
}
```

---

## End-to-End C++ Emission Examples

The table below shows what TypeHAL emits for each combination:

| TypeScript declaration | Initialised from | Emitted C++ |
|------------------------|-----------------|-------------|
| `const v: Ref = arr` | named `Owned` variable | `const std::vector<int>& v = arr;` |
| `const v: Ref = [1,2]` | literal (temp) | `const std::vector<int> v = {1, 2};` *(copy, with warning)* |
| `let v: MutRef = arr` | named `Owned` variable | `std::vector<int>& v = arr;` |
| `function f(x: Ref<number[]>)` | — | `void f(const std::vector<int>& x)` |
| `function f(x: MutRef<number[]>)` | — | `void f(std::vector<int>& x)` |
| `function f(x: Ref<number>)` | — | `void f(const int x)` *(primitive — by value)* |

---

## Full Working Example

```typescript
type Owned<T = any> = T;
type Ref<T = any>   = T;
type MutRef<T = any> = T;

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

  // const moved = data;     // ownership transfer
  // printFirst(data);       // If 'data' had been moved, this would be
  //                         // caught as ownership-use-after-move here.
}
```

---

## Architecture

| Layer | File | Role |
|-------|------|------|
| Phantom types | `packages/core/src/types/ownership.ts` | `Owned`, `Ref`, `MutRef` type aliases |
| IR metadata | `packages/core/src/shared/ir.ts` | `ownershipKind` field on `ParameterIR` / `VariableDeclarationIR` |
| Type resolution | `packages/cli/src/ir/type-resolution.ts` | Strips wrapper, extracts inner C++ type and ownership kind |
| IR builder | `packages/cli/src/ir/build-ir.ts` | Propagates ownership metadata into the IR |
| Validation pass | `packages/cli/src/ir/ownership-analysis.ts` | Enforces all nine rules using `OwnershipScope` ancestry tracking |
| Validation orchestrator | `packages/cli/src/ir/validation-orchestrator.ts` | Calls `validateOwnership` as part of the full program validation pipeline |
| Emitter | `packages/cli/src/emit/statement-renderer.ts` | Emits `const T&` / `T&` for non-primitive borrows; `const T` for primitive borrows |
| CLI output | `packages/cli/src/cli.ts` | Renders diagnostics with chalk: severity colour + `↳` hint lines |

---

## Limitations

- Ownership tracking is **intra-procedural**. The analyser validates within each function body but does not track ownership across opaque function call boundaries (e.g., it does not know that a called function stores a borrow past its return).
- **Class fields** that hold borrows are not yet analysed — only local variables and parameters.
- The detection of moved values via `std::move()` in raw C++ emit nodes is heuristic (text-match based).
- Designed for stack-allocated and static embedded patterns. Heap allocation (`new` / `delete`) is not emitted by TypeHAL, so heap-use-after-free is not in scope.
