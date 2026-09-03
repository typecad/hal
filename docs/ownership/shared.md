# Immutable Borrowing: `Shared<T>`

The `Shared` type allows you to share data for reading without transferring ownership. It is the most common way to pass arrays, objects, and strings between functions in TypeCAD.

### Key Benefits
1. **Zero-Copy**: For non-primitive types (arrays/structs), the transpiler emits a **C++ reference** (`const T&`), avoiding expensive memory copies.
2. **Deep Immutability**: Unlike standard TypeScript `const`, `Shared` prevents modifying the *contents* of the data (e.g., array elements).

---

## Safety Enforcements

### Error: `ownership-assign-to-ref`
A `Shared` variable is strictly read-only. You cannot reassign the variable or update its value.

```typescript
function demo(x: Shared<number>) {
  x = 10; // ERROR: Cannot assign to 'x' — it is an immutable borrow.
  x++;    // ERROR: Cannot update 'x' — it is an immutable borrow.
}
```

**How to fix:**
If you need to modify the data, change the annotation to `Mutable`.

---

## Lifetime and Scope
Because a `Shared` is a "borrow," the data it points to must stay alive as long as the `Shared` exists.

### Error: `ownership-dangling-borrow`
Occurs when a `Shared` in an outer scope points to an `Owned` variable in a inner scope that is about to be destroyed.

```typescript
let saved: Shared<Uint8Array>;
{
  const local: Owned<Uint8Array> = new Uint8Array([1]);
  saved = local; // ERROR: 'saved' borrows 'local' which goes out of scope here.
}
// 'saved' is now a dangling pointer in C++
```

### Error: `ownership-return-local-ref`
Occurs when you try to return a `Shared` that points to data created inside the function.

```typescript
function view() {
  const local: Owned<Uint8Array> = new Uint8Array([1]);
  return local; // ERROR: Returning 'local' which will be destroyed.
}
```

---

## Memory Warnings

### Warning: `ownership-temp-ref-warn`
C++ cannot bind a reference to a temporary value (rvalue). If you initialize a `Shared` directly from a literal or a constructor, the emitter will fall back to a copy.

```typescript
const view: Shared = new Uint8Array([1, 2, 3]); 
// WARNING: 'view: Shared' borrows a temporary — emitter will fall back to a copy.
```

**How to fix:**
Declare an `Owned` variable first, then borrow from it:
```typescript
const storage: Owned = new Uint8Array([1, 2, 3]);
const view: Shared = storage; // Safe zero-copy borrow
```

### Info: `ownership-implicit-copy`
If you copy a `Shared` variable into a variable with no annotation, TypeCAD warns you that you are creating a copy of the underlying data rather than a new reference.

```typescript
const src: Shared<Uint8Array> = new Uint8Array(4);
const dup = src; // INFO: 'dup' silently copies 'src' — no borrow annotation.
```

---

## API Summary
| Feature | Description |
| :--- | :--- |
| **Immutability** | Prevents all writes, including element access (e.g., `arr[0] = 1`). |
| **C++ Emission** | Emits `const T&` for complex types, `const T` for primitives. |
| **Zero-Copy** | Guarantees no data is duplicated when passed to functions. |
