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
- ❌ **Unsupported by design** — rejected by the transpiler or lint gate with a source-located diagnostic.
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
| `"literal"` | ✅ | A string literal is escaped via the shared `escapeCppStringLiteral` helper (handles `\`, `"`, `\n`, `\r`, `\t`) on EVERY rendering path — the standalone expression renderer (`renderExprAsText`, used for method-call arguments), the snprintf `%s` format-arg path (`expression-renderer.ts` `inferFormatSpecifier`), the async state-machine renderer, debug logpoints, and HAL parameter defaults. Demo #29 fix A (`ir/render-expr.ts`) and its sibling scan — previously each renderer had its own inline partial escape (quote-only, or quote+backslash), so a literal containing a control char or backslash that flowed through any of them emitted a RAW control char inside the C++ string literal, producing an unterminated literal that corrupted lexing of the rest of the file. All sites now route through the one shared helper. Pinned by `tests/packages/transpiler/demo-29-regressions.test.ts` (A + sibling cases). |
| Empty string `""` | ✅ | |
| String + string concat | ✅ | Lowers to `snprintf` on all targets (unified concat path — native and Arduino/AVR share one snprintf-based lowering so enums, floats, and objects never hit `std::to_string`). `tests/expressions.test.ts:198`. |
| String + number concat | ✅ | |
| String + boolean concat | ✅ | |
| Template literal `` `x = ${a}` `` | ✅ | Lowers to stack `char[]` + `snprintf`, preserving TS var names (CLAUDE.md convention). The format specifier (`%d`/`%s`/`%lld`/`%f`) and `.c_str()` for `std::string` operands are inferred from each interpolation's resolved C++ type. **Demo #18 fix C** — interpolating a **struct field** (e.g. `${a.id}`, `${a.name}`) inside a class method now infers the correct specifier from the field's *declared* type, not a value-inferred/strategy-normalized one. Previously, emitting a named-typed object literal (`const a: Account = {...}`) clobbered the interface's authoritative field-type map with inferred types that — after the native `normalizeCppType` (`int`→`long long`) — collapsed every field to `long long`, silently producing `%lld` for everything and omitting `.c_str()` for strings. The object-literal emitter no longer overwrites an existing declared field-type entry. `tests/packages/transpiler/demo-18-regressions.test.ts` (Finding C). |
| Nested template literals / complex `${}` | ✅ | |
| **Tagged template** `` tag`...` `` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). There is no meaningful C++ lowering for a tag function; use an untagged template literal or string concatenation. |
| `string` type → `std::string` everywhere | ✅ | On Arduino/AVR `std::string` is normalized to the `__tc_str_ptr` fixed-buffer shim at emit time (`strategy.normalizeCppType`). **Demo #33 Finding C** — the `usesStrPtr` analysis flag (which gates emission of the `__tc_str_ptr` shim block) compared the PRE-normalization cppType (`std::string`) against `parseCppType(...).kind === "strPtr"`, which never matched, so a string-typed RETURN/FIELD/LOCAL silently dropped its own shim and avr-g++ failed ("'__tc_str_ptr' does not name a type"). The `declaredTypes` post-process loop (the single broadest chokepoint over every declared type) now resolves `std::string` through `strategy.normalizeCppType` and sets `usesStrPtr` when the strategy maps it to `__tc_str_ptr`. `ir/program-analysis.ts`. Pinned by `tests/packages/transpiler/demo-33-regressions.test.ts` (C). |

### 1.5 Arrays & collections

| Pattern | Status | Notes |
|---|---|---|
| `number[]` | ✅ → `std::vector<double>` | `type-resolution.ts:288`. |
| Array index access `arr[i]` | ✅ | Scaffold **does not** enable TS's `noUncheckedIndexedAccess` — that flag would force an unverified `arr[i]!` assertion on every index read (the assertion is unchecked, so it carries no real OOB safety). The transpiler's emitted storage is always-dense (`std::vector` built by `push_back`/literals), and idiomatic indices are bounded by `.length` by construction, so the flag adds friction with ~zero payoff here. `strict` + `strictNullChecks` remain on (genuine null/undefined holes are still caught). For runtime OOB safety — which no source flag can provide — use UBSAN/ASAN on the emitted binary. Projects that want the stricter mode can re-enable it locally. Demo #26 Finding A. |
| `Array<T>` | ✅ → `std::vector<T>` | `:293`. |
| `ReadonlyArray<T>` | ✅ → `std::vector<T>` (const-ness dropped) | `:367`. On Arduino, readonly arrays at top level may emit as C-style arrays (CLAUDE.md). |
| `new Uint8Array([...])`, `Int16Array`, etc. | ✅ → C-style `uint8_t[]` (function-local only) | `TYPED_ARRAY_ELEMENT_MAP`. `tests/transpiler-type-gaps.test.ts:68`. Typed arrays lower to a **function-local stack array** — the only storage class with a valid initializer and recoverable length. See the three ❌ rows directly below for the storage classes that do *not* lower. |
| `new Float32Array(n)` zero-init | ✅ (function-local) | Emits `uint8_t[N]` with N zero-filled cells when N is a compile-time integer in [1, 256]. |
| Typed array type annotation → pointer (`uint8_t*`) | ✅ for locals/params only | A *local* `const buf: Uint8Array = new Uint8Array(n)` lowers to a stack `uint8_t[]` (value storage). A typed-array **parameter** lowers to a `uint8_t*` parameter. A typed-array **field** does not lower — see the ❌ row below. |
| `.length` on local typed array | ✅ → `sizeof(arr)/sizeof(arr[0])` | `tests/transpiler-type-gaps.test.ts:352`. `.length` on a typed-array **parameter** is a **build error** (`TS2CPP_TYPED_ARRAY_PARAM_LENGTH`) because the pointer-like C++ parameter does not carry length; pass length explicitly. |
| Typed array as a **class field** (`private buf: Uint8Array`) | 🚫 | **Build error** (`TS2CPP_TYPED_ARRAY_FIELD`) and lint error (`cuttlefish/no-typed-array-field`). A field needs owned, copyable storage with a valid initializer, but a typed array lowers to pointer-like storage (`uint8_t*`) whose `new Uint8Array(N)` initializer lowers to a brace-init-list that cannot initialize a pointer, and the field has no `new[]`/`delete[]` lifecycle. This is the same ownership boundary as `TS2CPP_TYPED_ARRAY_RETURN` / `TS2CPP_TYPED_ARRAY_PARAM_LENGTH`: typed arrays are supported only as function-local stack buffers. **Workaround:** store the buffer in a `number[]`/`int8_t[]` field (a `std::vector` that owns its storage), or use a function-local typed array for a transient stack buffer. Demo #21 Finding C. |
| Array literal `[1, 2, 3]` | ✅ | Element type inferred from contents. |
| Spread in array `[...a, b]` | ✅ | `tests/transpiler-type-gaps.test.ts:392`. |
| Mutable array methods (`push`/`pop`/`indexOf`) | ✅ | Promotes backing storage to `StaticArray` (`ARRAY_METHODS_REQUIRING_STATIC_ARRAY`). |
| `[T]` tuple type | ✅ → `std::tuple<T>` | `type-resolution.ts:374`. Demo #8 fix F — a type alias to a tuple/container (`type P = [K, V]`) now survives tree-shaking and emits a `using` (was dropped because the resolved cppType contained no identifier for the call graph to see). **Caveat:** tuple *literals* (`const t: Tuple = ['a', 1]`) lower to a C array, not a `std::tuple` constructor — return an interface for tuple values. |
| `Map<K,V>` / `ReadonlyMap` | ✅ → `std::map<K,V>` | `new Map()` lowers to `{}` (empty); `new Map([[k, v], ...])` (the idiomatic constructor-with-initial-entries form) renders the entries into a brace-init-list `{ {k, v}, ... }` (the `std::initializer_list<std::pair>` form `std::map`'s ctor accepts). Demo #30 fix E (`ir/expression-to-ir.ts`) — previously the initializer argument was DROPPED and every `new Map(...)` lowered to `{}`, so a `const m = new Map([...])` started empty. Pinned by `tests/packages/transpiler/demo-30-regressions.test.ts` (E). |
| `Map.get(k)` / `map.get(k)!` | ✅ → `m.at(k)` | Const-correct `std::map::at` (has a `const` overload, throws on miss) — NOT `operator[]`, which is non-const (fails on a `const`-bound Map) and silently inserts a default on a miss. The idiomatic `map.get(k)!` asserts presence, matching `.at()`'s contract. Comparing `.get()`/`.at()` to `null`/`undefined` or using it as the left side of `??` is a **build error** (`TS2CPP_GET_NULLISH_COMPARE`); use `.has(key)` first or return an explicit presence/value struct. Demo #15 fix B (`ir/expression-to-ir.ts`). |
| `Map.set(k,v)` | ✅ → `(m[k] = v)` | Statement form lowers to an `assign` with target `m[k]`. An **enum-typed key** (`k: K`) on an integral-keyed `Map` is cast to the key type in BOTH statement and expression form (`m[static_cast<int32_t>(k)] = v`) — a C++ `enum class` does not implicitly convert to the integral key. Demo #28 fix E review (`ir/transformers/call-statement.ts` + `ir/expression-to-ir.ts`). |
| `Map.has(k)` / `Set.has(k)` | ✅ → `m.count(k) > 0` | |
| `Map.delete(k)` / `Set.delete(k)` | ✅ → `m.erase(k) > 0` | |
| `Map.values()` / `.keys()` / `.entries()` | ✅ → `__tc_mapValues` / `__tc_mapKeys` / `__tc_mapEntries` | Lowered to the same runtime helpers as `Object.values(map)` (defined in `framework-native/src/strategy.ts`), returning `std::vector<V>`/`<K>`/`<std::pair<K,V>>`. A `for...of` therefore iterates the **values/keys/pairs**, not the raw `std::pair` entries of the underlying `std::map`. Demo #15 fix A (`ir/expression-to-ir.ts`). Native only (helpers are `std::vector`/`std::map` based). |
| `Set.values()` / `.keys()` / `.entries()` | ✅ → `__tc_setValues` / `__tc_setEntries` | `values()`/`keys()` both yield the elements; `entries()` yields `pair<elem,elem>`. Demo #15 fix A. Native only. |
| `Map.size` / `Set.size` | ✅ → `static_cast<long long>(m.size())` | `std::map`/`std::set` expose size as a METHOD (`m.size()`), not a member, so `.size` is mapped to a method call. Works on bare-identifier receivers AND `this.field`/`obj.field`/element-access receivers — the receiver type is resolved via the shared `resolveExprCppType`, mirroring the `.length` → `.size()` lowering. Demo #29 fix C (`ir/expression-to-ir.ts`) — previously only bare-identifier receivers were handled, so `this.values.size` on a `Map` field emitted the bare member `this->values.size` (g++: "has no member named 'size'"). Pinned by `tests/packages/transpiler/demo-29-regressions.test.ts` (C). |
| `Set.add(k)` | ✅ → `s.insert(k)` | |
| Mutating a struct fetched via `Map.get()` / `map[key]` | 🚫 (interface/struct values) · ✅ (class values) | **Build error** (`TS2CPP_MAP_VALUE_COPY_MUTATION`) and lint error (`cuttlefish/no-map-struct-mutation`) — but **only for value-typed (`interface`/object-literal) entries**. There is no TS→C++ reference binding for a *value* type: `const t: Task = map.get(k)` lowers to `const Task t = map.at(k)` — a VALUE copy of the element, so mutating `t.field` is silently lost (and on a `const` binding is a hard g++ error). **Class-typed entries are exempt:** a TS `class` is a reference type that lowers to a C++ pointer (`Entry*`, §4.5), so `const e: Entry = map.get(k)` lowers to `Entry* e = map.at(k)` and `e.field = v` lowers to `e->field = v` — the mutation persists through the pointer. The gate resolves the value type via the TypeChecker and skips class instances (`isClassInstanceType`). **Workaround (for interface values):** keep mutable per-entry state in a separate primitive `Map<K, V>` and `.set()` it back, or replace the whole struct entry with `.set(key, nextValue)`. Demo #14 Finding C; class exemption added by demo #25 Finding A (`orchestrator/semantic-facts.ts` `isClassInstanceType`). |
| `const`-bound `Map`/`Set` mutated via `.set()`/`.add()`/`.delete()`/`.clear()` | ✅ (auto-demoted, scope-local) | TS permits this (`const` binds the reference, not the contents), but the emitted `const std::map`/`std::set` rejects these mutators, so the binding is **demoted to non-const** with an `ownership-const-content-mutated` info diagnostic (`ir/ownership-analysis.ts`). Demotion is resolved **per lexical scope** (each function body walked in a single combined pass with scope-local maps), so a mutation in one function never demotes a same-named `const` in a sibling function (demo #16 fix B). The demotion walk now reaches **class methods, getters, setters, constructors, and namespace-scoped functions** (not just top-level statements and free `function`s) — demo #17 fix. The ESLint rule **`no-mutating-method-on-const-collection`** (warn) surfaces it at lint time so the author can use `let` to express intent. Demo #15 fix C + demo #16 fix B + demo #17. |
| `Set<T>` / `ReadonlySet` | ✅ → `std::set<T>` | `new Set()` lowers to `{}` (empty); `new Set([a, b, c])` (the idiomatic constructor-with-initial-elements form) renders the elements into a brace-init-list `{ a, b, c }` (the `std::initializer_list<T>` form `std::set`'s ctor accepts). Demo #30 fix E (`ir/expression-to-ir.ts`) — previously the initializer argument was DROPPED and every `new Set(...)` lowered to `{}`, so a `const STOP = new Set([...])` started empty. Pinned by `tests/packages/transpiler/demo-30-regressions.test.ts` (E). |
| `Record<K,V>` | ✅ → `std::map<K,V>` | |
| 2D arrays `T[][]` | ✅ native/ESP32 · 🚫 AVR | Lowered as `std::vector<std::vector<T>>`. Indexed read/write through a class field (`this->cells[r][c]`), nested `for` loops over `g[i].length`, double-buffered `cur`/`nxt` swap (`const tmp = this.cur; this.cur = this.nxt; this.nxt = tmp;` — a 3-way value swap, semantically correct, just 3 deep copies instead of `std::swap`), and `for...of` over the outer vector all lower and run correctly. Demo #32 (Conway's Game of Life on a toroidal `uint8_t[][]` grid) is the first demo to exercise this shape. **On AVR a function-local `T[][]` mis-resolves the inner element to a scalar and lowers to `std::vector<T>[]`, which has no valid C++ on a no-`<vector>` target.** The StaticArray promotion does not recurse into nested arrays. **AVR workaround:** use parallel flat arrays (`xs[]`, `ys[]`) or a flat struct array on AVR. Pinned by `tests/packages/transpiler/demo-32-regressions.test.ts` and `destructuring-regressions.test.ts`. |
| **AVR array storage** (class field / param / return typed `T[]`) | 🚫 on AVR · ✅ on native/ESP32 | **Build error on no-`std::vector` architectures** (`TS2CPP_NO_VECTOR_STORAGE`, `framework-arduino/src/strategy.ts` `profileDiagnostics`). AVR (ATmega328P) ships no `<vector>` and discourages heap allocation, so a class FIELD, function PARAMETER, or RETURN TYPE annotated `T[]` / `Array<T>` — which resolves to `std::vector<T>` — has no valid lowering. A function-LOCAL array initialized from a literal is exempt: it lowers to a fixed-size `__tc_StaticArray<T,N>` / raw C array (the literal supplies N). **Workaround:** keep dynamic collection storage function-local (initialized from a literal), use a `Map`/`Set` for keyed storage, or model owned state as a class with SCALAR fields. This is the family-wide gate for "dynamically-grown array storage is not supportable on a no-heap / no-STL target"; without it the transpiler emitted `std::vector<T>` and avr-g++ failed with an opaque "'vector' in namespace 'std' does not name a template type". Demo #33 (first AVR demo) Finding E. Pinned by `tests/packages/transpiler/demo-33-regressions.test.ts` (E). |
| Associative array access `obj["key"]` | ✅ when target is `std::map`/`Record` | Dynamic string-key access on fixed-shape structs/interfaces is a **build error** (`TS2CPP_DYNAMIC_OBJECT_KEY`); use `obj.field` for fixed fields or `Map<string, T>` / `Record<string, T>` for dynamic keys. |
| Heterogeneous array literal `[1, "a"]` | 🚫 | **Build error** (`TS2CPP_HETEROGENEOUS_ARRAY`). The semantic-gate pass (`orchestrator/type-checker.ts runSemanticGates`) detects array literals whose elements resolve to >1 incompatible kind (numeric vs string vs object) and aborts the build with a source-located `Diagnostic`. Numeric/bool widening is accepted (`[1, true]` → `std::vector<int>`). Declare an explicit tuple type (`[number, string]`) for intentionally mixed elements — tuple contextual types are exempt. |
| `any` annotation (explicit) | 🚫 | **Build error** (`TS2CPP_EXPLICIT_ANY`). Flagged by the syntactic feature-prescan (`feature-registry.ts AnyKeyword`) on every `any` token; also enforced as an ESLint error in scaffolded projects. Use a concrete type, or `unknown` with type-guard narrowing. (`any` previously lowered silently to `auto` — now a hard error.) |

### 1.6 Objects, interfaces, type aliases

| Pattern | Status | Notes |
|---|---|---|
| Object literal `{ a: 1, b: 2 }` | ✅ | Emitted as struct initializer. `tests/expressions.test.ts:517`. |
| Object with spread `{ ...a, b: 2 }` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) and ESLint error. The previous `__spread__` lowering did not implement JS spread semantics and could produce malformed C++; construct the object field-by-field instead. |
| `interface Foo { ... }` | ✅ → C++ `struct` | `declaration-builders.ts` via `interfaceDeclarationToIR`. |
| Interface with index signature | ✅ → `std::map` field inside struct | `tests/expressions.test.ts:711`. |
| Interface with numeric keys | ✅ | |
| `type Foo = { ... }` | ✅ | Object-literal aliases emit as struct under the alias name. |
| `type Foo = SomeOther` | ✅ | Alias resolved through `resolveAliasedTypeNode`. |
| `type Foo = number` | ✅ | Resolves to mapped C++ type and emits a real `using Foo = <cpptype>;` (demo #7 fix E — the reachability pass now keeps aliases whose underlying type is concrete, so the typedef survives tree-shaking and is usable as a type name at every C++ emission site). |
| `implements Interface` | 🟡 | Recorded in IR (`implementsInterfaces`) but **not enforced** as virtual methods; struct shape is emitted. |
| `new SomeInterface()` | 🚫 | **Build error** (`TS2CPP_NEW_ON_INTERFACE`). Interfaces are type-only (no value symbol); `new IFoo()` is rejected by the semantic-gate pass (`orchestrator/type-checker.ts runSemanticGates`) before emit, resolving the target across files via the TypeChecker and a program-wide interface-name set. Only `new SomeClass()` is supported. (Previously lowered verbatim and relied on the C++ compiler to fail with an opaque message.) |
| User class/interface/enum/type alias named like a lib global (`class Node`, `interface Element`) | ❌ | **Build error** (`TS2CPP_GLOBAL_NAME_COLLISION`). A declaration whose name matches a globally-visible type from a `lib` (the DOM `Node`, `Element`, `Event`, `Document`, ...) is shadowed by that global at every unqualified use site, producing a cascade of spurious TS "duplicate identifier" / "property does not exist" errors. The gate pre-scans the program's non-user files for global names and flags each colliding user declaration with one clear, source-located diagnostic. The scaffolded `tsconfig.json` no longer ships `"dom"` in `lib` (the `console` global is declared in `cuttlefish-env.d.ts`), so new projects never pull in DOM globals; this gate is defense-in-depth for projects that add `"dom"` back. Demo #25 Finding B (`orchestrator/type-checker.ts runSemanticGates` global-name pre-scan). **Demo #27 Finding F** — the global-name pre-scan previously walked EVERY non-user program file, so a third-party `@types/*` package pulled into the TS Program from the repo-root `node_modules` (e.g. `@types/node`, loaded even when the user's tsconfig sets `"types": []`) leaked common short names (`Mode`, `CipherMode`, `Direction`, `Event`, ...) into the globals set and false-tripped the gate on idiomatic user enums. The `globalNames` loop now excludes `/node_modules/@types/` and `/packages/` (matching the adjacent `interfaceNames` filter) — but NOT TS's own `lib.*.d.ts` files (which live under `node_modules/typescript/lib/` and define the DOM globals this gate exists to catch). Pinned by `tests/semantic-gates.test.ts` (`runGatesWithAmbientTypes`). |
| Discriminated union of object literals | 🟡 → `std::variant<...>` with generated variant structs | `tests/new-features.test.ts:293`. Demo #9 — the `<variant>` include is now registered. **Caveat:** member access on a union (`m.kind`, `m.payload`) is rejected by the `TS2CPP_UNION_MEMBER_ACCESS` semantic gate (`std::variant` has no direct member access — use a struct with a discriminator field). |
| `keyof T` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). Use an enum or explicit string union/switch. |
| Indexed access type `T[K]` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). Use the concrete field type directly. |
| Conditional type `T extends U ? X : Y` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). Write an explicit alias or overload with concrete types. |
| Mapped type `{ [P in keyof T]: ... }` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). Define an explicit interface/struct. |
| Template literal type `` `${X}` `` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). Use `string` at runtime or explicit string enum values. |
| `satisfies` operator | ✅ | Type-only, erased at emit. |
| `as const` | ✅ | Type-only, erased. |

### 1.7 Enums

`enumDeclarationToIR` in `declaration-builders.ts`; string-enum detection in `statement-to-ir.ts:276`.

| Pattern | Status | Notes |
|---|---|---|
| Numeric enum `enum E { A, B }` | ✅ | `tests/enums.test.ts:6`. **Lint note:** scaffolded projects gate this to `const enum` only (`no-restricted-syntax: TSEnumDeclaration[const!=true]`) so enum members are inlined; plain `enum` transpiles but the scaffold eslint flags it. Use `const enum` in new code. Demo #15 note D. |
| Enum with explicit values | ✅ | |
| `const enum` | ✅ | |
| Mixed explicit/implicit values | ✅ | |
| String enum | ✅ → `namespace EnumName { constexpr const char* Member = "..."; }` | `type-decl-emitter.ts:60` lowers a string enum to a namespace of `constexpr const char*` so member access yields a `const char*` and `===`/concatenation behave like TS. `activeStringEnumNames` tracking. (Demo #14 fix F — the stale `TS2CPP_NO_EQUIVALENT` "no C++ equivalent" warning that contradicted this working lowering has been removed.) |
| Enum relational comparison | ✅ → wraps in `static_cast<int>` | `tests/enums.test.ts:65`. |
| Enum value as an **array index** (`GLYPHS[op]` where `op: Op`) | ✅ → `GLYPHS[static_cast<int>(op)]` | A C++ `enum class` does not implicitly convert to `size_t`, so an enum-typed vector index must be cast. Element-access rendering routes the index through `renderEnumSafeValue` (`emit/expression-renderer.ts`), which wraps numeric-enum operands in `static_cast<int>(...)` (the same path §1.10 enum relational comparisons use). Demo #28 fix E. Pinned by `tests/packages/transpiler/demo-28-regressions.test.ts` (E). |
| Enum value as a **Map/Set key** (`m.set(k, 1)` / `m.has(k)` / `m.get(k)` / `m.delete(k)` where `k: Op`) | ✅ → key wrapped in `static_cast<KeyType>(k)` | Same enum→integral conversion gap, at the Map/Set key site, in BOTH statement and expression form. Demo #28 fix E review (`ir/transformers/call-statement.ts` + `ir/expression-to-ir.ts`). |
| Enum value passed as a **call argument** to a non-enum parameter (`add(k)` where `add(n: int32_t)`) | 🟡 | A C++ `enum class` won't implicitly convert to the parameter's integral type, so `add(k)` fails at g++ time. The cast is NOT applied automatically here (it requires resolving the callee's declared parameter type — interprocedural). **Workaround:** cast at the call site (`add(k as int32_t)` erases in TS; for C++, wrap explicitly) or change the parameter to the enum type. Demo #28 fix E review — known remaining limitation. |
| Enum ↔ integral **storage boundary** (enum value stored into integral storage, OR integral storage read back into an enum) | ✅ → `static_cast` in BOTH directions | A C++ `enum class` has NO implicit conversion to OR from an integral type. The enum→int direction at a comparison/index site (rows above) was already handled, but the storage boundary — `this->cells[i] = enumVal` (enum→`uint8_t`), `const E x = arr[i]` (`uint8_t`→enum), and `row.push(enumVal)` on an integral-element vector — was not. **Demo #32 fix A** centralizes BOTH directions in a single target-type-aware `renderValueForTarget` helper (`emit/expression-renderer.ts`): enum→integral delegates to the existing `renderEnumSafeValue`; integral→enum casts to the enum type. The `assign` statement RHS and the `var_decl` initializer route through it; the `.push` IR-build path casts the raw `push_back` argument (`ir/transformers/array-methods.ts`). A shared `INTEGRAL_CPP_TYPE_RE` (`emit/utils/cpp-helpers.ts`) replaces the prior divergent inline `isNumericTarget` regex. A companion fix made `inferExpressionCppType`'s property-access branch return the enum name for a numeric-enum member access (`Cell.Dead` → `Cell`), so wrapping expressions (ternary, paren) whose branches are enum members infer to the enum and the boundary fires. Pinned by `tests/packages/transpiler/demo-32-regressions.test.ts` (A, 7 tests). |
| Enum type preserved across decls/returns | ✅ | |
| `enum` nested inside function/class | ✅ | Hoisted to file scope. |

### 1.8 Null, undefined, and optionality

| Pattern | Status | Notes |
|---|---|---|
| `T | null` / `T | undefined` | ✅ → strips nullish, emits `T` | `type-resolution.ts:254`. There is **no** `std::optional` representation; see rationale below. Demo #9 fix D — comparing a value type (vector/struct) to `null` now resolves to a compile-time `false` (was emitting `valueType == nullptr`, which is invalid). Demo #14 fix A — `return null`/`undefined` in a function/method whose return type is a struct now lowers to a value-initialized `return {};` (was emitting `return CUTTLEFISH_UNDEFINED;`/`return nullptr;`, which cannot convert to a struct type). The `ReturnIR` carries the enclosing return type; free functions AND methods annotate it. **Demo #18 fix A** — the null-comparison guard now also recognizes **interface names** (an `interface Foo` lowers to a value-typed `struct Foo`, never a pointer), so a struct returned from a function/method and stored in a local (`let s: Foo \| null = find(); s === null`) lowers to `false` instead of the invalid `s == CUTTLEFISH_UNDEFINED`. Inline-call forms (`find(id) === null`, `this.find(id) === null`) are resolved too via the callee's declared return type (`ir/expression-to-ir.ts`). `map.get(k) ?? fallback` is now rejected by `TS2CPP_GET_NULLISH_COMPARE`; guard with `.has(k)` first. |
| `T | null | undefined` | ✅ → `T` | |
| Optional field `x?: T` | ✅ → `T` (optionality not enforced at runtime) | Comparing an optional field to `null`/`undefined`, or using it as the left side of `??`, is a **build error** (`TS2CPP_OPTIONAL_FIELD_NULLISH`). Use an explicit `hasX` boolean, sentinel enum, or Map/Set membership instead. |
| Non-nullish **same-kind union** (e.g. narrowed `K.B \| K.C`, or `"+" \| "-"`) | ✅ → the single coalesced primitive type | A union whose constituents ALL canonicalize to the SAME category coalesces to that category — a narrowed enum-member union (`t.kind` after `if (t.kind === K.A)`) lowers to the enum's single integral type, and a same-kind string-literal union lowers to a single `std::string`. Both are the natural result of TS control-flow narrowing and lower cleanly, so they must NOT trip the `TS2CPP_UNCLASSIFIABLE_TYPE` verifier. Demo #22 Finding C — previously any non-nullish union fell through to `"unknown"` and emitted a false-positive warning; `canonicalize()` (`orchestrator/semantic-facts.ts`) now coalesces same-category unions. A **heterogeneous** union (`number \| Point`) — constituents of different categories — still classifies as `"unknown"` (the genuine hazard). Pinned by `tests/semantic-gates.test.ts` and `tests/packages/transpiler/demo-22-regressions.test.ts` (Finding C). |
| `null` literal | ✅ → `CUTTLEFISH_UNDEFINED` macro | `tests/transpiler-type-gaps.test.ts:288`. |
| `undefined` literal | ✅ → `CUTTLEFISH_UNDEFINED` | |
| `a ?? b` nullish coalescing | ✅ → `cuttlefish_nullish(a, b)` helper | **Must** use the helper (not truthy ternary) so `0`/`false` are preserved. CLAUDE.md convention. |
| `a?.b` optional chaining | 🟡 → `cuttlefish_exists(a) ? a.b : 0` | Emits `TS2CPP_OPTIONAL_CHAINING` warning; semantics approximate. `expression-to-ir.ts:595`. |
| `a?.()` optional call | 🟡 → `cuttlefish_exists(fn) ? fn() : 0` | Demo #7 fix N — a null guard is now emitted for bare-identifier callees (was: no guard, so an empty `std::function` was called unconditionally → `std::bad_function_call`). **Runtime caveat:** the shim's `cuttlefish_is_nullish` has no `std::function` specialization, so an empty `std::function` still reads as non-null — pass a real callback until the shim gains a `std::function` overload. |
| `a ??= b` logical nullish assignment | ✅ | Demo #8 fix I — now handled on property-access left sides (`obj.field ??= v` → `obj.field = cuttlefish_is_nullish(obj.field) ? v : obj.field`); was dropped. Identifier left sides worked before. **Caveat:** a `const`-ref param receiver is read-only — copy into a `let` local first. |
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
| Rest element `const [a, ...rest]` from a **literal** | ✅ → sub-literal (size recoverable) | Works on AVR (the literal's size is known). |
| Rest element `const [a, ...rest]` from a **variable** | ✅ native / 🚫 AVR | Native lowers to `std::vector<T>` slice. On AVR (no `<vector>`) it emits `TS2CPP_NO_VECTOR_STORAGE` (destructure stress test Finding B) — use a rest from a literal or index the array directly. |
| Destructure without initializer | 🚫 | **Build error** (`TS2CPP_UNSUPPORTED_DECL`). Provide an initializer so the transpiler can lower each binding. |
| Parameter destructure `function f({ a, b })` | ✅ | Synthetic `__param_N` + extraction statements. |
| Mixed destructure + regular params | ✅ | |
| `for (const { x } of pts)` (destructured loop var) | ✅ | Desugared to a synthetic `__forof_N` loop var + per-binding extraction at the top of the body (destructure stress test Finding A). Object and array binding patterns both handled. |
| Array literal of structs (`const pts: Point[] = [...]`) | ✅ | Lowers to `__tc_StaticArray<P,N>` (size from the literal) on AVR; was a silent `std::vector` miscompile (destructure stress test Finding D). |

### 1.10 Type assertions & narrowing

| Pattern | Status | Notes |
|---|---|---|
| `x as T` | ✅ | Erased; underlying expression emitted. |
| `<T>x` angle-bracket assertion | ✅ | |
| `x!` non-null assertion | ✅ | Erased. |
| `typeof x` | ✅ → string literal where statically known | `tests/new-features.test.ts:187`. Dynamic typeof falls back to `"object"`. |
| `typeof` type guard optimization (`typeof x === "number"`) | ✅ → `true`/`false` when statically known | |
| `instanceof` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). No portable RTTI-based lowering across targets; use an explicit discriminator field or enum. |
| `in` operator (`"k" in obj`) | ✅ → `map.count()` / vector find on containers | `expression-to-ir.ts:316`. Demo #7 fix K — enum-member keys into an integral-keyed `Map` are now wrapped in `static_cast<KeyType>(...)` so they match the comparator. |

### 1.11 Generics

| Pattern | Status | Notes |
|---|---|---|
| Generic function `function f<T>(x: T)` | ✅ → C++ `template<typename T>` | `tests/transpiler-type-gaps.test.ts:661`. |
| Multiple type params | ✅ | |
| Generic class `class C<T>` | ✅ | Emits `template<typename T> class C`. Demo #8 fix A — a subclass `extends Generic<T>` now resolves the heritage type args (`: public Generic<std::string, double>`); was dropping them. **Caveat:** static members + `new Generic<T>()` static access on a template class still have emit gaps (static-getter emits `Cls<K,V>::getName()`; static-member access needs the substituted name). |
| Generic constraint `T extends X` | ✅ → emitted as `static_assert` | `function-builder.ts:602`. |
| Generic type param in scope | ✅ | `typeParametersInScope` tracking in `typeNodeToCppType`. |
| Conditional/`infer` generic gymnastics | 🚫 | Far beyond what template lowering can express. |

### 1.12 Top type erasure

| Pattern | Status | Notes |
|---|---|---|
| `any` | 🚫 | **Deprecated — now a build error** (`TS2CPP_EXPLICIT_ANY`, see §1.5). Previously lowered best-effort to `auto`; the syntactic feature-prescan now rejects every explicit `any` token. Use a concrete type or `unknown`. (Implicit `any` is still caught by the TypeScript type-checker when `noImplicitAny` is set, which scaffolded projects enable.) |
| `unknown` | 🟡 → `auto` | |
| `never` | 🚫 | No meaningful C++ lowering. Avoid. |
| `Partial<T>` / `Required<T>` / `Readonly<T>` / `Pick` / `Omit` | 🟡 → resolves to underlying `T` | Emits `TS2CPP_APPROXIMATE`: these utility types are erased to the base type and do not preserve TypeScript optional/readonly/picked-field semantics. Prefer an explicit interface/struct when the shape matters. |
| `NonNullable<T>` | ✅ → inner type | |
| `ReturnType`/`Parameters`/`InstanceType`/`Extract`/`Exclude` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). These fall back to `auto`, which is not deterministic enough for C++ emission; write the concrete type explicitly. |

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
| `for...of` over array | ✅ | Element type resolved for class arrays (`->` access). **Mutation of the loop variable:** a `const` loop variable whose body mutates a field/index (`t.done = true`, `t[i] = v`, `t.hits++`) is auto-demoted to a non-const C++ reference (`for (T& t : ...)`) so the mutation compiles and writes through to the container element — matching TS semantics. Works in **all** scopes (top-level, free function, class method/getter/setter/constructor, namespace function) — demo #17 fix (`ir/ownership-analysis.ts`: the const-content-mutation walk now reaches class and namespace bodies, not just `program.functions`). A read-only loop var stays `const T&` (no over-demotion). The ESLint rule **`no-readonly-loop-variable-mutation`** (warn) surfaces the demotion at lint time so the author can express intent with `let`. **Loop-variable type resolution:** the variable carries its real resolved C++ element type (e.g. `std::string`, `int32_t`), not `auto`, so a downstream template-literal interpolation picks the correct snprintf specifier. **Demo #31 Finding C** — when the iterable was a TOP-LEVEL `const` array (not a function local), the for-of variable previously kept `auto` because `inferExprCppType` for a bare identifier consulted only the function-locals map, not the IR type scope's `globals`. Since a for-of var has no initializer, the snprintf specifier picker couldn't recover the type and defaulted to `%d` — tripping g++ -Wformat= and producing garbage when the element was a `std::string`. Fix: `inferExprCppType` now consults `getCurrentIrTypeScope().globals` as a fallback for bare identifiers (matching what `resolveReceiverCppType` already does for the string/array-method disambiguation). Pinned by `tests/packages/transpiler/demo-31-regressions.test.ts` (C). |
| Nested `for...of` | ✅ | |
| `for...in` over object keys | ✅ | Keys enumerated at IR build time (`extractForInKeys`). **Caveat (demo #7):** `for...in` over a `Map`/`Record` is rejected by the `TS2CPP_FORIN_ON_MAP` semantic gate (the Map lowering iterates key-value pairs, not keys — use `for...of` over `Object.keys(m)`, `Object.values(m)`, or `Object.entries(m)` instead). |
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
| **Braced case bodies** (`case X: { ...; break; }`) | ✅ | A `switch` lowers to a C++ `if/else if` chain (not a C++ `switch`), so each case's terminating `break;` is **stripped** — otherwise a surviving `break` would break the enclosing loop (silent wrong control flow) or be a hard g++ error outside a loop. Demo #28 fix D widened the strip pass to recurse into a case body's wrapping block(s) (`emit/emitters/line-appender.ts`); previously only *flat* case bodies had their break stripped, so braced case bodies kept it. Pinned by `tests/packages/transpiler/demo-28-regressions.test.ts` (D). |
| `switch` on an enum/numeric **struct field** (`switch (m.unit)`) | ✅ | The discriminant's `std::string(...)` wrap is decided by its **resolved C++ type**, not its syntactic form — only string-like discriminants (`std::string`/`const char*`) are wrapped; enum/numeric fields emit a plain comparison, and an unknown type defaults to no wrap (always valid C++). Demo #16 fix A (`emit/emitters/line-appender.ts` + `emit/expression-renderer.ts:inferCppType`). Pinned by `tests/packages/transpiler/demo-16-regressions.test.ts`. |
| Fall-through into a SHARED body (`case A: case B: body`, `case X: default: body`) | ✅ | TS parses these as one clause with an EMPTY body (the fall-through case) followed by the clause carrying the shared body. The naive `if/else if` lowering emitted an empty `if (x==A) {}` branch and put the body only in the next branch — so `x==A` ran nothing (silently wrong). The chain builder now GROUPS consecutive empty-body cases with the next clause that has a body, joining their conditions with `||` (`if (x==A \|\| x==B) { body }`); a `default` in a group makes the whole group the catch-all `else` (`case X: default: body` → the body runs for X AND anything else, i.e. always). This is the general fix for the `case X: default:` idiom AND chained `case A: case B:`. Demo #30 fix D (`emit/emitters/line-appender.ts`). Pinned by `tests/packages/transpiler/demo-30-regressions.test.ts` (D). |
| Fall-through with side effects (no `break`, body runs then falls INTO the next case's body) | 🟡 | A case whose body has REAL statements (not just a fall-through marker) AND no `break` is emitted verbatim — C++ fall-through into the next case matches TS, but no diagnostic warns about it. The shared-body grouping above handles the empty-body fall-through idiom (the common case); implicit fall-through with a non-empty body is left to the C++ compiler's fall-through semantics. |
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
| `async function` | ✅ | Lowered to a cooperative state-machine task class driven from `loop()`; the awaited call's start + poll states replace the blocking wait. `emit/utils/async-state-machine.ts`, `api/shared/async-runtime-static.ts`. |
| `await expr` | ✅ | Splits the enclosing async task into segments; the awaited call drives start→poll transitions between them. No event loop is required — the scheduler is a fixed array of tasks pumped once per `loop()`. |
| `await` on a statement | ✅ → call statement | |
| `Promise`, `Promise.all`, `.then` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). User-authored Promise APIs require a JS/event-loop runtime. Use synchronous values, explicit callbacks, or framework-provided async primitives (the `async`/`await` lowering above is a separate, supported cooperative mechanism). |
| `function*` generator | 🚫 | Tracked (`isGenerator`), `yield` lowers to `co_yield`, but **no coroutine runtime** is wired for embedded targets — effectively unusable. Linted as an error. |
| `yield` / `yield*` | 🚫 → `co_yield` | Same caveat. `expression-to-ir.ts:1675`. |

**Verdict:** `async`/`await` are fully supported via the cooperative task scheduler
(one task per `async function`, pumped from `loop()`). Generators and user-authored
`Promise` APIs remain unsupported (no coroutine runtime / no JS event loop).

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
| Mutating array parameter contents (`xs[0] = v`, `xs.push(v)`) | 🚫 | **Build error** (`TS2CPP_ARRAY_PARAM_MUTATION`). Array parameters lower as by-value `std::vector` copies, so content mutation would not affect the caller. Return the updated array, mutate the caller-side owner, or pass an explicit mutable owner object. |
| Object destructure param `f({ a, b })` | ✅ | Synthetic `__param_N` + extraction. |
| Nested object destructure param | ✅ | |
| Array destructure param `f([a, b])` | ✅ native / 🚫 AVR | An array-typed parameter has no recoverable size, so it lowers to `std::vector<T>`. On AVR (no `<vector>`) it emits `TS2CPP_NO_VECTOR_STORAGE` (destructure stress test Finding C) — destructure a function-local array literal instead. Object destructure params (`f({ a, b })`) are unaffected. |
| Mixed destructure + regular params | ✅ | Object/array-element destructuring where the array form would lower to vector is subject to the AVR note above. |
| `this` parameter (typed) | 🟡 | Recognized loosely; `this` semantics are class-based in C++. |

### 3.3 Return types & overloads

| Pattern | Status | Notes |
|---|---|---|
| Annotated return type | ✅ | |
| Inferred return type | ✅ | Multi-pass inference in `buildFunctionReturnTypeMap`. |
| Multiple `return`s with differing types | ✅ | Widened (e.g. `int` + `float` → `double`). |
| Early return | ✅ | |
| Return type with ownership wrapper | ✅ | |
| Returning typed arrays (`Uint8Array`, etc.) | 🚫 | **Build error** (`TS2CPP_TYPED_ARRAY_RETURN`) and lint error (`cuttlefish/no-typed-array-return`). Typed arrays lower to pointer-like C++ storage, so returning them does not carry ownership/lifetime safely. Use an out-parameter plus explicit length, or return a fixed-shape struct that owns storage. (See also `TS2CPP_TYPED_ARRAY_FIELD` and `TS2CPP_TYPED_ARRAY_PARAM_LENGTH` — the same ownership boundary applied to fields and parameters.) |
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
| **Closures capturing outer variables** | 🟡 | Arrow/function expressions lower to lambdas, but capture semantics (`[=]` vs `[&]`) are not faithfully modeled. Captured-mutation patterns are unreliable. Capturing callbacks inside class-method functional array calls are a **build error** (`TS2CPP_CALLBACK_CAPTURE_UNSUPPORTED`); use a manual loop in the method or call a module-level helper that does not capture method locals or `this`. |
| IIFE `(function(){})()` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) and ESLint error. The body is not inlined and the `function` keyword can leak into C++; assign to a `const` or define a named top-level function instead. |

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
| Class with public/private/protected fields | ✅ | Visibility maps to C++ access sections. A field named like a target-reserved macro (Arduino's `min`/`max`/`INPUT`/`OUTPUT`/...) is escaped consistently — the declaration (`renderTypedName` → `escapeCppKeyword`), the interface/struct field decl (`type-decl-emitter.ts`), AND every access/assign target (`escapeFinalMemberName` / the shared `escapeTrailingMember` helper for compound lvalues like `this.field`) all apply the SAME suffix-`_` rename, so a field declared `min_` is read/written as `min_` everywhere. **Demo #33 Finding D** — previously the assign target `this.min` used `escapeCppKeyword` on the whole compound string (which didn't match the bare `min`), and interface field decls used the bare name, producing declaration/access mismatches (`struct Stats { int32_t min; }` accessed as `s.min_`). Pinned by `tests/packages/transpiler/demo-33-regressions.test.ts` (D). |
| Class with field initializers | ✅ | |
| Class with `readonly` fields | ✅ | |
| Class with `static` fields/methods | ✅ | |
| Static initializer block `static { ... }` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) and ESLint error. Although there is an internal lowering path, this is outside the deterministic safe subset until compile/runtime coverage proves it reliable. Initialize static fields directly or use an explicit static setup method. |
| Optional class field `x?: T` | ✅ → `T` (optionality dropped) | Nullish checks on the field are rejected by `TS2CPP_OPTIONAL_FIELD_NULLISH`; model presence explicitly. |
| Generic class `class C<T>` | ✅ | See §1.11 (demo #8 fix A for `extends Generic<T>`; static-member caveats). |
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
| Method calling free function | ✅ | Works in **both** emit modes regardless of where in the method body the call sits. In single-file (cpp) mode the free function's forward declaration precedes the class. In **split** mode a non-exported free function called from a class method body gets a **non-static forward declaration in the header** (ahead of the class definition) plus a non-static definition in the .cpp — the inline method body lives in the header, so it needs the symbol visible there. A free function NOT called from any class body stays `static` in the .cpp. Demo #18 fix B (split-mode forward decl): `tests/packages/transpiler/demo-18-regressions.test.ts`. **Demo #22 Finding B** — a call site nested inside a **parenthesized sub-expression** (e.g. `if (a || (b && !fn(x)))`) was previously tree-shaken out, because the `paren` IR node (which preserves explicit TS grouping) had no case in `collectExpressionIdentifiers`, so the call-graph/reachability pass never saw the callee. The function was forward-declared but then removed as "unreachable" → g++ "not declared in this scope". Fix: added `paren` (plus `lambda`, `tuple-access`, `hal-expr`) cases to `ir/identifier-collector.ts`. Pinned by `tests/packages/transpiler/demo-22-regressions.test.ts` (Finding B). **Demo #30 Finding A** — a free function reached ONLY through a **lowered `raw` wrapper** (e.g. `freeFn(x).trim()` → `__tc_trim(freeFn(x))`, where `freeFn(x)` is buried in the raw text) was missing from the *class-method visibility* set (a SEPARATE walk in `setup.ts` that decides header-prototype vs `static`). That walk had its own hand-rolled recursion that only inspected structured `call`/`method-call` nodes — it did NOT extract identifiers from `raw` IR text (the canonical `collectStatementIdentifiers` DOES). So the function was emitted `static` with no header prototype → g++ "not declared in this scope" from the inline method body. Fix: `setup.ts` now reuses the canonical `collectStatementIdentifiers`, which already handles `raw`/`paren`/`lambda`/`tuple-access`/`hal-expr` — closing the divergence between the two parallel walks (the same blind-spot family as demo #22 B / demo #28 C, each fixed in a different walk). Pinned by `tests/packages/transpiler/demo-30-regressions.test.ts` (A). |
| Getters `get x()` | ✅ | `tests/new-features.test.ts:13`. Access rewrites to `obj->getX()` for identifier, method-call, and chained receivers; demo #14 fix E also aggregates accessor names across the module graph so getter access on an **imported** class rewrites in the importer. |
| Setters `set x(v)` | ✅ | |
| Getter/setter pair | ✅ | |
| Static getter/setter | ✅ | Demo #8 fix B — static getters no longer emit the illegal `() const` cv-qualifier. Demo #14 fix E — accessing a static getter (`Cls.prop`) now rewrites to `Cls::getProp()` (was emitting `Cls::prop`). |
| Abstract method | ✅ (recorded) | `= 0` pure virtual emitted for abstract methods. |

### 4.4 Inheritance & polymorphism

| Pattern | Status | Notes |
|---|---|---|
| `class B extends A` | ✅ | `extendsClass` recorded. |
| `super()` call | ✅ → C++ initializer list | `tests/classes.test.ts:149`. Body `super()` is NOT emitted as a statement. |
| `super` with args | ✅ | |
| `super.method()` | 🟡 | `super` keyword lowers to base class name (`expression-to-ir.ts:1663`); works for simple cases. Demo #8 — `super.method()` on a **generic base** cascades from the generic-subclass emit gaps (Finding A fixed the heritage type args; static-member access on templates is still incomplete). |
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
| Deep access chain `a.b.c.d` | ✅ → uses `->` through pointer chain | **Demo #23 Finding B** — a class **value-field** access `this->field.X` was previously arrowed to `this->field->X` whenever a pointer variable of the **same name** existed elsewhere in the program (a name collision). The `globalPointerVarTypes` loop in `fixPointerFieldAccess` (`emit/emitters/top-level-prep.ts`, threaded as the `calleeTransformer` through `statement-renderer.ts` `renderCall`) used an unguarded `\b${var}\.` regex whose `\b` word boundary also matches between `->` and the name in a member-access chain, so a field `this->heap` was rewritten to `this->heap->` whenever a pointer var `heap` (e.g. `const heap: MinHeap = new MinHeap()` in a sibling function) existed. Fix: the loop now uses the same `(^|[^>.])${var}\.` guard as the adjacent `pointerStructFields` loop, so `this->heap.x` / `obj->heap.x` / `a.heap.x` are left alone and only a standalone `heap.x` is rewritten to `heap->x`. Pinned by `tests/packages/transpiler/demo-23-regressions.test.ts` (Finding B). |
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
| `delete obj.key` | ✅ on map/set/vector → `erase` | ❌ on other types (`expression-to-ir.ts:1637`). Demo #8 fix D — the `m.delete(k)` Map METHOD now lowers to `.erase()` too (was emitting `m.delete_` because `escapeCppKeyword` ran before the map-method check). |
| `void expr` | ✅ | Demo #8 — lowers correctly (discards the value). |
| Exponentiation `**` | 🟡 → may need `pow()` | Not a first-class operator in emit. Use `Math.pow()` (the lint rule suggests this). |
| **`new.target`, `import.meta`** | ❌ | Meta-properties unsupported (`:1655`). |

### 5.2 `Math.*`

| Pattern | Status | Notes |
|---|---|---|
| `Math.floor/ceil/round/abs/sqrt/sin/cos/tan/atan2/log/exp/pow/fmod` | ✅ → `std::...` | Return type inferred as `double`. |
| `Math.min/max` | ✅ | Return type follows operands. |
| `Math.random` | ✅ → `__tc_random()` | |
| `Math.PI`, `Math.E`, constants | ✅ → numeric literal | Demo #7 fix L — `Math.PI`/`Math.E`/`LN2`/`LN10`/`LOG2E`/`LOG10E`/`SQRT2`/`SQRT1_2` lower to their literal values (was `std::PI`/`std::E`, which don't exist). |

### 5.3 Array & string methods

`transformers/array-methods.ts` and `ALL_STRING_METHODS` in `expression-to-ir.ts:349`.

| Pattern | Status | Notes |
|---|---|---|
| `push`, `pop` | ✅ | Promotes to `StaticArray`. |
| `indexOf`, `lastIndexOf`, `includes` | ✅ | |
| `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `concat`, `slice`, `join` | ✅ | Recognized in typeof context and lowered where supported. **Demo #31 Finding B** — `.join(sep)` is now lowered through the VECTOR value-method table (`VECTOR_VALUE_METHOD_LOWERINGS` in `ir/transformers/array-methods.ts`) to `__tc_join(recv, sep)`, NOT through the string-method registry. It was previously misclassified as a string method (listed in `STRING_METHODS` even though `.join` operates on a `std::vector`, not a `std::string`), so on a `.push`-built `string[]` receiver (which `shouldLowerAsStringMethod` correctly rejects as a known array) BOTH lowering paths declined the call and it fell through to verbatim emit (`parts.join(" ")` → g++: "no member named 'join'"). `__tc_join` is removed from `STRING_METHODS`; the polyfill helper is still registered via `POLYFILL_HELPER_MAP['.join(']`. Pinned by `tests/packages/transpiler/demo-31-regressions.test.ts` (B). **Demo #32 Finding B** — the `__tc_join` polyfill builds its result through a `std::ostringstream`, but the `array_methods` polyfill block's `requiredIncludes` listed only `<algorithm>` and `<map>`. A program that used `.join` WITHOUT also triggering `__tc_toFixed`/`__tc_random` (whose `math_methods` block transitively pulled in `<sstream>`) emitted `__tc_join` with no `<sstream>` → g++ "std::ostringstream has incomplete type" + a 16-candidate `operator<<` cascade. `<sstream>` is now declared on the `array_methods` block so `.join` is self-contained (`framework-native/src/strategy.ts`). Pinned by `tests/packages/transpiler/demo-32-regressions.test.ts` (B). |
| `map`, `filter`, `reduce`, `find`, `findIndex`, `every`, `some`, `forEach` | ✅ on arrays | Functional methods lower via the `__tc_*` template helpers (`tryLowerArrayAndStringMethods` / `normalizeRawExpression`). Demo #7 fix A — callbacks now carry a real return type + typed params (resolved from the arrow's annotations/body, with C++14 `auto` return deduction as a fallback), so the `__tc_*` templates can deduce the result type. `reduce` requires an init (`TS2CPP_REDUCE_NO_INIT` otherwise). **Caveats:** (1) `.forEach` on a runtime `std::vector` is not yet in the rewrite table — use a manual `for` loop; (2) capturing callbacks inside class methods are rejected by `TS2CPP_CALLBACK_CAPTURE_UNSUPPORTED`; (3) functional methods on `Map`/`Set`/`Record` are rejected by `TS2CPP_CONTAINER_FUNCTIONAL_METHOD`. (The earlier caveat (4) — "the rewrite regex only matches single-identifier receivers" — was **fixed** in demo #22 Finding A; see the `.pop`/`.push` row below.) |
| `.pop`, `.push`, `.shift`, `.unshift` on a **member-access receiver** (`this.field.pop()`, `obj.field.push(x)`) | ✅ | Lower correctly to `__tc_pop(this->field)` / `this->field.push_back(x)`. Demo #22 Finding A — previously the native strategy's receiver regex used `(\w+)`, which stopped at the `>` in `this->ops` and emitted `this->__tc_pop(ops)` (a member call that g++ rejected with `'class C' has no member named '__tc_pop'`). The regex now uses a shared `RECV` pattern (`[\w$]+(?:->\w+|\.\w+)*`) that captures the full member-access chain, applied uniformly to every array/string-mutator rewrite (`.pop`/`.push`/`.shift`/`.unshift`/`.sort`/`.fill`/`.concat`/`.splice`/`.map`/`.filter`/...). `framework-native/src/strategy.ts` `normalizeRawExpression`. Pinned by `tests/packages/transpiler/demo-22-regressions.test.ts` (Finding A). |
| `__tc_*` helper on an **inline array-literal receiver** (`[...].join(sep)`, `[...].concat(x)`, `[...].map(cb)`) | ✅ | The receiver renders as a TYPED `std::vector<ElemType>{...}` (element type inferred from the first literal element) so the `__tc_*` template helpers can deduce their element type. Demo #29 fix D (`ir/transformers/array-methods.ts` `renderArrayMethodReceiver`) — previously an inline array literal rendered as a bare brace-init-list `{...}`, which cannot drive template argument deduction (g++: "couldn't deduce template parameter 'T'"). A NAMED receiver (`x.join(...)` where `x: string[]`) was always fine. The type-qualification is scoped to the method-receiver position only; a bare `{...}` is still used in direct-initialization (`const T x = {...}`) and HAL-argument (`Wire.write({...})`) contexts where it is correct. Pinned by `tests/packages/transpiler/demo-29-regressions.test.ts` (D). |
| `.length` on array/string/typed-array | ✅ | Context-aware (`resolveLengthProperty`). Works on bare identifiers AND `this.field`/`obj.field` member receivers. Demo #22 Finding F — `.length` on a **Map/Set instance field** previously fell through to the C-string `strlen()` default (the member-receiver path only recognized `std::string`/`std::vector`/`StaticArray` field types), emitting `strlen(this->m)` on a `std::map` struct. Now every STL container field type routes to `.size()`; `strlen` is kept only for explicit `const char*`/`char*` fields. `ir/expression-to-ir.ts` `resolveLengthProperty`. Pinned by `tests/packages/transpiler/demo-22-regressions.test.ts` (Finding F). **Demo #27 Finding C** — `.length` on a **function-local `std::vector`** (a `.push`-mutated local or an array-literal local whose type resolved to `std::vector<...>`/`StaticArray<...>`) previously emitted the invalid `vector.length()` (the `mutableArrayVars` and `activeArrayLiteralVars` branches emitted `.length()`); both now emit `static_cast<long long>(x.size())`. The top-level-const-array path already worked; the `this->field` path was fixed by demo #22 Finding F; this closed the bare-local-identifier hole. `std::string` keeps `.length()`. Pinned by `tests/packages/transpiler/demo-27-regressions.test.ts` (C). **Demo #30 Finding B** — `.length` on a **`std::string`** (bare identifier, `this.field`, or call-result receiver) now ALSO casts to `static_cast<long long>(s.length())`, making `.length`/`.size` UNIFORM across every receiver (the array/vector path already cast; the string path returned the bare unsigned `size_type`). The snprintf format specifier for `.length`/`.size` (both the `property-access` IR path and the lowered `raw`-node `static_cast<long long>(...size())` path) is now `%lld` to match the cast type — the previous hardcoded `%d` mismatched `size_type` and tripped g++ -Wformat=. Pinned by `tests/packages/transpiler/demo-30-regressions.test.ts` (B). **Demo #33 Finding B** — `.length` on a **raw C array** (a non-mutated local OR top-level const array literal on a no-`std::vector` target like AVR, which lowers to `T name[] = {...}`) previously emitted the invalid `name.size()` (a raw C array has no `.size()` member) → avr-g++ "request for member 'size' in 'name', which is of non-class type". The container-vs-sizeof decision now mirrors the emit-side discriminator (`!strategy.needsStdVector()` → raw C array → `sizeof(name)/sizeof(name[0])`; `std::vector`/promoted-`StaticArray` → `.size()`), for BOTH function-locals (`activeArrayLiteralVars` branch) and top-level consts (the identifier fallthrough now reads `globals`, which survives `resetFunctionScopeState`, unlike the function-scoped `activeArrayLiteralVars`). Native/generic (`needsStdVector()` true) keep `.size()` — a const array there really IS a `std::vector`. Pinned by `tests/packages/transpiler/demo-33-regressions.test.ts` (B). |
| String methods `toUpperCase`, `toLowerCase`, `trim`, `replace`, `charAt`, `charCodeAt`, `substring`, `slice`, `endsWith`, `startsWith`, `padStart`, `padEnd`, `repeat`, `split`, `toString` | ✅ | All in `ALL_STRING_METHODS` set. **Demo #27 Findings D/E** — on native/hosted targets these now lower **structurally at IR-build time** (`tryLowerArrayAndStringMethods` in `ir/transformers/array-methods.ts`), so they work on ANY receiver shape: bare id, `this.field`, `obj.field`, indexed element (`ALPHABET[i]`), and pointer chains (`obj->field`). Previously they were lowered by a post-emit text rewrite (`applyStringMethodRewrites`) whose `RECEIVER_PATTERN` only matched bare identifiers and `.member` chains, leaving `ALPHABET[i].toLowerCase()` verbatim AND failing to register the `__tc_*` helper (g++: "no member 'toLowerCase'" / "'__tc_toLowerCase' was not declared"). The structural path renders the receiver via `expressionToIR` and emits the helper into a `raw` IR node that `program-analysis.ts` scans to register the polyfill (transitively fixing the helper-registration gap). Arity-aware (`substring(0,2)`→`__tc_substring2`, `substring(2)`→`__tc_substring1`); ambiguous string/array methods gate on the receiver's resolved C++ type. Native `startsWith`→`rfind` special case preserved. Arduino keeps the legacy text rewrite (structural path gated on `isHostedTarget`). Pinned by `tests/packages/transpiler/demo-27-regressions.test.ts` (D/E). |
| `parseInt`, `parseFloat` | ✅ | `expression-to-ir.ts:664`. |

### 5.4 `Object.*` and container ops

| Pattern | Status | Notes |
|---|---|---|
| `Object.keys(map)` | ✅ → `__tc_mapKeys` | ❌ on non-map → `TS2CPP_UNSUPPORTED_EXPR` (`:731`). Demo #7 fix I — now also resolves `this.field`/`obj.field` member-access arguments (was: only bare uppercase-first identifiers). |
| `Object.values(map)` | ✅ → `__tc_mapValues` | ❌ on non-map (`:743`). Member-access args resolved (demo #7 fix I). |
| `Object.entries(map)` | ✅ → `__tc_mapEntries` | ❌ on non-map (`:749`). **Caveat:** returns `std::vector<std::pair<K,V>>`; a `[K,V][]` tuple-array return annotation lowers to `std::vector<std::tuple<K,V>>` (pair→tuple mismatch) — return the values vector or use `pair` explicitly. |
| `Object.keys(plainStruct)` | 🟡 | Only when literal field names are statically known. |
| `Object.assign`, `Object.freeze`, `Object.fromEntries` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). Runtime object-shape operations are not lowered; construct fixed-shape structs explicitly or use a Map. |
| `Object.defineProperty`, `Object.create`, prototype/reflection APIs | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). No AOT lowering for runtime object-shape mutation/introspection. |
| `JSON.*` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). No JSON runtime on bare metal. Parse/format explicitly or pass structured values. |
| `String.*` statics (`String.fromCharCode`, `fromCodePoint`, `raw`, ...) | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) **and ESLint error**. The `String` constructor's static methods have no C++ lowering (no JS string runtime on bare metal). They were previously neither lowered nor gated, so `String.fromCharCode(c)` silently emitted verbatim and failed at g++ time ("'String' was not declared in this scope"). Demo #28 fix A added both the lint gate and the build-time prescan rejection, mirroring the `JSON.*`/`Object.*` precedent. **Workaround:** build the string from an explicit single-char-string lookup table (`const GLYPHS: string[] = [...]`). |
| `Number.*` statics (`Number.parseInt`, `parseFloat`, `isFinite`, `isNaN`, ...) | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) **and ESLint error**. No JS number-runtime on bare metal. Use an explicit C++ cast (`static_cast<int>`), a fixed-width numeric type, or a manual implementation. Demo #28 fix A. |
| `Array.from` / `Array.of` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) **and ESLint error**. No JS array runtime on bare metal — these constructor statics were previously neither lowered nor gated, so they emitted verbatim (`return Array.from(x);`) and failed at g++ time. Construct the `std::vector` directly (a literal, a sized loop, or `std::vector<...>`). (`Array.isArray` IS supported — a compile-time type check.) Demo #28 fix A review. |
| `new Array<E>(n)` (typed sized constructor) | ✅ → `std::vector<E>(n)` | The idiomatic TS pre-sized/empty array constructor lowers to its clean C++ equivalent: `new Array<E>(n)` → `std::vector<E>(n)` (n value-initialized elements), `new Array<E>()` → `std::vector<E>()`, `new Array<E>(a,b,c)` → `std::vector<E>{a,b,c}`. The element type comes from the type argument. Demo #29 fix B (`ir/expression-to-ir.ts`). Previously emitted verbatim and failed at g++ time ("'Array' does not name a type"). |
| `new Array(n)` (UNTYPED sized constructor) | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). The untyped form carries no element type to lower to, so it cannot pick a C++ element type. Rejected at build time (feature prescan) with a clear diagnostic rather than the opaque g++ error. Use the typed form `new Array<ElementType>(n)` or an array literal `[]`. Demo #29 fix B (`ir/feature-registry.ts`). |
| `new Date()` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`) **and ESLint error**. No Date/calendar runtime on bare metal — previously emitted `Date* d = new Date();` (undefined type) verbatim. Use `millis()`/`micros()` for elapsed time or pass an explicit value. Demo #28 fix A review. |
| `.bind()`, `.call()`, `.apply()` | 🚫 | **Build error** (`TS2CPP_NO_EQUIVALENT`). C++ has fixed receiver/call semantics; call directly or pass the receiver explicitly. |

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
| Free functions emit as C++ free functions | ✅ | Prototypes hoisted before `setup()` when called from top-level (CLAUDE.md). A free function called ONLY as a nested expression (an argument to another call, e.g. `out.push(glyphFor(op))`) is correctly kept by tree-shaking — Demo #28 fix C (`ir/identifier-collector.ts`): the `call` statement's callee is a lowered raw wrapper and the collector now adds every callee part, not just the first, so the inner callee is visible to the call graph. Pinned by `tests/packages/transpiler/demo-28-regressions.test.ts` (C). **Demo #31 Finding A** — a top-level VARIABLE reached only through a lowered raw callee that contained an ARRAY INDEX (`parts.push(globalArr[i])` → callee `__RAW_STMT__parts.push_back(globalArr[i])` with `args: []`) was tree-shaken, because the `call` case's split on `/->|::|[.(]/` stops splitting at `[` but NOT at `]`, leaving `"globalArr[i])"` as one compound token. The variable was emitted in NEITHER the .cpp definition NOR the .h extern → g++ "not declared in this scope" from the inline class-method body. Same blind-spot family as demo #22 B / demo #28 C / demo #30 A, each in a different walk; this one is the `call`-statement callee text. Fix: when the callee is a `__RAW_STMT__` wrapper, scan its raw text with the SAME identifier regex the `raw` expression case uses, so every embedded identifier is collected regardless of bracket/paren structure. Pinned by `tests/packages/transpiler/demo-31-regressions.test.ts` (A). |
| Top-level `const` referenced only from a class-method body | ✅ | The variable survives tree-shaking (Demo #31 fix A above) AND, in split mode, gets an `extern` declaration in the header so the inline class-method body (which lives in the header) can see it. The `extern` emission in `emit/emitters/type-decl-emitter.ts` already ran for every reachable top-level `var_decl`; the gap was purely upstream reachability — once the call graph sees the reference, both the extern and the definition land in the right files. |
| Top-level statements flow into `setup()` | ✅ | A top-level variable classified runtime AND referenced by a free function is **promoted** to a file-scope global (forward-declared at file scope, assigned its real initializer inside the entrypoint). Its default initializer is `{}` (value-initialization) — valid for every C++ type. Demo #28 fix B (`emit/emitters/function-emitter-impl.ts`): previously the default was `= 0` for every non-pointer type, which is invalid for class types (`std::vector<...> = 0;`). Pinned by `tests/packages/transpiler/demo-28-regressions.test.ts` (B). |
| `setup()` / `loop()` Arduino entry points | ✅ | Arduino has no `main()` — the entrypoints are the auto-generated `setup()`/`loop()`. A user `function main()` is renamed to `cuttlefish_main` (via `strategy.mapFunctionName`, now applied at the function-name chokepoint AND the single call-rendering chokepoint `StatementRenderer.renderCall`) so a file-scope `static void main()` never collides with C++'s required `int main()` signature, and the top-level `main()` call that flows into the auto-generated `setup()` is rewritten to `cuttlefish_main()` too. **Demo #33 Finding A.** Pinned by `tests/packages/transpiler/demo-33-regressions.test.ts` (A). |
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
5. **❌ Unsupported by design** (emits a fatal transpiler/lint diagnostic) → **Wontfix.** The diagnostic is
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
