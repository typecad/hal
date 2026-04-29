# TypeHAL Maintainability Review

**Scope:** `packages/transpiler`, `packages/cli`, `packages/core`, `packages/hal`  
**Date:** 2026-04-28

---

## Executive Summary

The review identified **18 distinct maintainability concerns** across the four packages. These are grouped into four severity tiers:

| Severity | Count | Category |
|----------|-------|----------|
| 🔴 Critical | 3 | Package duplication, committed build artifacts, module-level mutable state |
| 🟠 High | 5 | Type duplication, giant files, partial refactoring dead-zone |
| 🟡 Medium | 6 | Utility duplication, temp files, loose `any` types, schema/hal overlap |
| 🔵 Low | 4 | Naming inconsistencies, minor code hygiene |

---

## 🔴 Critical Issues

### 1. `packages/cli` and `packages/transpiler` are near-identical copies

**Files affected:** Every file under `packages/cli/src/` has a corresponding duplicate under `packages/transpiler/src/` with identical or near-identical content.

| cli file | transpiler file | Lines (cli) | Lines (transpiler) |
|----------|----------------|-------------|---------------------|
| `src/cli.ts` | `src/cli.ts` | 576 | 606 |
| `src/transpile.ts` | `src/transpile.ts` | 1096 | 1081 |
| `src/types.ts` | `src/types.ts` | 267 | 267 |
| `src/config-loader.ts` | `src/config-loader.ts` | 387 | 536 |
| `src/watch.ts` | `src/watch.ts` | — | — |
| `src/cache.ts` | `src/cache.ts` | — | — |
| `src/cli-utils.ts` | `src/cli-utils.ts` | — | — |
| `src/emit/*` | `src/emit/*` | — | — |
| `src/ir/*` | `src/ir/*` | — | — |
| `src/libdef/*` | `src/libdef/*` | — | — |
| `src/mapping/*` | `src/mapping/*` | — | — |
| `src/platform/*` | `src/platform/*` | — | — |
| `src/scaffold/*` | `src/scaffold/*` | — | — |
| `src/utils/*` | `src/utils/*` | — | — |

Both `package.json` files even define the same `bin` entry (`"typehal": "./dist/cli.js"`) and the same `exports` map.

**Impact:** Every bug fix, feature, or refactor must be applied twice. The two copies will inevitably drift, creating subtle behavioral differences that are extremely difficult to debug. This is the single largest maintainability risk in the codebase.

**Recommendation:** Eliminate one package entirely. If `@typehal/cli` is the published CLI, make it a thin wrapper that re-exports from `@typehal/transpiler`. If both are needed for historical reasons, extract all shared logic into `@typehal/transpiler` and have `@typehal/cli` depend on it with zero duplicated source files.

---

### 2. Committed build artifacts in `packages/core/src/shared/`

**Files affected:**

```
packages/core/src/shared/board-resolver.d.ts
packages/core/src/shared/board-resolver.d.ts.map
packages/core/src/shared/board-resolver.js
packages/core/src/shared/board-resolver.js.map
packages/core/src/shared/index.d.ts
packages/core/src/shared/index.d.ts.map
packages/core/src/shared/index.js
packages/core/src/shared/index.js.map
packages/core/src/shared/ir.d.ts
packages/core/src/shared/ir.d.ts.map
packages/core/src/shared/ir.js
packages/core/src/shared/ir.js.map
packages/core/src/shared/platform-strategy.d.ts
packages/core/src/shared/platform-strategy.d.ts.map
packages/core/src/shared/platform-strategy.js
packages/core/src/shared/platform-strategy.js.map
packages/core/src/shared/polyfill-helper-registry.d.ts
packages/core/src/shared/polyfill-helper-registry.d.ts.map
packages/core/src/shared/polyfill-helper-registry.js
packages/core/src/shared/polyfill-helper-registry.js.map
packages/core/src/shared/polyfill-types.d.ts
packages/core/src/shared/polyfill-types.d.ts.map
packages/core/src/shared/polyfill-types.js
packages/core/src/shared/polyfill-types.js.map
packages/core/src/shared/snprintf-types.d.ts
packages/core/src/shared/snprintf-types.d.ts.map
packages/core/src/shared/snprintf-types.js
packages/core/src/shared/snprintf-types.js.map
packages/core/src/shared/toolchain-types.d.ts
packages/core/src/shared/toolchain-types.d.ts.map
packages/core/src/shared/toolchain-types.js
packages/core/src/shared/toolchain-types.js.map
packages/core/src/shared/typehal-symbols.d.ts
packages/core/src/shared/typehal-symbols.d.ts.map
packages/core/src/shared/typehal-symbols.js
packages/core/src/shared/typehal-symbols.js.map
packages/core/src/shared/types.d.ts
packages/core/src/shared/types.d.ts.map
packages/core/src/shared/types.js
packages/core/src/shared/types.js.map
```

**Impact:** 40+ generated files are tracked in git alongside their `.ts` sources. This bloats the repository, creates noise in diffs, and can cause confusion about which file is canonical. If someone edits a `.d.ts` file directly, the change will be overwritten on the next build.

**Recommendation:** Add `packages/core/src/shared/*.js`, `packages/core/src/shared/*.d.ts`, and `packages/core/src/shared/*.map` to `.gitignore`. Remove them from git tracking with `git rm --cached`.

---

### 3. Extensive module-level mutable state

**Files affected:**

- [`packages/transpiler/src/emit/cpp-emitter.ts`](packages/transpiler/src/emit/cpp-emitter.ts:70) — 13 module-level `let`/`const` variables used as implicit context
- [`packages/transpiler/src/ir/build-ir-state.ts`](packages/transpiler/src/ir/build-ir-state.ts:1) — 20+ module-level mutable maps/sets/arrays

The emitter state includes:

```typescript
let _emitBoardConstants: BoardConstants | undefined;       // line 70
let _arduinoClassNameMap: Map<string, string> | undefined;  // line 74
const _emitEnumNames: Set<string> = new Set();              // line 82
const _largeEnumNames: Set<string> = new Set();             // line 89
const _namespaceNames: Set<string> = new Set();             // line 92
let _defaultStrategy: PlatformStrategy;                     // line 116
let _classStaticMembers: Map<string, Set<string>>;          // line 120
let _stringVarTypes: Set<string>;                           // line 123
let _classAccessorNames: Map<string, Map<string, ...>>;     // line 127
let _varAccessorNames: Map<string, Map<string, ...>>;       // line 129
let _cArrayVarNames: Set<string>;                           // line 130
let _pendingSnprintfLines: string[];                        // line 163
let _currentScopeState: EmissionScopeState | undefined;     // line 164
let _currentPointerVarTypes: Map<string, string>;           // line 165
let _currentKnownFunctionReturnTypes: Map<string, string>;  // line 166
```

The IR builder state includes:

```typescript
export const topLevelClasses = new Map<string, ClassIR>();
export const registerFieldMap = new Map<string, Map<string, ...>>();
export const hoistedNestedFunctions: FunctionIR[] = [];
export const hoistedNestedClasses: ClassIR[] = [];
export const hoistedNestedEnums: EnumIR[] = [];
export const hoistedNestedInterfaces: InterfaceIR[] = [];
export const hoistedNestedTypeAliases: TypeAliasIR[] = [];
export const nestedFunctionAliases = new Map<string, string>();
export const nestedClassAliases = new Map<string, string>();
export const activePinAliases = new Map<string, string>();
export const activeBusAliases = new Map<string, ...>();
export const activeCArrayVars = new Set<string>();
export const activeArrayLiteralVars = new Set<string>();
export const activeStringVars = new Set<string>();
export const mutableArrayVars = new Set<string>();
export const arrayLiteralSizes = new Map<string, number>();
export const filteredArrayLengthVars = new Map<string, string>();
export const activeNamespaceNames = new Set<string>();
export const topLevelClassNames = new Set<string>();
export const activeLocalTypes = new Map<string, string>();
```

**Impact:** This makes the code impossible to test in parallel, creates hidden coupling between unrelated functions, and makes it very difficult to reason about correctness. The `resetBuildState()` / `resetFunctionScopeState()` pattern is fragile — any new state added must be manually wired into the reset function.

**Recommendation:** The codebase has already started migrating to class-based renderers ([`ExpressionRenderer`](packages/transpiler/src/emit/expression-renderer.ts:51), [`StatementRenderer`](packages/transpiler/src/emit/statement-renderer.ts:69)). Complete this migration by:
1. Creating an `EmitContext` class that holds all emitter state
2. Creating a `BuildIRContext` class that holds all IR builder state
3. Passing these context objects explicitly through the call chain
4. Removing all module-level mutable state

---

## 🟠 High Issues

### 4. Type duplication across packages

Several core types are defined independently in multiple packages:

| Type | Defined in |
|------|-----------|
| `Diagnostic` | [`packages/transpiler/src/types.ts:53`](packages/transpiler/src/types.ts:53), [`packages/cli/src/types.ts:53`](packages/cli/src/types.ts:53), [`packages/core/src/shared/types.ts:28`](packages/core/src/shared/types.ts:28) |
| `SourceSpan` | [`packages/transpiler/src/types.ts:16`](packages/transpiler/src/types.ts:16), [`packages/cli/src/types.ts:16`](packages/cli/src/types.ts:16), [`packages/core/src/shared/types.ts:10`](packages/core/src/shared/types.ts:10) |
| `PlatformContext` | [`packages/transpiler/src/types.ts:8`](packages/transpiler/src/types.ts:8), [`packages/cli/src/types.ts:8`](packages/cli/src/types.ts:8), [`packages/core/src/shared/types.ts:54`](packages/core/src/shared/types.ts:54) |
| `TargetProfile` | [`packages/transpiler/src/types.ts:2`](packages/transpiler/src/types.ts:2), [`packages/cli/src/types.ts:2`](packages/cli/src/types.ts:2), [`packages/core/src/shared/types.ts:42`](packages/core/src/shared/types.ts:42), [`packages/core/src/shared/polyfill-types.ts:8`](packages/core/src/shared/polyfill-types.ts:8) |
| `BoardConstants` | [`packages/transpiler/src/ir/board-resolver.ts:29`](packages/transpiler/src/ir/board-resolver.ts:29), [`packages/core/src/shared/board-resolver.ts:12`](packages/core/src/shared/board-resolver.ts:12), [`packages/core/src/shared/ir.ts`](packages/core/src/shared/ir.ts) |
| `TypehalReceiverKind` | [`packages/transpiler/src/ir/typehal-symbols.ts:15`](packages/transpiler/src/ir/typehal-symbols.ts:15), [`packages/core/src/shared/typehal-symbols.ts:12`](packages/core/src/shared/typehal-symbols.ts:12) |
| `PeripheralUsage` / `PeripheralUsageIR` | [`packages/transpiler/src/ir/peripheral-usage.ts:14`](packages/transpiler/src/ir/peripheral-usage.ts:14), [`packages/core/src/shared/ir.ts:88`](packages/core/src/shared/ir.ts:88) |

**Impact:** Changes to a type must be replicated in multiple locations. If the definitions drift, type-checking may pass in one package but fail in another, or subtle behavioral differences may emerge.

**Recommendation:** All shared types should be defined once in `@typehal/core` and imported everywhere else. The transpiler and CLI should never define their own `Diagnostic`, `SourceSpan`, etc.

---

### 5. Giant monolithic files

| File | Lines | Concern |
|------|-------|---------|
| [`cpp-emitter.ts`](packages/transpiler/src/emit/cpp-emitter.ts) | 3,172 | Contains rendering, boilerplate, file I/O, strategy delegation, enum registration |
| [`statement-to-ir.ts`](packages/transpiler/src/ir/statement-to-ir.ts) | 2,591 | Handles every statement type in one file |
| [`transpile.ts`](packages/transpiler/src/transpile.ts) | 1,081 | Import resolution, type-checking, IR building orchestration, file writing |
| [`ownership-analysis.ts`](packages/transpiler/src/ir/ownership-analysis.ts) | 991 | Complex analysis in a single file |
| [`type-inference.ts`](packages/transpiler/src/emit/utils/type-inference.ts) | 705 | All type inference logic in one file |
| [`type-resolution.ts`](packages/transpiler/src/ir/type-resolution.ts) | 830 | All type resolution logic in one file |

**Impact:** Files over ~500 lines are difficult to navigate, review, and test. Cognitive load increases non-linearly with file size.

**Recommendation:** Break down the largest files:
- `cpp-emitter.ts` → Already partially decomposed into `ExpressionRenderer` and `StatementRenderer`; complete the migration and extract boilerplate generation, file I/O, and enum registration into separate modules.
- `statement-to-ir.ts` → Split by statement category (control flow, declarations, assignments, calls).
- `transpile.ts` → Import resolution is already a natural boundary; extract it.

---

### 6. Partial refactoring dead-zone: dual rendering paths

The codebase has started migrating from module-level functions to class-based renderers:

- **Legacy path:** [`renderExpression()`](packages/transpiler/src/emit/cpp-emitter.ts:168) — a module-level function using module-level state
- **New path:** [`ExpressionRenderer`](packages/transpiler/src/emit/expression-renderer.ts:51) class — accepts context via constructor injection
- **Legacy path:** Module-level statement rendering in `cpp-emitter.ts`
- **New path:** [`StatementRenderer`](packages/transpiler/src/emit/statement-renderer.ts:69) class

Both paths exist simultaneously. The `emitCpp()` function at line ~500+ of `cpp-emitter.ts` still uses the legacy path for most rendering, while the new classes exist but may not be fully wired.

**Impact:** Developers must understand both paths. Bug fixes may be applied to one path but not the other. The migration is incomplete, creating a "worst of both worlds" situation.

**Recommendation:** Complete the migration to class-based rendering. Either:
1. Finish wiring `StatementRenderer`/`ExpressionRenderer` into `emitCpp()` and remove the legacy `renderExpression()` function, OR
2. If the class-based approach is abandoned, remove the classes to avoid confusion.

---

### 7. `isPrimitiveCppType()` duplicated 3 times

Identical implementations in:

- [`packages/transpiler/src/emit/cpp-emitter.ts:398`](packages/transpiler/src/emit/cpp-emitter.ts:398)
- [`packages/transpiler/src/emit/statement-renderer.ts:53`](packages/transpiler/src/emit/statement-renderer.ts:53)
- [`packages/transpiler/src/ir/ownership-analysis.ts:23`](packages/transpiler/src/ir/ownership-analysis.ts:23)

Each creates a new `Set` on every call.

**Recommendation:** Extract to a shared utility module and memoize the `Set`.

---

### 8. `PeripheralUsage` interface vs `PeripheralUsageIR` type drift

[`PeripheralUsage`](packages/transpiler/src/ir/peripheral-usage.ts:14) in the transpiler is a `class`-like interface with 15+ fields including `Set<>` members. [`PeripheralUsageIR`](packages/core/src/shared/ir.ts:88) in core is a simpler type with only boolean flags.

The validation orchestrator at [`validation-orchestrator.ts:23`](packages/transpiler/src/ir/validation-orchestrator.ts:23) casts between them:

```typescript
const peripheralUsage = (program.peripheralUsage as PeripheralUsage | undefined) ?? createEmptyPeripheralUsage();
```

**Impact:** The two types can drift silently. The cast is a code smell indicating the types are not properly aligned.

**Recommendation:** Define a single canonical `PeripheralUsage` type in `@typehal/core` and use it everywhere.

---

## 🟡 Medium Issues

### 9. `packages/hal` and `packages/schema` are near-identical

Both packages export the exact same types and builder functions:

- [`packages/hal/src/index.ts`](packages/hal/src/index.ts:1) vs [`packages/schema/src/index.ts`](packages/schema/src/index.ts:1) — identical exports
- [`packages/hal/src/board/types.ts`](packages/hal/src/board/types.ts:1) vs [`packages/schema/src/board/types.ts`](packages/schema/src/board/types.ts:1) — identical types
- [`packages/hal/src/board/builder.ts`](packages/hal/src/board/builder.ts:1) vs [`packages/schema/src/board/builder.ts`](packages/schema/src/board/builder.ts:1) — identical builder (797 lines)

**Recommendation:** Eliminate one package. Have the surviving package re-export from the other, or merge them into a single `@typehal/board-schema` package.

---

### 10. Temporary/debug files committed to source

```
packages/transpiler/tmp-arduino-helper-usage.txt
packages/transpiler/tmp-board-type-refs.txt
packages/transpiler/tmp-core-from.txt
packages/transpiler/tmp-wrapper-imports.txt
```

**Recommendation:** Delete these files and add `tmp-*.txt` to `.gitignore`.

---

### 11. `SnprintfExpressionRenderer` uses `any`

In [`packages/core/src/shared/snprintf-types.ts:34`](packages/core/src/shared/snprintf-types.ts:34):

```typescript
export type SnprintfExpressionRenderer = (expr: any) => string;
```

**Recommendation:** Type this as `(expr: ExpressionIR) => string` and import `ExpressionIR`.

---

### 12. `config-loader.ts` AST helpers duplicated

The functions `getStringLiteral()`, `getScalarValue()`, and `walkObjectLiteral()` are independently implemented in:

- [`packages/transpiler/src/config-loader.ts:78-100`](packages/transpiler/src/config-loader.ts:78)
- [`packages/cli/src/config-loader.ts:72-100`](packages/cli/src/config-loader.ts:72)

And similar patterns exist in [`packages/transpiler/src/ir/board-resolver.ts`](packages/transpiler/src/ir/board-resolver.ts:1).

**Recommendation:** Extract shared AST parsing utilities into a common module.

---

### 13. `renderBoilerplate()` uses JSON.stringify for feature detection

In [`packages/transpiler/src/emit/cpp-emitter.ts:450-452`](packages/transpiler/src/emit/cpp-emitter.ts:450):

```typescript
const serializedProgram = JSON.stringify(program);
const hasExistsHelper = serializedProgram.includes('typehal_exists(');
```

This serializes the entire IR to JSON just to check for string substrings. For large programs, this is wasteful and fragile (could match inside string literals or comments).

**Recommendation:** Add boolean flags to `ProgramIR` or use the existing `boilerplates` set for feature detection.

---

### 14. `PeripheralUsage` uses mutable Sets in an interface

[`PeripheralUsage`](packages/transpiler/src/ir/peripheral-usage.ts:14) exposes `Set<number>` and `Set<string>` fields. Since TypeScript interfaces don't enforce immutability, consumers can mutate these sets, causing side effects across the analysis pipeline.

**Recommendation:** Consider using `ReadonlySet<number>` in the interface and keeping the mutable version as a concrete class.

---

## 🔵 Low Issues

### 15. Inconsistent module-level state reset patterns

[`build-ir-state.ts`](packages/transpiler/src/ir/build-ir-state.ts:93) has `resetBuildState()` and `resetFunctionScopeState()`, but the emitter has no equivalent centralized reset. Each `emitCpp()` call manually sets module-level variables, making it easy to miss one.

### 16. `DOUBLE_QUOTE_PATTERN` and `DOUBLE_QUOTE_ESCAPE_PATTERN` are identical

In [`cpp-emitter.ts:49-50`](packages/transpiler/src/emit/cpp-emitter.ts:49):

```typescript
const DOUBLE_QUOTE_PATTERN = /"/g;
const DOUBLE_QUOTE_ESCAPE_PATTERN = /"/g;
```

### 17. `ExpressionRenderer` and `StatementRenderer` not used by `emitCpp()`

The new class-based renderers exist but the main `emitCpp()` function in `cpp-emitter.ts` still calls the legacy `renderExpression()` and inline statement rendering. This means the new classes are effectively dead code or only used in tests.

### 18. `PeripheralUsage` `createEmptyPeripheralUsage()` returns a new object every call

Multiple validation functions call `createEmptyPeripheralUsage()` as a default. This could be a frozen singleton for efficiency and safety.

---

## Dependency Diagram

```mermaid
graph TD
    CORE[@typehal/core]
    HAL[@typehal/hal]
    SCHEMA[@typehal/schema]
    TRANSPIILER[@typehal/transpiler]
    CLI[@typehal/cli]
    FW_ARDUINO[@typehal/framework-arduino]
    FW_AVR[@typehal/framework-avr]
    FW_NATIVE[@typehal/framework-native]

    HAL -->|depends on| CORE
    SCHEMA -->|depends on| CORE
    TRANSPIILER -->|depends on| CORE
    TRANSPIILER -->|depends on| FW_ARDUINO
    CLI -->|depends on| CORE
    CLI -->|depends on| FW_ARDUINO

    style CLI fill:#ff6b6b
    style TRANSPIILER fill:#ff6b6b
    style HAL fill:#ffd93d
    style SCHEMA fill:#ffd93d
```

The red-highlighted packages are near-identical duplicates. The yellow-highlighted packages are near-identical duplicates.

---

## Recommended Action Order

1. **Eliminate `packages/cli` ↔ `packages/transpiler` duplication** — This is the highest-impact change. Decide which package is canonical and make the other a thin re-export wrapper.
2. **Remove committed build artifacts** — Quick win, reduces repo noise immediately.
3. **Consolidate `packages/hal` ↔ `packages/schema`** — Same pattern as #1 but smaller scope.
4. **Consolidate shared types into `@typehal/core`** — Eliminate all type duplication.
5. **Complete the class-based renderer migration** — Finish what was started with `ExpressionRenderer`/`StatementRenderer`.
6. **Extract module-level mutable state into context objects** — Largest refactoring effort but critical for testability.
7. **Break down giant files** — Can be done incrementally as part of #5 and #6.
8. **Clean up temp files and minor issues** — Quick wins.
