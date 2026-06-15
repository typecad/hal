# Cuttlefish Language Support Matrix

> **Source of truth for:** what TypeScript code patterns cuttlefish supports, what it deliberately
> does *not* support, and what is technically impossible to transpile to C++ for embedded targets.

This document is the canonical reference used to classify any reported behavior as one of:

- ✅ **Supported** — works correctly and is covered by tests. A regression here is a **bug**.
- 🟡 **Partial / best-effort** — emits code or lowers to a documented approximation with a diagnostic.
  Output may compile but differ in runtime semantics from TypeScript. Report *semantic* mismatches
  as bugs; report *missing* lowering as a feature request.
- ⚠️ **Future / stretch** — known gap with a plausible path to support, but not implemented.
  Not a bug.
- ❌ **Unsupported by design** — lowered to a placeholder and emits `TS2CPP_UNSUPPORTED_*`.
  This is intentional; do not file as a bug. See the rationale.
- 🚫 **Never** — cannot meaningfully be transpiled due to a fundamental language/platform
  mismatch. Out of scope, permanently.

Each entry cites the source location that implements (or rejects) it so maintainers can verify.

---

## How to read this document

1. Patterns are grouped into four large categories — **Variables & Types**, **Control Flow**,
   **Functions**, and **Classes & OOP** — and an appendix covers **Expressions & Stdlib** and
   **Module structure**.
2. Within each category, patterns drill from broad constructs down to specific edge cases.
3. When triaging a report, find the closest matching pattern and use its status to decide
   bug vs. feature-request vs. wontfix.
4. Diagnostic codes prefixed `TS2CPP_` are emitted by the IR layer and are searchable in tests.

---

## 1. Variables & Types

### 1.1 Variable declarations

| Pattern | Status | Notes |
|---|---|---|
| `let x = 1` | ✅ | Emitted as non-`const` C++ decl. `tests/statements.test.ts`. |
| `const x = 1` | ✅ | Emitted as `const`. |
| `var x = 1` | ✅ | Treated as `let` (no hoisting semantics carried over). |
| `let x: number` (no initializer) | ✅ | Default-initialized per C++ rules. |
| Multiple decls `let a = 1, b = 2` | ✅ | `tests/statements.test.ts:70`. |
| Declaration with typed initializer | ✅ | |

### 1.2 Primitive type mapping

TypeScript primitives map to fixed C++ types in `typeNodeToCppType`
(`packages/cuttlefish/src/ir/type-resolution.ts:200`).

| TS type | C++ | Status |
|---|---|---|
| `number` | `double` | ✅ (`type-resolution.ts:303`). Note: **always `double`**, never `int`, even for integer literals — see §1.3. |
| `boolean` | `bool` | ✅ |
| `string` | `std::string` | ✅ (`:311`). On Arduino, string literals often lower to `const char*` + stack buffers; see §1.4. |
| `void` | `void` | ✅ |
| `int` / `float` / `double` / `long` | pass-through | ✅ — the transpiler accepts C-style type names directly (`DIRECT_CPP_TYPE_MAP`, `:38`). |
| `uint8_t` … `int32_t`, `size_t` | pass-through | ✅ — explicit fixed-width annotations are honored. |
| `bigint` | 🚫 | No C++ equivalent that fits embedded semantics; not handled. |

### 1.3 Numeric inference

Number literal inference is in `inferExprCppType` (`type-resolution.ts:550`) and
`inferNumericCppType` (`:117`).

| Pattern | Status | Notes |
|---|---|---|
| Integer literal `42` | ✅ infers `int` | |
| Float literal `3.14` / `1e3` | ✅ infers `double` | detected via `/[.eE]/` |
| `int` annotation promoted to `double` when initializer is float | ✅ | `resolveDeclarationType` (`:899`). |
| `int` return type promoted to `double` when body returns float | ✅ | `buildFunctionReturnTypeMap` (`:959`). |
| `int` return type promoted to `long` for large enum values | ✅ | `returnsLargeEnumValue` (`:1031`). |
| Automatic `uint8_t` vs `int16_t` selection from value range | ⚠️ Future | The transpiler does **not** infer widths; users must annotate. Choosing widths automatically would be a non-obvious lowering decision. |

### 1.4 Strings

| Pattern | Status | Notes |
|---|---|---|
| `"literal"` | ✅ | |
| Empty string `""` | ✅ | |
| String + string concat | ✅ | Lowers to `snprintf` on all targets (unified concat path — native and Arduino/AVR share one snprintf-based lowering so enums, floats, and objects never hit `std::to_string`). `tests/expressions.test.ts:198`. |
| String + number concat | ✅ | |
| String + boolean concat | ✅ | |
| Template literal `` `x = ${a}` `` | ✅ | Lowers to stack `char[]` + `snprintf`, preserving TS var names (CLAUDE.md convention). |
| Nested template literals / complex `${}` | ✅ | |
| **Tagged template** `` tag`...` `` | ❌ | `emitUnsupportedExpression("Tagged template expressions are unsupported…")` (`expression-to-ir.ts:1651`). There is no meaningful C++ lowering for a tag function. |
| `string` type → `std::string` everywhere | ✅ | |

### 1.5 Arrays & collections

| Pattern | Status | Notes |
|---|---|---|
| `number[]` | ✅ → `std::vector<double>` | `type-resolution.ts:288`. |
| `Array<T>` | ✅ → `std::vector<T>` | `:293`. |
| `ReadonlyArray<T>` | ✅ → `std::vector<T>` (const-ness dropped) | `:367`. On Arduino, readonly arrays at top level may emit as C-style arrays (CLAUDE.md). |
| `new Uint8Array([...])`, `Int16Array`, etc. | ✅ → C-style `uint8_t[]` | `TYPED_ARRAY_ELEMENT_MAP`. `tests/transpiler-type-gaps.test.ts:68`. |
| `new Float32Array(n)` zero-init | ✅ | |
| Typed array type annotation → pointer (`uint8_t*`) | ✅ | |
| `.length` on typed array | ✅ → `sizeof(arr)/sizeof(arr[0])` | `tests/transpiler-type-gaps.test.ts:352`. |
| Array literal `[1, 2, 3]` | ✅ | Element type inferred from contents. |
| Spread in array `[...a, b]` | ✅ | `tests/transpiler-type-gaps.test.ts:392`. |
| Mutable array methods (`push`/`pop`/`indexOf`) | ✅ | Promotes backing storage to `StaticArray` (`ARRAY_METHODS_REQUIRING_STATIC_ARRAY`). |
| `[T]` tuple type | ✅ → `std::tuple<T>` | `type-resolution.ts:374`. |
| `Map<K,V>` / `ReadonlyMap` | ✅ → `std::map<K,V>` | |
| `Set<T>` / `ReadonlySet` | ✅ → `std::set<T>` | |
| `Record<K,V>` | ✅ → `std::map<K,V>` | |
| 2D arrays `T[][]` | 🟡 | Lowered as `std::vector<std::vector<T>>`; works but uncommon on AVR (heap concern). |
| Associative array access `obj["key"]` | ✅ when target is `std::map`/struct | |
| Heterogeneous array literal `[1, "a"]` | 🚫 | **Build error** (`TS2CPP_HETEROGENEOUS_ARRAY`). The semantic-gate pass (`orchestrator/type-checker.ts runSemanticGates`) detects array literals whose elements resolve to >1 incompatible kind (numeric vs string vs object) and aborts the build with a source-located `Diagnostic`. Numeric/bool widening is accepted (`[1, true]` → `std::vector<int>`). Declare an explicit tuple type (`[number, string]`) for intentionally mixed elements — tuple contextual types are exempt. |
| `any` annotation (explicit) | 🚫 | **Build error** (`TS2CPP_EXPLICIT_ANY`). Flagged by the syntactic feature-prescan (`feature-registry.ts AnyKeyword`) on every `any` token; also enforced as an ESLint error in scaffolded projects. Use a concrete type, or `unknown` with type-guard narrowing. (`any` previously lowered silently to `auto` — now a hard error.) |

### 1.6 Objects, interfaces, type aliases

| Pattern | Status | Notes |
|---|---|---|
| Object literal `{ a: 1, b: 2 }` | ✅ | Emitted as struct initializer. `tests/expressions.test.ts:517`. |
| Object with spread `{ ...a, b: 2 }` | ✅ | Multiple spread sources supported. |
| `interface Foo { ... }` | ✅ → C++ `struct` | `declaration-builders.ts` via `interfaceDeclarationToIR`. |
| Interface with index signature | ✅ → `std::map` field inside struct | `tests/expressions.test.ts:711`. |
| Interface with numeric keys | ✅ | |
| `type Foo = { ... }` | ✅ | Object-literal aliases emit as struct under the alias name. |
| `type Foo = SomeOther` | ✅ | Alias resolved through `resolveAliasedTypeNode`. |
| `type Foo = number` | ✅ | Resolves to mapped C++ type. |
| `implements Interface` | 🟡 | Recorded in IR (`implementsInterfaces`) but **not enforced** as virtual methods; struct shape is emitted. |
| `new SomeInterface()` | 🚫 | **Build error** (`TS2CPP_NEW_ON_INTERFACE`). Interfaces are type-only (no value symbol); `new IFoo()` is rejected by the semantic-gate pass (`orchestrator/type-checker.ts runSemanticGates`) before emit, resolving the target across files via the TypeChecker and a program-wide interface-name set. Only `new SomeClass()` is supported. (Previously lowered verbatim and relied on the C++ compiler to fail with an opaque message.) |
| Discriminated union of object literals | ✅ → `std::variant<...>` with generated variant structs | `tests/new-features.test.ts:293`. |
| `keyof T` | 🟡 → `auto` | No C++ equivalent; lowered loosely. |
| Indexed access type `T[K]` | 🟡 → `auto` | `:451`. |
| Conditional type `T extends U ? X : Y` | 🟡 → resolves true branch optimistically | `:464`. Compile-time only; runtime behavior may surprise. |
| Mapped type `{ [P in keyof T]: ... }` | 🟡 → resolves to source type name | `:235`. |
| Template literal type `` `${X}` `` | 🚫 → `auto` | No C++ equivalent (`:470`). |
| `satisfies` operator | ✅ | Type-only, erased at emit. |
| `as const` | ✅ | Type-only, erased. |

### 1.7 Enums

`enumDeclarationToIR` in `declaration-builders.ts`; string-enum detection in `statement-to-ir.ts:276`.

| Pattern | Status | Notes |
|---|---|---|
| Numeric enum `enum E { A, B }` | ✅ | `tests/enums.test.ts:6`. |
| Enum with explicit values | ✅ | |
| `const enum` | ✅ | |
| Mixed explicit/implicit values | ✅ | |
| String enum | ✅ → members as `const char*` | `activeStringEnumNames` tracking. |
| Enum relational comparison | ✅ → wraps in `static_cast<int>` | `tests/enums.test.ts:65`. |
| Enum type preserved across decls/returns | ✅ | |
| `enum` nested inside function/class | ✅ | Hoisted to file scope. |

### 1.8 Null, undefined, and optionality

| Pattern | Status | Notes |
|---|---|---|
| `T | null` / `T | undefined` | ✅ → strips nullish, emits `T` | `type-resolution.ts:254`. There is **no** `std::optional` representation; see rationale below. |
| `T | null | undefined` | ✅ → `T` | |
| Optional field `x?: T` | ✅ → `T` (optionality not enforced at runtime) | |
| `null` literal | ✅ → `CUTTLEFISH_UNDEFINED` macro | `tests/transpiler-type-gaps.test.ts:288`. |
| `undefined` literal | ✅ → `CUTTLEFISH_UNDEFINED` | |
| `a ?? b` nullish coalescing | ✅ → `cuttlefish_nullish(a, b)` helper | **Must** use the helper (not truthy ternary) so `0`/`false` are preserved. CLAUDE.md convention. |
| `a?.b` optional chaining | 🟡 → `cuttlefish_exists(a) ? a.b : 0` | Emits `TS2CPP_OPTIONAL_CHAINING` warning; semantics approximate. `expression-to-ir.ts:595`. |
| `a?.()` optional call | 🟡 | Same approximate null guard. |
| `a ??= b` logical nullish assignment | ✅ | |
| **True `Optional<T>` / `std::optional`** | ⚠️ Future | Currently flattened. Supporting real optionals would require a representational choice (sentinel vs `std::optional`, both costly on AVR) and is a non-obvious lowering decision. |

### 1.9 Destructuring

`transformers/variables.ts:150` (declarations) and `function-builder.ts:43` (parameters).

| Pattern | Status | Notes |
|---|---|---|
| Object destructure `const { a, b } = obj` | ✅ | Splits into individual `auto` decls. |
| Renamed `{ a: x }` | ✅ | `tests/transpiler-type-gaps.test.ts:415`. |
| Default `{ a = 5 }` | ✅ → `cuttlefish_nullish` | |
| Nested object destructure | ✅ | |
| Array destructure `const [a, b] = arr` | ✅ | Index-based extraction. |
| Array destructure default `[a = 5]` | ✅ | |
| Rest element `const [a, ...rest]` | ✅ → `std::vector` slice | |
| Destructure without initializer | ❌ → `TS2CPP_UNSUPPORTED_DECL` | `variables.ts:157`. |
| Parameter destructure `function f({ a, b })` | ✅ | Synthetic `__param_N` + extraction statements. |
| Mixed destructure + regular params | ✅ | |

### 1.10 Type assertions & narrowing

| Pattern | Status | Notes |
|---|---|---|
| `x as T` | ✅ | Erased; underlying expression emitted. |
| `<T>x` angle-bracket assertion | ✅ | |
| `x!` non-null assertion | ✅ | Erased. |
| `typeof x` | ✅ → string literal where statically known | `tests/new-features.test.ts:187`. Dynamic typeof falls back to `"object"`. |
| `typeof` type guard optimization (`typeof x === "number"`) | ✅ → `true`/`false` when statically known | |
| `instanceof` | 🟡 | No RTTI lowering; treated loosely. Avoid in firmware. |
| `in` operator (`"k" in obj`) | ✅ → `map.count()` / vector find on containers | `expression-to-ir.ts:316`. |

### 1.11 Generics

| Pattern | Status | Notes |
|---|---|---|
| Generic function `function f<T>(x: T)` | ✅ → C++ `template<typename T>` | `tests/transpiler-type-gaps.test.ts:661`. |
| Multiple type params | ✅ | |
| Generic class `class C<T>` | ✅ | |
| Generic constraint `T extends X` | ✅ → emitted as `static_assert` | `function-builder.ts:602`. |
| Generic type param in scope | ✅ | `typeParametersInScope` tracking in `typeNodeToCppType`. |
| Conditional/`infer` generic gymnastics | 🚫 | Far beyond what template lowering can express. |

### 1.12 Top type erasure

| Pattern | Status | Notes |
|---|---|---|
| `any` | 🚫 | **Deprecated — now a build error** (`TS2CPP_EXPLICIT_ANY`, see §1.5). Previously lowered best-effort to `auto`; the syntactic feature-prescan now rejects every explicit `any` token. Use a concrete type or `unknown`. (Implicit `any` is still caught by the TypeScript type-checker when `noImplicitAny` is set, which scaffolded projects enable.) |
| `unknown` | 🟡 → `auto` | |
| `never` | 🚫 | No meaningful C++ lowering. Avoid. |
| `Partial<T>` / `Required<T>` / `Readonly<T>` / `Pick` / `Omit` | ✅ → resolves to underlying `T` | `type-resolution.ts:391`. |
| `NonNullable<T>` | ✅ → inner type | |
| `ReturnType`/`Parameters`/`InstanceType`/`Extract`/`Exclude` | 🟡 → `auto` | `:413`. |

---

## 2. Control Flow

Implemented in `transformers/control-flow.ts`; tested in `tests/control-flow.test.ts`.

### 2.1 Conditionals

| Pattern | Status | Notes |
|---|---|---|
| `if` | ✅ | |
| `if / else` | ✅ | |
| `if / else if / else` chains | ✅ | |
| Nested `if` | ✅ | |
| Ternary `a ? b : c` | ✅ | Return type inferred from both branches. |
| Nested ternary | ✅ | |
| Ternary with string vs numeric branches | ✅ | Promotes to `std::string` or `double` accordingly. |

### 2.2 Loops

| Pattern | Status | Notes |
|---|---|---|
| `for (let i; cond; inc)` C-style | ✅ | |
| `for (const i; ...)` | ✅ | |
| Infinite `for (;;)` | ✅ | `tests/control-flow.test.ts:275`. |
| `for...of` over array | ✅ | Element type resolved for class arrays (`->` access). |
| Nested `for...of` | ✅ | |
| `for...in` over object keys | ✅ | Keys enumerated at IR build time (`extractForInKeys`). |
| `while` | ✅ | |
| `while` with `break`/`continue` | ✅ | |
| `do...while` | ✅ | |
| Infinite `while (true)` | ✅ | |
| **`for await...of`** (async iteration) | ❌ | Requires runtime async machinery absent on bare metal. |

### 2.3 Branch control

| Pattern | Status | Notes |
|---|---|---|
| `break` | ✅ | |
| `continue` | ✅ | |
| `break` in switch | ✅ | |
| Labeled break `outer:` | ✅ | `tests/control-flow.test.ts:497`. |
| Labeled continue | ✅ | |
| Labeled statement (general) | ✅ | `control-flow.ts:554`. |
| Empty statement `;` | ✅ | Silently skipped. |
| Standalone block `{ ... }` | ✅ | |

### 2.4 `switch`

| Pattern | Status | Notes |
|---|---|---|
| `switch` with cases | ✅ | `control-flow.ts:415`. |
| `default` | ✅ | |
| Switch without default | ✅ | |
| Multiple statements per case | ✅ | |
| Variable in case expression | ✅ | |
| Nested switch | ✅ | |
| Fall-through (no `break`) | 🟡 | Emitted verbatim — C++ fall-through matches TS, but no diagnostic warns about it. |
| String `switch` | 🟡 | Works only if discriminator lowers to an integral/string-comparable form. |

### 2.5 Exceptions

Validated by `try-catch-validation.ts`. C++ exceptions are **disabled** on AVR (`-fno-exceptions`).

| Pattern | Status | Notes |
|---|---|---|
| `try / catch` on **native/ESP32** targets | ✅ | IR-lowered and emitted. |
| `try / catch` on **AVR** | ❌ → `try-catch-unsupported` **error** | Hard compile failure on AVR. Use return-code error checking. `try-catch-validation.ts:51`. |
| `try / catch / finally` | ✅ (where exceptions enabled) | |
| `throw` on AVR | ❌ → error | Same rationale. |
| `throw` on native/ESP32 | ✅ | |
| Custom error classes / `Error` subclass | 🚫 | No meaningful C++ exception hierarchy mapping. |

**Rationale:** exceptions require runtime support and heap that AVR cannot provide. This is a
platform-driven **by-design** restriction, not a transpiler limitation.

### 2.6 Async & concurrency

| Pattern | Status | Notes |
|---|---|---|
| `async function` | 🟡 | Adds `async_stub` boilerplate + `TS2CPP_ASYNC_STUB` warning; **semantics approximate** — there is no event loop on bare metal. `function-builder.ts:191`. |
| `await expr` | 🟡 | Await stripped, expression emitted inline. `tests/functions.test.ts:220`. |
| `await` on a statement | ✅ → call statement | |
| `Promise`, `Promise.all`, `.then` | 🚫 | No promise runtime. Avoid in firmware. |
| `function*` generator | 🟡 | Tracked (`isGenerator`), `yield` lowers to `co_yield`, but **no coroutine runtime** is wired for AVR — effectively unusable. |
| `yield` / `yield*` | 🟡 → `co_yield` | Same caveat. `expression-to-ir.ts:1675`. |

**Verdict:** async/generators are recognized for parse-compatibility but cannot produce correct
firmware behavior. Treat any async code as **never truly supported** for embedded targets.

---

## 3. Functions

Implemented in `function-builder.ts`; tested in `tests/functions.test.ts`.

### 3.1 Declarations

| Pattern | Status | Notes |
|---|---|---|
| `function f() {}` declaration | ✅ | |
| Named function expression `const f = function() {}` | ✅ | Via `variableAsFunctionToIR`. |
| Arrow function `const f = () => {}` | ✅ | |
| Arrow with expression body `() => x + 1` | ✅ | |
| Anonymous declaration export | ❌ | `function-builder.ts:183` — anonymous function declaration unsupported. |
| Nested function declaration | ✅ | Hoisted to file scope with mangled name `parent__inner`. |
| Nested class inside function | ✅ | Hoisted similarly. |
| Recursion | ✅ | `tests/functions.test.ts:340`. |
| Function hoisting (sibling calls) | ✅ | Two-phase pre-scan registers aliases. |
| `export function` | ✅ | |
| `export default function` | ✅ | |

### 3.2 Parameters

| Pattern | Status | Notes |
|---|---|---|
| Primitive params | ✅ | |
| Multiple params | ✅ | |
| Default param `function f(a = 5)` | ✅ | Default goes on prototype, not later definition (CLAUDE.md). |
| Rest param `function f(...xs: number[])` | ✅ → `std::vector<T>` | `restParamFunctions` tracking. `tests/transpiler-type-gaps.test.ts:759`. |
| Object destructure param `f({ a, b })` | ✅ | Synthetic `__param_N` + extraction. |
| Nested object destructure param | ✅ | |
| Array destructure param `f([a, b])` | ✅ | |
| Mixed destructure + regular params | ✅ | |
| `this` parameter (typed) | 🟡 | Recognized loosely; `this` semantics are class-based in C++. |

### 3.3 Return types & overloads

| Pattern | Status | Notes |
|---|---|---|
| Annotated return type | ✅ | |
| Inferred return type | ✅ | Multi-pass inference in `buildFunctionReturnTypeMap`. |
| Multiple `return`s with differing types | ✅ | Widened (e.g. `int` + `float` → `double`). |
| Early return | ✅ | |
| Return type with ownership wrapper | ✅ | |
| **Function overloads** | 🟡 | Overload *signatures without bodies* are skipped (`function-builder.ts:180`); only the implementation emits. TS overloads do not map to C++ overloading cleanly — return-type-based dispatch is lost. |
| Variance / currying / partial application | 🚫 | No C++ equivalent that composes sensibly. |

### 3.4 Higher-order functions & closures

| Pattern | Status | Notes |
|---|---|---|
| Passing function as argument | ✅ → `std::function<...>` | Function type aliases lower via `functionTypeNodeToCppType`. |
| Returning a function | ✅ | |
| Function type alias `type Fn = () => void` | ✅ → `std::function<void()>` | |
| Class method as callback | ✅ | |
| `Math.method` callbacks (e.g. comparator) | ✅ | |
| **Closures capturing outer variables** | 🟡 | Arrow/function expressions lower to lambdas, but capture semantics (`[=]` vs `[&]`) are not faithfully modeled. Captured-mutation patterns are unreliable. |
| IIFE `(function(){})()` | ✅ | Lowered as an inline call. |

### 3.5 `forEach` inline expansion

| Pattern | Status | Notes |
|---|---|---|
| `arr.forEach(fn)` as statement | ✅ → inlined `for` loop | `statement-to-ir.ts:70`. Requires known array size. |
| `forEach` with arrow expression body | ✅ | |
| `forEach` with block body | ✅ | |

---

## 4. Classes & OOP

Implemented in `declaration-builders.ts` and `function-builder.ts` (`hoistNestedClass`);
tested in `tests/classes.test.ts` and `tests/class-reference-semantics.test.ts`.

### 4.1 Class structure

| Pattern | Status | Notes |
|---|---|---|
| `class C {}` empty | ✅ | |
| Class with public/private/protected fields | ✅ | Visibility maps to C++ access sections. |
| Class with field initializers | ✅ | |
| Class with `readonly` fields | ✅ | |
| Class with `static` fields/methods | ✅ | |
| Static initializer block `static { ... }` | ✅ | Folded into synthetic constructor (`declaration-builders.ts:395`). |
| Optional class field `x?: T` | ✅ → `T` (optionality dropped) | |
| Generic class `class C<T>` | ✅ | |
| Nested class (inside function or class) | ✅ | Hoisted with mangled name. |
| `export class` / `export default class` | ✅ | |

### 4.2 Constructors & `this`

| Pattern | Status | Notes |
|---|---|---|
| `constructor()` | ✅ | |
| Constructor default param | ✅ | |
| Constructor parameter property `constructor(public x: number)` | ✅ | Generates field + param. `function-builder.ts:690`. |
| `this.field = value` assignment | ✅ | `tests/transpiler-type-gaps.test.ts:596`. |
| `this.x += value` compound | ✅ | |
| `this` reference | ✅ → `this->` | |
| **`this` in free function** | ❌ | No C++ equivalent; not modeled. |

### 4.3 Methods

| Pattern | Status | Notes |
|---|---|---|
| Instance method | ✅ | |
| Private/protected method | ✅ | |
| Static method | ✅ | |
| Method calling free function | ✅ | `tests/classes.test.ts:516`. |
| Getters `get x()` | ✅ | `tests/new-features.test.ts:13`. |
| Setters `set x(v)` | ✅ | |
| Getter/setter pair | ✅ | |
| Static getter/setter | ✅ | |
| Abstract method | ✅ (recorded) | `= 0` pure virtual emitted for abstract methods. |

### 4.4 Inheritance & polymorphism

| Pattern | Status | Notes |
|---|---|---|
| `class B extends A` | ✅ | `extendsClass` recorded. |
| `super()` call | ✅ → C++ initializer list | `tests/classes.test.ts:149`. Body `super()` is NOT emitted as a statement. |
| `super` with args | ✅ | |
| `super.method()` | 🟡 | `super` keyword lowers to base class name (`expression-to-ir.ts:1663`); works for simple cases. |
| Virtual method override (polymorphism) | 🟡 | Methods are emitted; virtual-ness is inferred heuristically, not always correct. |
| Virtual destructor on polymorphic base | ✅ | `tests/classes.test.ts:298`. |
| **Multiple inheritance** | ❌ | Not modeled. |
| **Mixins** | ❌ | No meaningful single-inheritance lowering. |
| Abstract class with abstract methods | ✅ | |

### 4.5 Reference vs value semantics

This is a **deliberate design choice** with extensive test coverage
(`tests/class-reference-semantics.test.ts`, `tests/classes.test.ts:221`).

| Pattern | Status | Notes |
|---|---|---|
| `new C()` returns a pointer | ✅ → `C*` | TypeScript class instances are **always references**; the transpiler models this by emitting `C*` (never value `C`) so `new X()` is never assigned to a value-typed C++ object (`type-resolution.ts:420`). |
| Field of class type initialized with `new X()` | ✅ → pointer field | |
| Local `let s = this.pointerField` | ✅ → propagates pointer type | `tests/classes.test.ts:414`. |
| Deep access chain `a.b.c.d` | ✅ → uses `->` through pointer chain | |
| `for (const item of classArray)` | ✅ → `item->field` | |
| Constructor param promoted to pointer | ✅ | When assigned to a class-typed field. |
| Borrowed constructor param (not deleted) | ✅ | Ownership analysis avoids deleting borrowed params. |

### 4.6 Ownership wrappers

Phantom types `Owned<T>`, `Shared<T>`, `Mutable<T>` (see `docs/ownership/`) drive ownership
analysis. They are erased at emit time but influence destructor/deletion decisions.

| Pattern | Status | Notes |
|---|---|---|
| `Owned<T>` field | ✅ | Destructor deletes it. |
| `Shared<T>` field | ✅ | Not deleted. |
| `Mutable<T>` field | ✅ | |
| Wrapper detection before alias resolution | ✅ | `type-resolution.ts:216` — critical so `type Shared<T> = T` does not hide the wrapper. |

### 4.7 Decorators & namespaces

| Pattern | Status | Notes |
|---|---|---|
| Class decorator `@dec class C` | 🟡 | Decorator **names** are captured (`declaration-builders.ts:399`) but no transformation is applied — they are informational only. |
| Method/property/parameter decorators | ❌ | Not captured. |
| Decorator factories `@dec(arg)` | 🟡 | Name captured only. |
| `namespace X {}` | ✅ | Members accessed via `X::`. `namespace-builder.ts`. |
| Enum inside class | ✅ (hoisted) | |
| Interface inside class/function | ✅ (hoisted) | |
| Type alias inside class/function | ✅ (hoisted) | |

---

## 5. Appendix: Expressions & Stdlib

### 5.1 Operators

| Pattern | Status | Notes |
|---|---|---|
| Arithmetic `+ - * / %` | ✅ | |
| Comparison `== != < > <= >=` | ✅ | `===`/`!==` lower to `==`/`!=`. |
| Logical `&& \|\| !` | ✅ | |
| Bitwise `& \| ^ ~ << >>` | ✅ | `tests/expressions.test.ts:642`. |
| Compound assignment `+= -= *= /= %=` | ✅ | |
| Bitwise assignment `&= \|= ^= <<= >>=` | ✅ | `tests/statements.test.ts:145`. |
| `||=`, `&&=`, `??=` | ✅ | |
| Prefix/postfix `++ --` | ✅ | |
| Comma operator `(a, b)` | ✅ → C++ comma expr | `expression-to-ir.ts:1641`. |
| Unary `-x`, `+x`, `!x` | ✅ | |
| `delete obj.key` | ✅ on map/set/vector → `erase` | ❌ on other types (`expression-to-ir.ts:1637`). |
| `void expr` | 🟡 | |
| Exponentiation `**` | 🟡 → may need `pow()` | Not a first-class operator in emit. |
| **`new.target`, `import.meta`** | ❌ | Meta-properties unsupported (`:1655`). |

### 5.2 `Math.*`

| Pattern | Status | Notes |
|---|---|---|
| `Math.floor/ceil/round/abs/sqrt/sin/cos/tan/atan2/log/exp/pow/fmod` | ✅ → `std::...` | Return type inferred as `double`. |
| `Math.min/max` | ✅ | Return type follows operands. |
| `Math.random` | ✅ → `__tc_random()` | |
| `Math.PI`, `Math.E`, constants | ✅ → `std::`/literal | |

### 5.3 Array & string methods

`transformers/array-methods.ts` and `ALL_STRING_METHODS` in `expression-to-ir.ts:349`.

| Pattern | Status | Notes |
|---|---|---|
| `push`, `pop` | ✅ | Promotes to `StaticArray`. |
| `indexOf`, `lastIndexOf`, `includes` | ✅ | |
| `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `concat`, `slice`, `join` | ✅ | Recognized in typeof context and lowered where supported. |
| `map`, `filter`, `reduce`, `find`, `findIndex`, `every`, `some`, `forEach` | ✅ | `forEach` inlines; functional methods lower via `tryLowerArrayAndStringMethods`. `reduce` requires an init (`TS2CPP_REDUCE_NO_INIT` otherwise). |
| `.length` on array/string/typed-array | ✅ | Context-aware (`resolveLengthProperty`). |
| String methods `toUpperCase`, `toLowerCase`, `trim`, `replace`, `charAt`, `charCodeAt`, `substring`, `slice`, `endsWith`, `startsWith`, `padStart`, `padEnd`, `repeat`, `split`, `toString` | ✅ | All in `ALL_STRING_METHODS` set. |
| `parseInt`, `parseFloat` | ✅ | `expression-to-ir.ts:664`. |

### 5.4 `Object.*` and container ops

| Pattern | Status | Notes |
|---|---|---|
| `Object.keys(map)` | ✅ → `__tc_mapKeys` | ❌ on non-map → `TS2CPP_UNSUPPORTED_EXPR` (`:731`). |
| `Object.values(map)` | ✅ → `__tc_mapValues` | ❌ on non-map (`:743`). |
| `Object.entries(map)` | ✅ → `__tc_mapEntries` | ❌ on non-map (`:749`). |
| `Object.keys(plainStruct)` | 🟡 | Only when literal field names are statically known. |
| `Object.assign`, `Object.freeze`, `Object.fromEntries` | ❌ | Not lowered. |
| `JSON.*` | ❌ | No JSON runtime on bare metal. |

### 5.5 HAL / hardware-specific

These are **first-class** (this is the project's primary purpose) — see `docs/hal/`.

| Pattern | Status | Notes |
|---|---|---|
| `new Pin(n)`, `new I2CBus(...)`, `new SPIBus(...)`, `new SerialPort(...)` | ✅ | Resolved by `hal-resolver.ts`; emitted as HAL ops. |
| Pin factory functions `createDigitalPin(...)` etc. | ✅ | Constant-folded at compile time. |
| `pin.read()`, `pin.write()`, bus methods | ✅ | Lowered to HAL emit lines. |
| `spi.device(cs).transfer(...)` | ✅ → Arduino-safe SPI call | |
| `registerPlatformStrategy(...)` | ✅ | Compile-time only, erased. |

---

## 6. Appendix: Module structure

### 6.1 Top-level file model

| Pattern | Status | Notes |
|---|---|---|
| Free functions emit as C++ free functions | ✅ | Prototypes hoisted before `setup()` when called from top-level (CLAUDE.md). |
| Top-level statements flow into `setup()` | ✅ | |
| `setup()` / `loop()` Arduino entry points | ✅ | |
| Split-file emission (non-entry files) | ✅ | Helpers/nullish defs conditionally included. |
| Source maps (C++ → TS error mapping) | ✅ | |
| `.ino` sketch flattening for Arduino | ✅ | |

### 6.2 Imports / exports

| Pattern | Status | Notes |
|---|---|---|
| `import { x } from "./local"` | ✅ | Resolved + inlined. |
| `import x from "./local"` (default) | ✅ | |
| `import { x } from "npm-pkg"` | ✅ | Resolved through `node_modules`/monorepo. |
| `import @typecad/expect` | ✅ | Preprocessed for test harness. |
| `export` / `export default` | ✅ | |
| Native `.d.ts` + `.cpp` binding pairs | ✅ | `detectNativeCppModule`. |
| Dynamic `import()` | ❌ | No runtime loader on bare metal. |
| `require()` | ❌ | |
| Re-exports `export * from` | 🟡 | Resolved at graph build; complex cycles may misbehave. |

---

## 7. Triage guide

Use this when a report comes in. Find the closest row above, then:

1. **✅ Supported + behavior is wrong** → **Bug.** File with a minimal repro against emitted C++.
   The expected output is defined by the cited test.
2. **🟡 Partial + the documented approximation is violated** → **Bug** (e.g. `??` lowering
   `0` to fallback would violate the `cuttlefish_nullish` contract).
3. **🟡 Partial + a pattern isn't lowered at all** → **Feature request.** Route to the Future
   backlog.
4. **⚠️ Future** → **Not a bug.** Acknowledge and link this doc.
5. **❌ Unsupported by design** (emits `TS2CPP_UNSUPPORTED_*`) → **Wontfix.** The diagnostic is
   the intended behavior.
6. **🚫 Never** → **Wontfix, permanent.** These violate a language/platform invariant and
   supporting them would require an alternate runtime (e.g. a JS engine on the MCU).

### Recurring "never" themes

- **Anything needing a JS runtime:** `Promise`, JSON, `eval`, dynamic `import`, reflection,
  iterators as first-class values.
- **Anything needing heap-rich runtime:** deep promise graphs, large closures with capture.
- **Anything needing RTTI/type metadata at runtime:** `instanceof` across user hierarchies,
  structural type branding.
- **AVR-only:** exceptions (`try/catch/throw`), heavy STL, coroutines.

### Recurring "non-obvious lowering decision" themes

These are 🟡/⚠️ rather than ✅ because the *right* C++ output is debatable:

- **Optional representation** — sentinel vs `std::optional` (RAM cost on AVR).
- **Number width** — TS `number` is `double`; users may want `uint8_t`. Auto-narrowing risks
  silent overflow bugs.
- **Class value vs reference** — currently always `T*`. Value semantics would change copy cost.
- **Closure capture** — `[=]` vs `[&]` vs heap capture.
- **Async semantics** — cooperative scheduler vs none vs RTOS.
- **Function overload dispatch** — TS picks by types; C++ can't always mirror.

When extending the transpiler in any of these areas, document the chosen lowering here and add
a test pinning the behavior.

---

## 8. Maintaining this document

- **When adding support for a new pattern:** update the relevant row from ❌/⚠️ to ✅ and cite
  the new test.
- **When a pattern is deliberately rejected:** add it with status ❌ and the diagnostic code.
- **When behavior changes semantics:** update the Notes column and any cited CLAUDE.md
  convention.
- Keep row order stable within a section — tests and issues reference patterns by name.
- This file lives at the repo **root** (`/SUPPORT_MATRIX.md`) so it is visible from any
  package's working tree.
