# Mutable Borrowing: `Mut<T>`

The `Mut` type allows you to borrow data for the purpose of modifying it in-place. It combines the zero-copy efficiency of a reference with the ability to write to the underlying data.

### Key Benefits
1. **In-Place Mutation**: Allows functions to update arrays or objects without returning a new copy.
2. **Explicit Intent**: By using `Mut`, you document that a function *will* change the data passed to it, making data flow easier to track.

---

## Safety Enforcements

### Error: `ownership-borrow-mismatch`
You cannot pass an immutable `Shared` to a function that expects a `Mut`. This prevents a "read-only" contract from being violated.

```typescript
function clear(buf: Mut<Uint8Array>) {
  buf.fill(0);
}

const data: Shared<Uint8Array> = ...; // Immutable
clear(data); // ERROR: Cannot pass 'data' (immutable Shared) to 'clear' (Mut).
```

### Warning: Mut Exclusivity
To prevent race conditions and data corruption, TypeCAD's static analyzer warns you if you attempt to create multiple `Mut` borrows of the same source simultaneously.

---

## Lifetime and Scope
Just like `Shared`, a `Mut` is a "borrow" and must not outlive its source.

### Error: `ownership-dangling-borrow`
Occurs if a `Mut` in an outer scope persists after the `Owned` source in an inner scope has been destroyed.

```typescript
let saved: Mut<number>;
{
  let local: Owned<number> = 42;
  saved = local; // ERROR: 'saved' borrows 'local' which goes out of scope.
}
```

---

## API Summary
| Feature | Description |
| :--- | :--- |
| **Read/Write Access** | Allows both reading and modifying the underlying data. |
| **C++ Emission** | Emits `T&` for complex types, ensuring in-place modification. |
| **Zero-Copy** | Shares the existing memory address without duplication. |

---

## When to use `Mut` vs `Owned`
- Use **`Mut`** when you want to modify a buffer that belongs to someone else (the caller).
- Use **`Owned`** when you want to take full responsibility for the data (e.g., storing it in a global class instance or a task queue).
