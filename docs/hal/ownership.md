# Resource Ownership

TypeCAD includes a set of optional features designed to bring memory and hardware safety to embedded TypeScript. These features are inspired by modern systems languages like Rust but are adapted to feel natural and intuitive in a TypeScript environment.

The ownership system is entirely **opt-in**: if you do not use these specific types or methods, TypeCAD behaves like standard TypeScript.

---

## Hardware Ownership (`take` & `release`)

In embedded systems, multiple tasks (such as a sensor reader and a display driver) often share the same hardware bus (e.g., `I2C0`). This can lead to race conditions where one task interrupts another's communication, causing bus collisions or corrupted data.

### The Problem
```typescript
import { I2CTarget } from '@typecad/hal';

// Task A: reading a sensor
new I2CTarget('I2C0', 0x76).readReg(0x00);

// Task B: updating a display (could interrupt Task A mid-transaction)
new I2CTarget('I2C0', 0x3C).writeReg(0x00, 0x55);
```

### The Solution: Exclusive Claims
TypeCAD provides an exclusive acquisition pattern. When you `take()` a bus, you receive a handle that uniquely owns that resource.

```typescript
import { I2CTarget } from '@typecad/hal';
import { I2C0 } from '@typecad/board';

// Claim exclusive access (a compile-time marker — no runtime call is emitted)
I2C0.take();

const sensor = new I2CTarget('I2C0', 0x76);
sensor.readReg(0x00);

// Return the bus to the shared pool when finished
I2C0.release();
```

**Implementation Details:**
- `take()`/`release()` are **compile-time ownership markers** — nothing is emitted into the C++; the ownership pass validates the discipline instead:
  - I/O on an owned bus only occurs between `take()` and `release()`.
  - No double-`take()` on an already-owned bus; no `release()` without a `take()`.
  - A bus taken but never released is reported at the end of the program.
- The system is **opt-in**: if `take()` never appears, no diagnostics are generated.
- For true concurrent bus sharing across [Threads](./thin-hal.md), the ownership discipline documents the protocol; the underlying Zephyr driver calls serialize at the controller.

---

## Memory Safety Types (Phantom Types)

TypeCAD uses **Phantom Types** to track how data flows through your program. These types guide the transpiler's static analyzer to prevent common embedded programming errors—like use-after-move or dangling pointers—while having **zero runtime overhead**.

Select a type below for detailed documentation and examples:

### Getting Started
1.  **[When and How to use Ownership](../ownership/what-to-use.md)**: A practical guide to choosing the right type for your data lifecycle.
2.  **[Single Ownership (`Owned<T>`)](../ownership/owned.md)**: Deep dive into move semantics.
3.  **[Immutable Borrowing (`Shared<T>`)](../ownership/shared.md)**: Deep dive into zero-copy references.
4.  **[Mutable Borrowing (`Mutable<T>`)](../ownership/mut.md)**: Deep dive into in-place mutation.

### 1. [Single Ownership (`Owned<T>`)](../ownership/owned.md)
The foundation of TypeCAD's resource management. Ensures that every piece of data has exactly one owner at a time.
*   **Key Concept**: [Move Semantics](../ownership/owned.md#move-semantics)
*   **Prevents**: Use-after-move, Double-free errors.

### 2. [Immutable Borrowing (`Shared<T>`)](../ownership/shared.md)
The most common way to share data. Provides zero-copy access to data for reading.
*   **Key Concept**: [Zero-Copy Efficiency](../ownership/shared.md#key-benefits)
*   **Prevents**: Accidental mutation, memory bloat from copies.

### 3. [Mutable Borrowing (`Mutable<T>`)](../ownership/mut.md)
Allows sharing data for the purpose of in-place modification.
*   **Key Concept**: [In-Place Mutation](../ownership/mut.md#key-benefits)
*   **Prevents**: Borrow mismatches, race conditions.

---

## Comparison Table

| Type | Permission | C++ Emission | Best For... |
| :--- | :--- | :--- | :--- |
| `Owned<T>` | Read/Write/Move | `T` | Data you created and manage. |
| `Shared<T>` | Read-Only | `const T&` | Shared settings, read-only buffers. |
| `Mutable<T>` | Read/Write | `T&` | Buffers that need in-place updates. |

---

## Why Use These Types?

If you are a developer coming from high-level languages like JavaScript, you might be used to objects being shared automatically. In the embedded world, this "hidden sharing" often leads to:
1.  **Race Conditions**: Two tasks changing the same variable at once.
2.  **Memory Corruption**: A function modifying a buffer that another function thought was constant.
3.  **Dangling Pointers**: Using a piece of memory after it has been deleted or repurposed.

By using `Owned`, `Shared`, and `Mut`, you turn these dangerous runtime crashes into simple **red squiggles** in your editor.

---

## Zero-Cost Abstractions

A core principle of TypeCAD is that safety should not come at the cost of performance. Because these rules are enforced at the **transpiler level**, the generated C++ is identical to hand-written code:

- `Owned<number>` emits as `int`.
- `Shared<number>` emits as `const int`.
- `take()` and `release()` emit nothing at all — they are compile-time markers.

---

## API & Type Reference

### Bus Ownership Handle
| Method | Description |
| :--- | :--- |
| `bus.take()` | Marks exclusive ownership (compile-time marker — no runtime call). A second `take()` on an owned bus is a build error. |
| `bus.release()` | Returns ownership of the bus to the system. |

### Ownership Phantom Types
| Type | C++ Emission | Rule Enforced |
| :--- | :--- | :--- |
| `Owned<T>` | `T` | Prevents use-after-move (Transfer of ownership). |
| `Shared<T>` | `const T` | Prevents reassignment and modification (Immutability). |
| `Mutable<T>` | `T` | Explicitly marks a mutable reference for clarity. |

---

## Complex Example: Safety Across Functions

```typescript
// Owned<T> / Shared<T> / Mutable<T> are ambient global types — no import needed.

/** Reads data without taking ownership (Borrowing) */
function analyze(data: Shared<Uint8Array>) {
  const first = data[0];
  UART0.writeLine(`Analyzing: ${first}`);
}

/** Processes data and takes full ownership (Moving) */
function archive(data: Owned<Uint8Array>) {
  // Logic to move data to long-term storage...
}

function run() {
  const myData: Owned<Uint8Array> = new Uint8Array([0x01, 0x02]);

  analyze(myData); // OK: Borrowing allowed while owned
  
  archive(myData); // OK: Ownership transferred (MOVE)
  
  // analyze(myData); // Error: Cannot borrow 'myData' after ownership was moved
}
```
