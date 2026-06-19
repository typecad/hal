# Class usage stress test — findings (cuttlefish, Arduino AVR)

A maximal class-feature showcase (no end-state goal) hammered the
class/inheritance/namespace surface (SUPPORT_MATRIX §4) to surface transpiler
errors. The source is `demo/src/main.ts`. It covers: inheritance + `super(args)`
+ `super.method()`, static fields/methods/getters, instance getters/setters,
generics, nested classes, abstract classes, virtual dispatch through a base
pointer, namespaces (incl. nested classes + functions + exported `let`),
ownership wrappers, and a polymorphic pointer array.

After working around the findings below, the showcase **compiles clean**
(Flash 17%) and the polymorphic `Shape[]` array dispatches virtual calls
correctly through base pointers — so the broad class surface is solid. The
errors cluster in **one family: namespace-scoped constructs**.

---

## Finding 1 — `super.method()` emits `TS2CPP_UNSUPPORTED_EXPR` (known, §4.4 🟡)

```
src\main.ts(71,23) error [TS2CPP_UNSUPPORTED_EXPR]: super keyword outside of
class method
        sum = sum + super.reading();
```

An override calling `super.reading()` aborts. `super(args)` (ctor) works (→
`: Base(...)` initializer list); only `super.method()` is broken. Root cause:
`expression-to-ir.ts:2164-2169` lowers `super` to the base name only when
`getActiveExtendsClass()` is set, which is null at the override call site.
Already documented 🟡 in SUPPORT_MATRIX §4.4 and as demo #36 Finding A.
**Workaround:** call an inherited non-overridden base method via `this.x()`.

## Finding 2 — a `static` field on a class NESTED IN A NAMESPACE loses its `static` qualifier

```ts
namespace Devices {
  export class Registry {
    static count: int32_t = 0;          // static in source
    static register(): int32_t { return Registry.count; }
  }
}
```
emits
```cpp
namespace Devices {
  class Registry {
  public:
    int32_t count = 0;                  // ← static DROPPED (instance field)
    static int32_t register_() { return Registry::count; }   // ← static access on a non-static field
  };
}
```
→ avr-g++: `expected unqualified-id before '.' token` (and the `Registry::count`
access from a static method on a non-static member is invalid).

**Contrast that pinpoints the bug:** the SAME `static` field on a TOP-LEVEL
class emits correctly — `Counter.instances`/`Counter.ORIGIN` (both
`static instances/ORIGIN: int32_t = 0`) emit as `static inline int32_t`. So
the bug is specific to **static fields on classes nested inside a namespace**:
the `static` qualifier is dropped during emission.

**Root cause (likely):** the namespace-nested-class emission path
(`namespace-builder.ts` → `declaration-builders.ts`) doesn't carry the `static`
flag through to the field renderer the way the top-level class path does.

**Workaround:** move the shared mutable state to a namespace-level `export let`
and reference it as `Devices.x` (which itself hits Finding 3).

## Finding 3 — namespace member access is inconsistently `.` vs `::`

```ts
namespace Devices {
  export let registryCount: int32_t = 0;
  export class Registry {
    static register(): int32_t {
      Devices.registryCount = Devices.registryCount + 1;   // all `Devices.x`
      ...
    }
  }
}
```
emits
```cpp
Devices.registryCount = Devices::registryCount + 1;        // MIXED . and ::
```
→ avr-g++: `expected primary-expression before '.' token` at the `.` sites.
A namespace member access must use `::` (scope resolution); `.` (member
access) is invalid because `Devices` is a namespace, not an object.

**Root cause:** the namespace-member-access lowering (`.` on a namespace
identifier) is **inconsistent** — some use sites emit `Devices::x` (correct),
others `Devices.x` (wrong). This is the same defect family as the earlier
`makeLabel` cascade: a namespace-scope member rendered with `.` produces
malformed C++ that avr-g++ reports as a parse error, which then cascades into
misattributed errors on nearby lines.

## Finding 3b (cascade symptom) — namespace-scope `const string` in a concat formats as `%d`

```
// namespace Devices { export const DEFAULT_LABEL: string = "dev";
//   export function makeLabel(id) { return DEFAULT_LABEL + ":" + id; } }
snprintf(..., "%d:%d", DEFAULT_LABEL, id);   // DEFAULT_LABEL is __tc_str_ptr, formatted %d
```

A namespace-scope `const string` used in a string concat is mis-classified as
`%d` by the snprintf operand resolver (it isn't in the operand-type map, so it
defaults to integer). This is a **symptom of Finding 3's family** — the
namespace-scoped binding isn't fully visible to the type-resolution paths that
the snprintf operand picker consults, so it falls through to the `%d` default.
A local `let s: string` in the same function resolves correctly (`%s` +
`.c_str()`).

---

# Categorization — one family: namespace-scoped construct resolution

Findings 2, 3, and 3b are **one family**: the transpiler's handling of
constructs *nested inside a namespace* is incomplete relative to top-level
constructs. Specifically:

- **Finding 2** — a static field on a namespace-nested class loses `static`
  (the namespace-class emission path drops a flag the top-level path keeps).
- **Finding 3** — namespace member access emits `.` instead of `::`
  inconsistently (the namespace-member-access lowering isn't uniform).
- **Finding 3b** — a namespace-scope `const` isn't visible to the snprintf
  operand-type resolver (the namespace binding isn't registered in the type
  maps the resolver consults).

The common thread: **namespace-scoped declarations (classes, fields, consts,
mutables) are not fully equivalent to their top-level counterparts across the
emit and type-resolution passes.** A namespace is parsed and a C++
`namespace X { ... }` is emitted, but the *downstream consumers* (the static-
field flag, the member-access `.`/`::` decision, the snprintf type map) don't
treat namespace members with the same fidelity as top-level members.

**The single large fix:** audit the namespace-member path so that every
downstream pass treats a namespace-scoped declaration identically to a
top-level one:
1. Carry the `static` flag through the namespace-nested-class field emitter
   (Finding 2).
2. Make namespace member access uniformly emit `::` (Finding 3) — the
   decision already exists for some sites; route all namespace-identifier
   member access through it.
3. Register namespace-scope `const`/`let` bindings in the snprintf operand
   type map (Finding 3b), the same way top-level consts are registered.

Finding 1 (`super.method()`) is a **separate family** (the class-method
context, unrelated to namespaces) already tracked in §4.4.

---

## What the stress test confirmed WORKS (notable successes)

Once the four findings above are worked around, the rest of the class surface
compiles and (per the emitted C++) is correct — including several constructs
that were reasonable to worry about:

- **Virtual dispatch through a polymorphic pointer array:** `const shapes:
  Shape[] = []; shapes.push(sq); shapes.push(new Rect(3,4)); shapes[i].area()`
  lowers to `__tc_StaticArray<Shape*, 2>` with `push_back` and `->area()`
  dispatching through the base pointer. Works on AVR (the function-local array
  lowers to `StaticArray`, the AVR-supported path — `TS2CPP_NO_VECTOR_STORAGE`
  does NOT trip).
- **`super(args)` ctor call:** `super(pin)` → `: Sensor(pin)` initializer list.
- **Generics:** `class Box<T>` → `template<typename T> class Box`; `new
  Box<int32_t>(42)` instantiates correctly.
- **Abstract class + pure virtual:** `abstract area()` → `virtual int32_t
  area() = 0`; concrete subclasses override.
- **Instance getters/setters + static getter:** `get value()`/`set value()`
  → `getValue()`/`setValue()`; `static get hasInstances()` →
  `static getHasInstances()`.
- **Ownership wrappers:** `owned: Owned<int32_t>` erases to a plain `int32_t`
  field.
- **Top-level-class static fields:** `static instances`/`static readonly
  ORIGIN` → `static inline int32_t` (correct — contrast with Finding 2).
- **Nested class referencing another class:** `Inner.sum(o: Outer)` →
  `Outer*` param, `o->outerVal` access.
- **Heap instantiation of every class** (`new Box`, `new Square`, `new Rect`,
  `new Counter`, `new Outer`, `new Inner`): each emits one
  `heap-allocation-avr` **warning** (the downgraded gate) and compiles —
  exactly the intended behavior.

So the class/inheritance feature set is broadly sound; the gap is concentrated
in namespace-scoped declarations (one fix family) plus the pre-known
`super.method()` gap.
