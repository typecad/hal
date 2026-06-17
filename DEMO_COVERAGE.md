# Demo Coverage Tracker

This file tracks which `SUPPORT_MATRIX.md` features have been exercised by the
iterative demo builds and which are still awaiting a demo test. Each demo is a
moderately-complex, multi-file game or simulation transpiled to C++ and compiled
with g++.

**Legend**

- ✅ **Tested** — exercised by at least one demo (and, where noted, pinned by a
  regression test). The demo number(s) that exercised it are listed.
- 🟡 **Partial** — exercised but only via a constrained path, or a known
  limitation surfaced. Notes explain.
- ⬜ **Untested** — supported per SUPPORT_MATRIX but no demo has exercised it.
- ❌/🚫 — unsupported; not tracked here (see SUPPORT_MATRIX directly).

**Demo index**

| # | Name | Commit | Notes |
|---|---|---|---|
| #1 | Warehouse / inventory | `618332f` | Inferred (no README); enum→number cast fix (G10) |
| #2 | Particle/Star or Sensor (intermediate) | `1d7266f` / `d0ae0af` | Unnumbered exploratory; drove string-enum + bug-fix batch |
| #3 | Verdant ecosystem | `543a79d` | enum arithmetic (`-`) |
| #4 | Caverns of Cuttlefish (dungeon crawl) | `d494f0c` | Introduced `SUPPORT_MATRIX.md`; F1–F12 fixes |
| #5 | Relay packet-router | `af9c484` | bitwise ops on enum operands; 2 new lint rules |
| #6 | Forge factory/crafting | `c25dd5c` | class inheritance + polymorphism; A–H fixes |
| #7 | Wattage power-grid sim | (uncommitted) | functional array methods, type aliases, Math.PI, optional call, enum casts, for-in/IIFE gates; A–N fixes |
| #8 | Strata config registry | (uncommitted) | generic class heritage, ownership wrappers, spread, satisfies, §5.1 operators, destructure; A fixed, B–I documented |
| #9 | Conduit message pipeline | (uncommitted) | higher-order functions, parseInt/parseFloat, null/undefined, 2D arrays, labeled continue, do...while; A/C fixed, B/D/E/F documented |
| #10 | Ledger numeric utilities | (uncommitted) | array methods (shift/unshift/reverse/fill/concat), utility types, typeof, angle-bracket cast, int→double, nested templates, switch-no-default; A fixed, B/C documented |
| #11 | Atlas spatial region manager | (uncommitted) | namespace (gated), nested switch, infinite for(;;), try/catch/finally + throw, object spread, keyof, unknown; E fixed, C gated, A/B/D documented |
| #12 | Cipher codec toolkit | (uncommitted) | forEach (gap), sort-with-comparator (wrong result), while(true), standalone block, variable-in-case, Float32Array, NonNullable, export default; A–F documented |
| #13 | KitchenSink (ALL remaining ⬜) | (uncommitted) | comprehensive test of ~30 remaining untested features; A–J documented (inline-type auto, static block, ||=, conditional/mapped types, ReturnType, re-exports, Map.get auto, wrapper-on-alias, nested class in fn) |
| #14 | Round-robin task scheduler | (uncommitted) | abstract base + subclass (no explicit ctor), instance/static getters (incl. cross-file), struct-returning `peek(): T \| null`, `Map`+`Set`, `try/catch/throw`, `Array.sort` comparator, `int32_t` template interp; A/B/D/E/G FIXED in transpiler, C lint-gated (`no-map-struct-mutation`), F stale-diag removed |

| #15 | Inventory stock tracker | (uncommitted) | simple idiomatic TS: Map catalog + Map.values() iteration, const Map reads, const Set; A/B/C FIXED in transpiler (Map.values→__tc_mapValues helpers, Map.get→const-correct .at, const-collection mutation demoted + suggest-const contradiction resolved), D documented (const enum lint-gated); new lint rule `no-mutating-method-on-const-collection` |
| #16 | Unit converter | (uncommitted) | simple idiomatic TS: const enum + interface + Map lookup + switch on an enum-valued struct field; A/B FIXED in transpiler (switch on a property-access discriminant now type-aware — no illegal `std::string(enum)` wrap; ownership demotion now scope-local — a read-only `const` Map no longer demoted due to a same-named binding mutated in a sibling function) |
| #17 | Task-list tracker | (uncommitted) | simple idiomatic TS: a `TaskList` class with a `const enum`/`interface` model, `for...of` over a struct array with a mutated loop variable inside a **class method**; A FIXED in transpiler (const for-of loop var mutation + const-collection mutation now demote inside class methods/getters/setters/ctors and namespace functions — the ownership walk previously only reached free functions; `++`/`--` on a const loop-var member also now demotes), new lint rule `no-readonly-loop-variable-mutation` |
| #18 | Bank ledger | (uncommitted) | simple idiomatic TS: a `Bank` class with a `const enum`/`interface Account` model, a nullable `find(): Account \| null` return compared with `=== null`, module-scope free functions called from a class method, and struct-field interpolation in a template literal; **A/B/C all FIXED** in transpiler — (A) `struct === null` now recognizes *interface* value types and resolves to `false` (was the invalid `struct == 0`); (B) a free function called from a class method is forward-declared **non-static in the header** in split mode (was only `static` in the .cpp, unreachable from the inline method body); (C) emitting a named-typed object literal no longer clobbers the interface's declared field-type map, so struct-field template interpolation picks the correct snprintf specifier instead of collapsing every field to `%lld`. Pinned by `tests/packages/transpiler/demo-18-regressions.test.ts` (8 tests); also un-skipped `multi-file.test.ts`'s free-function-forward-decl case. |

A "demo-driven fix" is a transpiler/lint change that a demo's compile failure
directly motivated, pinned by a regression test.

---

## 1. Variables & Types

### 1.1 Variable declarations

| Pattern | Status | Tested by |
|---|---|---|
| `let x = 1` | ✅ | #1, #3, #5, #6 |
| `const x = 1` | ✅ | #1, #3, #5, #6 |
| `var x = 1` | ❌ (gated) | #13 (lint rejects — use `let`/`const`) |
| `let x: number` (no initializer) | ✅ | #10 |
| Multiple decls `let a = 1, b = 2` | ✅ | #1, #6 |
| Declaration with typed initializer | ✅ | #4, #5, #6 |

### 1.2 Primitive type mapping

| Pattern | Status | Tested by |
|---|---|---|
| `number` → `double` | ✅ | all |
| `boolean` → `bool` | ✅ | #3, #4, #6 |
| `string` → `std::string` | ✅ | all |
| `void` → `void` | ✅ | all |
| `int` / `float` / `double` / `long` pass-through | ✅ | #4 |
| `uint8_t` / `int32_t` / `size_t` pass-through | ✅ | #4, #5, #6 |
| `bigint` | ❌ (unsupported) | — |

### 1.3 Numeric inference

| Pattern | Status | Tested by |
|---|---|---|
| Integer literal `42` infers `int` | ✅ | all |
| Float literal `3.14` infers `double` | ✅ | #3 (logistic growth) |
| `int` promoted to `double` (float init) | ✅ | #10 |
| `int` return promoted to `double` (float body) | ✅ | #12 |
| `int` return promoted to `long` (large enum) | ✅ | #4 (enum return widening) |
| Auto `uint8_t` vs `int16_t` selection | ❌ (future) | — |

### 1.4 Strings

| Pattern | Status | Tested by |
|---|---|---|
| `"literal"` | ✅ | all |
| Empty string `""` | ✅ | #6 |
| String + string concat | ✅ | all |
| String + number concat | ✅ | #1, #4, #6 |
| String + boolean concat | ✅ | #1 |
| Template literal `` `x = ${a}` `` | ✅ | #1, #6 |
| Nested template literals | ✅ | #10 |
| Tagged template | ❌ (unsupported) | — |
| `string` → `std::string` everywhere | ✅ | all |

### 1.5 Arrays & collections

| Pattern | Status | Tested by |
|---|---|---|
| `number[]` → `std::vector<double>` | ✅ | #1, #2, #3 |
| `Array<T>` → `std::vector<T>` | ✅ | #3 |
| `ReadonlyArray<T>` | ✅ | #8 |
| `new Uint8Array([...])` / typed arrays | ✅ | #5 |
| `new Float32Array(n)` zero-init | 🟡 | #12 (works inside a function; top-level local gets extern float* vs float[] mismatch — Finding D) |
| Typed-array annotation → pointer | ✅ | #5 |
| `.length` on typed array | ✅ | #5 |
| Array literal `[1, 2, 3]` | ✅ | all |
| Spread in array `[...a, b]` | ✅ | #8 |
| Mutable array methods (`push`/`pop`/`indexOf`) | ✅ | #1, #2, #3, #4 |
| `[T]` tuple type | ✅ | #8 (fix F — alias-to-tuple now emits `using`; tuple-literal caveat remains) |
| `Map<K,V>` / `ReadonlyMap` | ✅ | #5, #6, #15 |
| `Set<T>` / `ReadonlySet` | ✅ | #6, #15 (const Set mutated via .add() demoted); #16 (fix B — demotion is now scope-local, so a read-only const Map is not demoted due to a sibling function's same-named binding); #17 (demotion now reaches class methods/getters/setters/ctors + namespace functions, not just free functions) |
| `Record<K,V>` | 🟡 | #8 (as a field type works; object-literal init into a Record is Finding G) |
| 2D arrays `T[][]` | ✅ | #9 |
| Associative array access `obj["key"]` | ❌ (gated) | #13 (lint `no-dynamic-property-access`; use a Map) |
| Heterogeneous array literal | ❌ (build error) | — |
| `any` annotation | ❌ (build error) | — |

### 1.6 Objects, interfaces, type aliases

| Pattern | Status | Tested by |
|---|---|---|
| Object literal `{ a: 1, b: 2 }` | ✅ | all |
| Object with spread `{ ...a, b: 2 }` | ❌ (gated) | #11 (lint `ObjectExpression > SpreadElement` — C++ structs have fixed shape; construct field-by-field) |
| `interface Foo { ... }` → `struct` | ✅ | #3, #4, #5, #6 |
| Interface with index signature | 🟡 | #13 (lowers to std::map field; obj["key"] gated; use Map.get) |
| Interface with numeric keys | 🟡 | #13 (lowers to std::map; Map.get return is `auto` — Finding H) |
| `type Foo = { ... }` | ✅ | #4 |
| `type Foo = SomeOther` (alias) | ✅ | #4 |
| `type Foo = number` | ✅ | #7 (fix E — emits `using`, survives tree-shaking) |
| `implements Interface` | 🟡 | #4 (recorded, not enforced) |
| `new SomeInterface()` | ❌ (build error) | — |
| Discriminated union of object literals → `std::variant` | ❌ (gated) | #9 (fix A — `<variant>` include registered; member access gated out — `TS2CPP_UNION_MEMBER_ACCESS`; use a struct) |
| `keyof T` | ❌ (gated) | #11 (lint `TSTypeOperator[type='keyof']` — no C++ equivalent; use a string union or switch) |
| Indexed access type `T[K]` | ❌ (gated) | #11 (lint `TSIndexedAccessType` — use the concrete field type directly) |
| Conditional type | 🟡 | #13 (Finding D — leaks generic `T`; don't use in value positions) |
| Mapped type | 🟡 | #13 (Finding E — leaks generic `T`) |
| Template literal type | ❌ (unsupported) | — |
| `satisfies` operator | ✅ | #8 (type-only, erased) |
| `as const` | 🟡 | #4 (object — F12 fix); #6 header note only |

### 1.7 Enums

| Pattern | Status | Tested by |
|---|---|---|
| Numeric enum `enum E { A, B }` | ✅ | #1, #4 |
| Enum with explicit values | ✅ | #6 (StationKind) |
| `const enum` | ✅ | #5, #6, #15 |
| Mixed explicit/implicit values | ✅ | #6 (StationKind computed) |
| String enum | ✅ | #4 (GameStatus, Outcome) |
| Enum relational comparison | ✅ | #4; fix in #3 (enum arithmetic `-`) |
| Enum type preserved across decls/returns | ✅ | #6 (Material field/param) |
| `enum` nested inside function/class | ⬜ | |
| Enum → number implicit cast (G10) | ✅ | #1 (drove fix) |
| Bitwise ops on enum operands (`& \| ^ <<`) | ✅ | #5 (drove fix) |

### 1.8 Null, undefined, and optionality

| Pattern | Status | Tested by |
|---|---|---|
| `T | null` / `T | undefined` → `T` | ✅ | #9 (fix D — value-type `=== null` resolves to false; erasure works) |
| `T | null | undefined` → `T` | ✅ | #13 (erases to T; null comparison resolved to false per #9 fix D) |
| Optional field `x?: T` → `T` | 🟡 | #6 (lint-guarded: B; compares-to-undefined is now an error) |
| `null` literal → `nullptr` | ✅ | #9 |
| `undefined` literal → `CUTTLEFISH_UNDEFINED` | ✅ | #9 |
| `a ?? b` nullish coalescing | ✅ | #4 (F6 helper-from-header fix) |
| `a?.b` optional chaining | ✅ | #7 |
| `a?.()` optional call | 🟡 | #7 (fix N — guard emitted; empty-std::function detection still a runtime gap) |
| `a ??= b` logical nullish assignment | ✅ | #8 (fix I — property-access left side now handled) |
| True `Optional<T>` / `std::optional` | ❌ (future) | — |

### 1.9 Destructuring

| Pattern | Status | Tested by |
|---|---|---|
| Object destructure `const { a, b } = obj` | ✅ | #5; fix in #6 (D — scope hoist) |
| Renamed `{ a: x }` | ✅ | #7 |
| Default `{ a = 5 }` | ✅ | #7 |
| Nested object destructure | 🟡 | #6 (fix D covers nested too, but demo doesn't use it) |
| Array destructure `const [a, b] = arr` | ✅ | #7 |
| Array destructure default | 🟡 | #8 (Finding I — wrong runtime value; default not bound when element absent) |
| Rest element `const [a, ...rest]` | ✅ | #7 (fix D — vector<T> not vector<T&>) |
| Destructure without initializer | ❌ (unsupported) | — |
| Parameter destructure `function f({ a, b })` | ✅ | #7 |
| Mixed destructure + regular params | ✅ | #8 |

### 1.10 Type assertions & narrowing

| Pattern | Status | Tested by |
|---|---|---|
| `x as T` | ✅ | #4 |
| `<T>x` angle-bracket assertion | ✅ | #10 (type-only, erased) |
| `x!` non-null assertion | ✅ | #5, #6 |
| `typeof x` | ✅ | #10 (fix C — int32_t family returns "number"; was "object") |
| `typeof` type guard optimization | 🟡 | #13 (union narrowing gated; typeof returns correct string per #10 fix C) |
| `instanceof` | ❌ (gated) | #13 (lint `BinaryExpression[operator='instanceof']` — no RTTI) |
| `in` operator (`"k" in obj`) | ✅ | #7 (fix K — enum keys cast) |

### 1.11 Generics

| Pattern | Status | Tested by |
|---|---|---|
| Generic function `function f<T>(x: T)` | ✅ | #6 (F fix: def in header) |
| Multiple type params | ✅ | #8 (`Registry<K extends string|number|symbol, V>`) |
| Generic class `class C<T>` | 🟡 | #8 (template + fields emit; `extends Generic<T>` fixed — Finding A; static members + `new Generic<T>()` static access still gap — Finding B/C) |
| Generic constraint `T extends X` → `static_assert` | ✅ | #6 (`complexity<T extends Recipe>`) |
| Generic type param in scope | ✅ | #6 |
| Conditional/`infer` generic gymnastics | ❌ (unsupported) | — |

### 1.12 Top type erasure

| Pattern | Status | Tested by |
|---|---|---|
| `any` | ❌ (build error) | — |
| `unknown` | ✅ | #11 (catch param — erases; catch emits catch(...)) |
| `never` | ❌ (unsupported) | — |
| `Partial<T>` / `Required<T>` / `Readonly<T>` / `Pick` / `Omit` | 🟡 | #10 (fix A — alias survives + emits after interface; resolves to full struct T — Partial/Pick/Omit don't narrow the C++ shape) |
| `NonNullable<T>` | 🟡 | #12 (alias emits; value reads as 0 at runtime — Finding F) |
| `ReturnType`/`Parameters`/`InstanceType`/`Extract`/`Exclude` | 🟡 | #13 (Finding F — `typeof` in type position broken; don't use) |

---

## 2. Control Flow

### 2.1 Conditionals

| Pattern | Status | Tested by |
|---|---|---|
| `if` | ✅ | all |
| `if / else` | ✅ | all |
| `if / else if / else` chains | ✅ | #1, #4, #6 |
| Nested `if` | ✅ | #4 |
| Ternary `a ? b : c` | ✅ | #4, #5, #6 |
| Nested ternary | ✅ | #7 |
| Ternary string vs numeric branches | ✅ | #6 (verdict) |

### 2.2 Loops

| Pattern | Status | Tested by |
|---|---|---|
| `for (let i; cond; inc)` C-style | ✅ | all |
| `for (const i; ...)` | ✅ | #6 |
| Infinite `for (;;)` | ✅ | #11 |
| `for...of` over array | ✅ | #1, #3, #4, #6, #17 |
| Nested `for...of` | ✅ | #4 |
| `for...of` loop variable mutated in body (const → T&) | ✅ | #17 (fix A — const loop var mutated via `t.field=`/`t[i]=`/`t.field++` now demotes to a non-const reference, in all scopes incl. class methods/namespaces; new lint rule `no-readonly-loop-variable-mutation`) |
| `for...in` over object keys | 🟡 | #7; over a Map/Record now rejected (semantic gate TS2CPP_FORIN_ON_MAP); plain-object for-in untested end-to-end |
| `while` | ✅ | #3, #4 |
| `while` with `break`/`continue` | ✅ | #3 |
| `do...while` | ✅ | #5, #6 |
| Infinite `while (true)` | ✅ | #12 |
| `for await...of` | ❌ (unsupported) | — |
| `for...of` by-reference for class elements | ✅ | #6 (H fix — clears warning) |

### 2.3 Branch control

| Pattern | Status | Tested by |
|---|---|---|
| `break` | ✅ | #3, #4 |
| `continue` | ✅ | #3 |
| `break` in switch | ✅ | #4, #6 |
| Labeled break `outer:` | ✅ | #4 (F9 goto fix) |
| Labeled continue | ✅ | #9 |
| Labeled statement (general) | ✅ | #9 |
| Empty statement `;` | ✅ | #9 |
| Standalone block `{ ... }` | ✅ | #12 |

### 2.4 `switch`

| Pattern | Status | Tested by |
|---|---|---|
| `switch` with cases | ✅ | #4, #6 |
| `default` | ✅ | #4, #6 |
| Switch without default | ✅ | #10 |
| Multiple statements per case | ✅ | #4 |
| Variable in case expression | ✅ | #12 |
| Nested switch | ✅ | #11 |
| Fall-through (no `break`) | 🟡 | #6 (case groups, 2:3:) |
| String `switch` | ✅ | #7 (dispatch) |
| `switch` on enum/numeric **struct field** (`switch (m.unit)`) | ✅ | #16 (fix A — type-aware discriminant, no `std::string(enum)` wrap) |

### 2.5 Exceptions

| Pattern | Status | Tested by |
|---|---|---|
| `try / catch` on native/ESP32 | ✅ | #6 |
| `try / catch` on AVR | ❌ (error) | — |
| `try / catch / finally` | ✅ | #11 (fix E — catch emits catch(...) catch-all) |
| `throw` on AVR | ❌ (error) | — |
| `throw` on native/ESP32 | ✅ | #11 |
| Custom error classes / `Error` subclass | ❌ (unsupported) | — |

### 2.6 Async & concurrency

| Pattern | Status | Tested by |
|---|---|---|
| `async function` | ❌ (gated) | #13 (lint rejects — no event loop) |
| `await expr` | ❌ (gated) | #13 (lint rejects) |
| `await` on a statement | ❌ (gated) | #13 |
| `Promise`, `Promise.all`, `.then` | ❌ (unsupported) | — |
| `function*` generator | ❌ (gated) | #13 (lint rejects — no coroutine runtime) |
| `yield` / `yield*` | ❌ (gated) | #13 |

---

## 3. Functions

### 3.1 Declarations

| Pattern | Status | Tested by |
|---|---|---|
| `function f() {}` declaration | ✅ | all |
| Named function expression | ✅ | #7 (lossLabel) |
| Arrow function `const f = () => {}` | ✅ | #6 (callback) |
| Arrow with expression body | ✅ | #6 |
| Anonymous declaration export | ❌ (unsupported) | — |
| Nested function declaration | ✅ | #4 |
| Nested class inside function | 🟡 | #13 (Finding J — emits `auto` params; hoist to module level) |
| Recursion | ✅ | #4 (pathfinding) |
| Function hoisting (sibling calls) | ✅ | #1, #4 |
| `export function` | ✅ | all |
| `export default function` | 🟡 | #12 (export emits; default import doesn't resolve — Finding C; use named export) |

### 3.2 Parameters

| Pattern | Status | Tested by |
|---|---|---|
| Primitive params | ✅ | all |
| Multiple params | ✅ | all |
| Default param `function f(a = 5)` | ✅ | #6 (Stockpile ctor) |
| Rest param `function f(...xs)` → `std::vector<T>` | 🟡 | #6 (declaration OK; call-site spread fixed, literal-args call needs signature table) |
| Object destructure param | 🟡 | #13 (Finding A — inline type emits `auto`; use named interface) |
| Nested object destructure param | 🟡 | #13 (same — use named interfaces) |
| Array destructure param | ✅ | #13 |
| Mixed destructure + regular params | ✅ | #8 |
| `this` parameter (typed) | 🟡 | #13 (type-only, erased; not exercised in a class method body) |

### 3.3 Return types & overloads

| Pattern | Status | Tested by |
|---|---|---|
| Annotated return type | ✅ | all |
| Inferred return type | ✅ | all |
| Multiple `return`s with differing types | ✅ | #4 |
| Early return | ✅ | #4 |
| Return type with ownership wrapper | ✅ | #4 |

### 3.4 Higher-order functions & callbacks

| Pattern | Status | Tested by |
|---|---|---|
| Passing function as argument → `std::function` | ✅ | #6 (Forge.report) |
| Returning a function | ✅ | #9 (fix B — nested-fn alias mangling; capture-free nested fns work; capturing nested fns are the §3.4 closure limit) |
| Function type alias `type Fn = () => void` | ❌ (gated) | #9 (lint rejects — not emitted as C++ typedef) |
| Class method as callback | ❌ (gated) | #9 (`.bind()` rejected — no `this`-rebinding in C++) |
| `Math.method` callbacks (comparator) | ✅ | #13 (module-level comparator; sort convention fixed in #12) |
| Closures capturing outer variables | 🟡 | #6 (named function + module-level offset; arrow-capture unreliable) |
| IIFE `(function(){})()` | ❌ (unsupported) | #7 (gated out — fix M, lint selector) |
| Arrow callback with explicit return type → ISR | ✅ | #6 (G fix); #7 (fix A — param cppType now resolved too) |

### 3.5 `forEach` inline expansion

| Pattern | Status | Tested by |
|---|---|---|
| `arr.forEach(fn)` as statement | 🟡 | #12 (not lowered on runtime vectors — callback ISR can't capture locals; use a manual for loop) |
| `forEach` with arrow expression body | 🟡 | #13 (not lowered — use manual for loop) |
| `forEach` with block body | 🟡 | #13 (same gap) |

---

## 4. Classes & OOP

### 4.1 Class structure

| Pattern | Status | Tested by |
|---|---|---|
| `class C {}` empty | ✅ | #13 |
| Class with public/private/protected fields | ✅ | #2, #3, #4, #6 |
| Class with field initializers | ✅ | #2, #4, #6 |
| Class with `readonly` fields | ✅ | #3, #6 |
| Class with `static` fields/methods | ✅ | #4, #6 |
| Static initializer block `static { ... }` | ❌ (gated) | #13 (lint `StaticBlock` — no C++ lowering; init in field decl or ctor) |
| Optional class field `x?: T` | ✅ | #4 |
| Generic class `class C<T>` | 🟡 | #8 (template + fields emit; `extends Generic<T>` fixed — Finding A; static members + `new Generic<T>()` static access still gap — Finding B/C) |
| Nested class (inside function or class) | 🟡 | #13 (Finding J — nested class in function emits `auto`; hoist to module level) |
| `export class` / `export default class` | ✅ | all |

### 4.2 Constructors & `this`

| Pattern | Status | Tested by |
|---|---|---|
| `constructor()` | ✅ | #2, #4, #6 |
| Constructor default param | ✅ | #6 (Stockpile) |
| Constructor parameter property | ✅ | #4 |
| `this.field = value` assignment | ✅ | #2, #4, #6 |
| `this.x += value` compound | ✅ | #6 |
| `this` reference → `this->` | ✅ | all |
| `this` in free function | ❌ (unsupported) | — |

### 4.3 Methods

| Pattern | Status | Tested by |
|---|---|---|
| Instance method | ✅ | #2, #3, #4, #6 |
| Private/protected method | ✅ | #6 (craft) |
| Static method | ✅ | #4, #6 (Stockpile.format) |
| Method calling free function | ✅ | #4 |
| Getters `get x()` | ✅ | #4, #6 (C fix: pointer receiver); #14 (instance + cross-file access now rewrites to getX()) |
| Setters `set x(v)` | ✅ | #6 |
| Getter/setter pair | ✅ | #6 |
| Static getter/setter | ✅ | #8 (fix B — cv-qualifier dropped); #14 (fix E — `Cls.x` now rewrites to `Cls::getX()`; access-name caveat resolved) |
| Abstract method → pure virtual | ✅ | #6 (Workstation.produces) |

### 4.4 Inheritance & polymorphism

| Pattern | Status | Tested by |
|---|---|---|
| `class B extends A` | ✅ | #4, #6 |
| `super()` call → initializer list | ✅ | #4, #6 |
| `super` with args | ✅ | #6 (StationKind arg) |
| `super.method()` | 🟡 | #8 (lowering attempted; cascades from generic-subclass emit — Finding A/B) |
| Virtual method override (polymorphism) | ✅ | #4, #6 (Smelter/Assembler.craft) |
| Virtual destructor on polymorphic base | ✅ | #4, #6 |
| `override` modifier | ✅ | #6 |
| Abstract class with abstract methods | ✅ | #6 (Workstation) |
| Multiple inheritance | ❌ (unsupported) | — |
| Mixins | ❌ (unsupported) | — |

### 4.5 Reference vs value semantics

| Pattern | Status | Tested by |
|---|---|---|
| `new C()` returns pointer | ✅ | #4, #6 |
| Field of class type → pointer field | ✅ | #4, #6 (Forge.storage) |
| Local `let s = this.pointerField` | ✅ | #4 |
| Deep access chain `a.b.c.d` | ✅ | #4, #6 |
| `for (const item of classArray)` → `item->field` | ✅ | #6 |
| Constructor param promoted to pointer | ✅ | #4 |
| Borrowed constructor param (not deleted) | ✅ | #13 |

### 4.6 Ownership wrappers

| Pattern | Status | Tested by |
|---|---|---|
| `Owned<T>` field | ✅ | #8 |
| `Shared<T>` field | ✅ | #8 |
| `Mutable<T>` field | ✅ | #8 |
| Wrapper detection before alias resolution | 🟡 | #13 (Finding I — `type X = Owned<T>` resolves to `auto` field; use Owned<T> directly) |

### 4.7 Decorators & namespaces

| Pattern | Status | Tested by |
|---|---|---|
| Class decorator `@dec class C` | ❌ (gated) | #13 (lint rejects — no lowering) |
| Method/property/parameter decorators | ❌ (unsupported) | — |
| Decorator factories `@dec(arg)` | ❌ (gated) | #13 |
| `namespace X {}` | ❌ (gated) | #11 (no ModuleDeclaration lowering — `TSModuleDeclaration` lint selector; use a class with static methods) |
| Enum inside class | 🟡 | #13 (use static readonly constants instead — enum-inside-class untested) |
| Interface inside class/function | 🟡 | #13 (hoist to module level) |
| Type alias inside class/function | 🟡 | #13 (hoist to module level) |

---

## 5. Expressions & Stdlib

### 5.1 Operators

| Pattern | Status | Tested by |
|---|---|---|
| Arithmetic `+ - * / %` | ✅ | all |
| Comparison `== != < > <= >=` | ✅ | all |
| Logical `&& \|\| !` | ✅ | #4, #6 |
| Bitwise `& \| ^ ~ << >>` | ✅ | #4, #5, #6 |
| Compound assignment `+= -= *= /= %=` | ✅ | #3, #6 |
| Bitwise assignment `&= \|= ^= <<= >>=` | ✅ | #5 |
| `\|\|=`, `&&=`, `??=` | ✅ | #8 (??= fixed); #13 (fix C — ||=,&&= on property access now lowered) |
| Prefix/postfix `++ --` | ✅ | #4 |
| Comma operator `(a, b)` | ✅ | #8 |
| Unary `-x`, `+x`, `!x` | ✅ | #4 |
| `delete obj.key` | ✅ | #8 (fix D — Map.delete method now lowers to .erase) |
| `void expr` | ✅ | #8 |
| Exponentiation `**` | 🟡 | #8 (use Math.pow — `**` is matrix-🟡) |
| `new.target`, `import.meta` | ❌ (unsupported) | — |

### 5.2 `Math.*`

| Pattern | Status | Tested by |
|---|---|---|
| `Math.floor/ceil/round/abs/sqrt/...` | ✅ | #2, #3, #5, #6 |
| `Math.min/max` | ✅ | #4, #6 |
| `Math.random` | ✅ | #7 |
| `Math.PI`, `Math.E`, constants | ✅ | #7 (fix L — lower to literals) |

### 5.3 Array & string methods

| Pattern | Status | Tested by |
|---|---|---|
| `push`, `pop` | ✅ | #1, #2, #3, #4, #6 |
| `indexOf`, `lastIndexOf`, `includes` | ✅ | #7 (includes) |
| `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `concat`, `slice`, `join` | ✅ | #7 (sort, slice, join); #10 (shift, unshift, reverse, fill, concat); #12 (fix E — sort-with-comparator convention fixed); slice on a number[] still resolves to the string __tc_slice2 polyfill (guard-collision gap) |
| `map`, `filter`, `reduce`, `find`, `findIndex`, `every`, `some`, `forEach` | ✅ | #4 (F7 filter); #7 (map/filter/reduce/some/find — fix A: callbacks carry real signatures); forEach on runtime vector still a gap |
| `.length` on array/string/typed-array | ✅ | all |
| String methods (toUpperCase, etc.) | ✅ | #2 |
| `parseInt`, `parseFloat` | ✅ | #9 (fix C — `.c_str()` for `atoi`/`atof`) |

### 5.4 `Object.*` and container ops

| Pattern | Status | Tested by |
|---|---|---|
| `Object.keys(map)` | ✅ | #7 (fix I — member-access args resolved) |
| `Object.values(map)` | ✅ | #7 (fix I) |
| `Object.entries(map)` | 🟡 | #7; pair→tuple return-type mismatch remains |
| `Object.keys(plainStruct)` | 🟡 | #4 (F5 — only literal field names) |
| `Object.assign`, `Object.freeze`, `Object.fromEntries` | ❌ (unsupported) | — |
| `JSON.*` | ❌ (unsupported) | — |

### 5.5 HAL / hardware-specific

| Pattern | Status | Tested by |
|---|---|---|
| `new Pin(n)`, buses, ports | ⬜ | (native demos only — no HAL demo yet) |
| Pin factory functions | ⬜ | |
| `pin.read()`, `pin.write()`, bus methods | ⬜ | |
| `spi.device(cs).transfer(...)` | ⬜ | |
| `registerPlatformStrategy(...)` | ⬜ | |

---

## 6. Module structure

### 6.1 Top-level file model

| Pattern | Status | Tested by |
|---|---|---|
| Free functions emit as C++ free functions | ✅ | all |
| Top-level statements flow into `main()` / `setup()` | ✅ | all |
| `setup()` / `loop()` Arduino entry points | ⬜ | |
| Split-file emission (non-entry files) | ✅ | #4, #5, #6 (A fix: extern for const arrays) |
| Source maps (C++ → TS error mapping) | ⬜ | |
| `.ino` sketch flattening for Arduino | ⬜ | |

### 6.2 Imports / exports

| Pattern | Status | Tested by |
|---|---|---|
| `import { x } from "./local"` | ✅ | all |
| `import x from "./local"` (default) | 🟡 | #12/#13 (named export works; inline default function not processed — Finding C; use named export) |
| `import { x } from "npm-pkg"` | ✅ | #4 (@typecad/expect) |
| `import @typecad/expect` | ✅ | #4 |
| `export` / `export default` | ✅ | all |
| Native `.d.ts` + `.cpp` binding pairs | ⬜ | |
| Dynamic `import()` | ❌ (unsupported) | — |
| `require()` | ❌ (unsupported) | — |
| Re-exports `export * from` | 🟡 | #13 (Finding G — re-exported symbols not visible to importer; import directly from source) |

---

## Summary

**Coverage counts** (approximate, ✅ items only):

| Section | ✅ Tested | ⬜ Untested | ❌ Unsupported |
|---|---|---|---|
| 1. Variables & Types | 41 | 33 | 7 |
| 2. Control Flow | 22 | 16 | 4 |
| 3. Functions | 20 | 14 | 1 |
| 4. Classes & OOP | 27 | 16 | 2 |
| 5. Expressions & Stdlib | 18 | 18 | 3 |
| 6. Module structure | 5 | 5 | 2 |
| **Total** | **133** | **102** | **19** |

**Demo-driven fixes catalog** (transpiler/lint changes a demo's compile failure
motivated, pinned by regression tests):

| Demo | Fixes | Test file |
|---|---|---|
| #1 | G10 (enum→number cast) | `tests/demo-driven-fixes.test.ts` (G1–G10) |
| #2 | string-enum + enum-concat lowering; bug-fix batch | (in `tests/bug-fixes.test.ts`) |
| #3 | enum arithmetic (`-`) on enum-class operands | (in `tests/demo-driven-fixes.test.ts`) |
| #4 | F1–F12 (Map/Set type-arg leak, cstdint, static field, enum == cast, Object.keys on class, ?? helper, .filter, let→const array, labelled break goto, generic call-site T, object brace-init, as const); lint `no-undefined-compare-on-get` | `tests/packages/transpiler/demo-4-regressions.test.ts` |
| #5 | bitwise ops on enum operands; lint `no-typed-array-param-length`, `no-typed-array-return` | `tests/packages/transpiler/demo-5-regressions.test.ts` |
| #6 | A (extern for const arrays), C (getter via pointer), D (destructure scope), E (rest spread call), F (generic def in header), G (callback return type), H (for...of by-ref); lint `no-undefined-compare-on-struct-field` | `tests/packages/transpiler/demo-6-regressions.test.ts` |
| #7 | A (functional-method callback signatures: .map/.filter/.reduce/.some), D (array-rest `vector<T&>`→`vector<T>`), E (type-alias-to-primitive emitted as `using`), G (const-local struct mutation demoted), I (Object.keys/values on member-access + lint broadened), J (`for...in` over Map gated: `TS2CPP_FORIN_ON_MAP`), K (enum keys into Map `static_cast`), L (`Math.PI`/`E` literals), M (IIFE gated), N (optional call `fn?.()` null guard); broadened `no-object-static-non-map` lint rule | `tests/packages/transpiler/demo-7-regressions.test.ts` |
| #8 | A (generic subclass `extends Generic<T>` heritage type args resolved), B (static getter `const` cv-qualifier dropped), D (`m.delete(k)` Map method → `.erase`, not `delete_`), F (tuple/container type-alias survives tree-shaking), H (`Map.size` → `m.size()`, not `m->size`), I (`??=` on property-access left side); E/G/C documented (shadow-struct collision, index-sig literal, static-getter access name, tuple literal) | `tests/packages/transpiler/demo-8-regressions.test.ts` |
| #9 | A (discriminated union → `std::variant` registers `#include <variant>`), B (nested-fn return reference alias-mangled), C (`parseInt`/`parseFloat` `.c_str()`), D (`T\|null` value-type comparison → false), E (union member access gated: `TS2CPP_UNION_MEMBER_ACCESS`); F documented (`bind\|call\|apply` lint guardrail) | `tests/packages/transpiler/demo-9-regressions.test.ts` |
| #10 | A (utility-type aliases `Partial`/`Pick`/`Omit` survive tree-shaking + interfaces emit before aliases), C (`typeof` on int32_t returns "number" not "object"); B documented (Partial→full struct shape) | `tests/packages/transpiler/demo-10-regressions.test.ts` |
| #11 | E (`try/catch` emits `catch(...)` catch-all — was `catch(const std::exception&)` which missed thrown non-exception types), D (array-of-objects with a named element type uses the named type, not a shadow `_{name}_t` struct); A/B/C gated (`ObjectExpression > SpreadElement`, `TSTypeOperator[type='keyof']`, `TSIndexedAccessType`, `TSModuleDeclaration` lint selectors) | `tests/packages/transpiler/demo-11-regressions.test.ts` |
| #12 | E (`.sort(comparator)` convention — TS negative=before converted to std::sort true=before); A/B/C/D/F documented (forEach, in-class sort ordering, export default inline fn, Float32Array extern, NonNullable snprintf) | `tests/packages/transpiler/demo-12-regressions.test.ts` |
| #13 | C (`\|\|=`/`&&=` on property-access left sides lowered), B/D/E/F gated (static-init block, conditional types, mapped types, ReturnType/Parameters — lint selectors); G/H/I/A/J documented (re-exports, Map.get auto, wrapper-on-alias, inline-type auto, nested-class-in-fn) | `tests/packages/transpiler/demo-13-regressions.test.ts` |
| #14 | A (struct-return-of-null/`?? null` lowers to `return {};` — `ReturnIR.functionReturnType`, free fns AND methods), B (subclass with no ctor gets a synthesized forwarding ctor), D (free fns forward-declared BEFORE class bodies), E (static-getter `Cls::getX()` rewrite + cross-file accessor aggregation), G (`int32_t`→`%d`, `uint32_t`→`%u`, not `%ld`); C lint-gated (`no-map-struct-mutation` — no TS→C++ reference binding for map values), F stale `TS2CPP_NO_EQUIVALENT` string-enum warning removed | `tests/packages/transpiler/demo-14-regressions.test.ts` |
| #15 | A (`Map.values()`/`.keys()`/`.entries()` and `Set.values()`/`.entries()` lower to `__tc_mapValues`/`__tc_mapKeys`/`__tc_mapEntries`/`__tc_setValues`/`__tc_setEntries` helpers — was: `.values()` dropped, for-of iterated raw `std::pair` entries), B (`Map.get(k)` lowers to const-correct `m.at(k)` — was: non-const `operator[]`, failed on a const-bound Map and silently inserted on miss), C (const-bound `Map`/`Set` mutated via `.set()`/`.add()`/`.delete()` now demoted; `insert`/`erase` added to mutation set; index-assignment marks `let` vars `everAssigned` so the contradictory `ownership-suggest-const` no longer fires); D documented (`const enum` lint-gated in scaffolded projects). New lint rule `no-mutating-method-on-const-collection` (warn) persists into new projects. | `tests/packages/transpiler/demo-15-regressions.test.ts` |
| #16 | A (`switch` on a property-access discriminant — e.g. `switch (m.unit)` on an enum/numeric struct field — is now type-aware: the `std::string(...)` wrap is decided by the discriminant's resolved C++ type via a new public `inferCppType` on the expression renderer, so enum/numeric fields emit a plain comparison instead of the illegal `std::string(enum)`; was: property-access wrapped unconditionally → `no matching function for call to 'std::string::basic_string(const Unit&)'`), B (ownership const-content demotion is now resolved **per lexical scope** in a single combined pass with scope-local maps — was: two separate global passes over flat name-keyed maps, so a read-only `const` Map in one function collided with a same-named binding mutated in a sibling function and was wrongly demoted; cross-scope `let` reassignment still suppresses `ownership-suggest-const` via a program-wide assigned-names set). No new lint rule (compile-time fixes). | `tests/packages/transpiler/demo-16-regressions.test.ts` |

### Highest-value untested areas (candidates for future demos)

1. **Async/concurrency (§2.6)** — entirely untested; `async`/`await` lower with warnings but no demo exercises the path.
2. **HAL/hardware (§5.5)** — no native/Arduino demo has exercised Pin/bus/SPI lowering end-to-end.
3. **Functional array methods beyond filter (§5.3)** — `map`, `reduce`, `find`, `some`, `every`, `forEach` inline expansion untested.
4. **`Object.*` container ops (§5.4)** — `Object.keys/values/entries` on maps untested.
5. **Ownership wrappers (§4.6)** — `Owned<T>`/`Shared<T>`/`Mutable<T>` untested.
6. **Advanced generics (§1.11)** — generic class, multiple type params untested.
7. **Optional chaining (§1.8)** — `a?.b`, `a?.()` untested.
8. **`for...in` over object keys (§2.2)** — untested (distinct from `for...of`).
9. **String `switch` (§2.4)** — untested.
10. **Decorators & namespaces (§4.7)** — `namespace X {}` untested.
