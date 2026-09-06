# Single Ownership: `Owned<T>`

The `Owned` type is the foundation of TypeCAD's resource management system. It indicates that a specific variable or parameter has exclusive responsibility for a piece of data.

### Why Use `Owned`?
In standard JavaScript, objects are shared automatically via references. In embedded C++, this can lead to "Double-Free" errors or data corruption if two parts of the code try to modify the same memory at once. `Owned` enforces a strict **Single-Owner** policy.

---

## Move Semantics
When you assign an `Owned` variable to another variable or pass it to a function, ownership is **moved**. The original variable is invalidated.

### Example: Ownership Transfer
```typescript
// Owned<T> / Shared<T> / Mutable<T> are ambient global types — no import needed.
import { UART0 } from '@typecad/board';

const buffer: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);

// Ownership is transferred to 'movedBuffer'
const movedBuffer = buffer; 

// ERROR: 'buffer' was moved and cannot be used again. [ownership-use-after-move]
UART0.writeLine(buffer[0]); 
```

### Error: `ownership-use-after-move`
This error occurs when you attempt to read from or write to a variable that has already transferred its ownership.

**How to fix:**
- If you still need the data in the original variable, create a `Shared` (borrow) before moving.
- If you truly need two copies, perform an explicit copy (e.g., `new Uint8Array(original)`).

---

## C++ Copy Warnings
Because TypeCAD targets resource-constrained hardware, it does not use complex C++ move constructors or `std::move`.

### Info: `ownership-owned-copy`
When you move a non-primitive `Owned` variable into an unannotated variable, the transpiler warns you that a **C++ copy** is being created.

```typescript
const src: Owned<Uint8Array> = new Uint8Array([1, 2, 3]);
const copy = src; // INFO: Moving 'src' into 'copy' creates a C++ copy.
```

**How to fix:**
If you intended to share the data without copying, use a `Shared`:
```typescript
const view: Shared = src; // Zero-copy borrow
```

---

## API Summary
| Feature | Description |
| :--- | :--- |
| **Move on Assignment** | Assigning `a = b` where `b` is `Owned` invalidates `b`. |
| **Move on Call** | Passing an `Owned` variable as a parameter transfers ownership to the function. |
| **Return Ownership** | Functions can return `Owned<T>` to transfer ownership back to the caller. |

---

## Best Practices
1. **Pass by Owned** only when the function needs to store the data long-term or destroy it.
2. **Pass by Shared** for temporary reading (most common).
3. **Pass by Mutable** for temporary in-place modification.
