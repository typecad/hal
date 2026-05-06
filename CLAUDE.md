# TypeHAL — Claude Instructions

TypeHAL is a TypeScript-to-C++ transpiler for embedded firmware (primary target: Arduino/AVR).
Users write TypeScript against typed hardware abstractions; the transpiler emits `.ino`/`.cpp` files
with board-aware diagnostics (wrong pin, uninitialized bus, etc.) caught at edit time.

---

## Repo structure

```
packages/
  transpiler/          Core transpile pipeline (IR build → validation → C++ emission)
  framework-arduino/   Arduino/AVR platform strategy
  framework-avr/       AVR-specific low-level helpers
  framework-native/    Native (non-hardware) framework for dev/test
  cli/                 CLI entry point — thin wrappers; heavy logic is in transpiler/framework-*
  core/                Shared runtime types (@typehal public API)
  typehal/             Hardware Abstraction Layer — now packages/hal (emit/include/board directives)
  board-arduino-uno/   Board pin/peripheral data for Arduino Uno
  board-esp32-devkit/  Board data for ESP32 DevKit
  schema/              Config file schema
  simulator/           Simulation runtime
  expect/              Hardware test assertion library
  create/              Project scaffolding (npx create-typehal)
tests/                 Transpiler unit tests (vitest) — assertions check emitted C++ or diagnostic codes
tests/packages/        Per-package unit tests (cli/, transpiler/, hal/, etc.)
examples/              Runnable TypeScript firmware examples
demo/                  Demo workspace (builds via installed CLI)
docs/                  Architecture and language reference docs
```

---

## Where to edit what

| Goal | Primary file(s) |
|------|----------------|
| IR model types | `packages/transpiler/src/ir/model.ts` |
| AST → IR (statements) | `packages/transpiler/src/ir/statement-to-ir.ts` |
| AST → IR (expressions) | `packages/transpiler/src/ir/expression-to-ir.ts` |
| AST → IR (declarations) | `packages/transpiler/src/ir/declaration-builders.ts` |
| AST → IR (functions) | `packages/transpiler/src/ir/function-builder.ts` |
| AST → IR (namespaces) | `packages/transpiler/src/ir/namespace-builder.ts` |
| IR build entry / orchestration | `packages/transpiler/src/ir/build-ir.ts` |
| C++ emission | `packages/transpiler/src/emit/cpp-emitter.ts` |
| Expression rendering | `packages/transpiler/src/emit/expression-renderer.ts` |
| Statement rendering | `packages/transpiler/src/emit/statement-renderer.ts` |
| Function emission | `packages/transpiler/src/emit/function-emitter.ts` |
| Setup block emission | `packages/transpiler/src/emit/setup-emitter.ts` |
| Arduino platform strategy | `packages/framework-arduino/src/strategy.ts` |
| Arduino type/symbol mapping | `packages/framework-arduino/src/typehal-map.ts` |
| Arduino class map | `packages/framework-arduino/src/arduino-class-map.ts` |
| Arduino snprintf helpers | `packages/framework-arduino/src/arduino-snprintf.ts` |
| Board pin data (Uno) | `packages/board-arduino-uno/` |
| Board pin data (ESP32) | `packages/board-esp32-devkit/` |
| Validation orchestration | `packages/transpiler/src/ir/validation-orchestrator.ts` |
| Per-pin capability checks | `packages/transpiler/src/ir/pin-capability-validation.ts` |
| Peripheral conflict checks | `packages/transpiler/src/ir/peripheral-pin-conflict.ts` |
| ISR safety | `packages/transpiler/src/ir/interrupt-analysis.ts` |
| Ownership analysis | `packages/transpiler/src/ir/ownership-analysis.ts` |
| Incremental build cache | `packages/transpiler/src/incremental-cache.ts` |

---

## Build & test

```bash
# Run all tests
npm vitest run

# Run a specific test file
npm vitest run tests/expressions.test.ts --reporter=verbose

# Rebuild packages (required before CLI picks up source changes)
# Correct build order for transpiler changes:
npm run build --workspace @typehal/core
npm run build --workspace @typehal/framework-arduino
npm run build --workspace @typehal/transpiler

# Type-check the whole repo
npm tsc -b
```

Tests live in `tests/` (transpiler) and `tests/packages/` (per-package).
~768 tests pass on main. The root `tsconfig.json` is solution-style (`"files": []`) — do not add source globs to it.

---

## Key conventions

### Lowering / emission
- **Nullish coalescing** (`??`) must lower via `typehal_nullish` helper — never a truthy ternary — so `0` and `false` are preserved as values.
- **Optional chaining** lowers through a `typehal_exists` guard.
- **Template literals** lower to stack `char` buffers + `snprintf`, preserving TS variable names.
- **Arduino string declarations** must not double-prefix `const`; `Array`/`ReadonlyArray` emits C-style arrays (no STL).
- **Top-level object literals** used as destructuring sources must be emitted as globals.
- **Free-function prototypes** must appear before `setup()` when top-level code calls helpers defined later. Default arguments go on the declaration, not the later definition.
- **Negative numeric literals** inside typed arrays are compile-time-safe — do not migrate them into `setup()`.
- The `typehal_nullish` helper signature is `template <typename T, typename U> inline T typehal_nullish(T value, U fallback)` so mixed types (e.g. `uint8_t` fallback) compile cleanly.

### Board-aware diagnostics
- Numeric object keys must survive board-resolver flattening (e.g. `pins.i2c { 0: { ... } }` needs `NumericLiteral` property support).
- ADC validation is board-data-driven — returns `null` when board data is missing; no MCU-name fallbacks.
- ISR-unsafe operations are parameterized via `PlatformStrategy.isrUnsafeOperations()`.

### Tests
- Assert against concrete emitted C++ text or specific diagnostic codes.
- Avoid smoke-style checks (`toBeDefined()`) or generic substrings (`"for"`, single variable names).

### Framework changes
- Changes under `packages/framework-arduino` are consumed through built package output during transpile. Rebuild that package **and** the CLI after any `strategy.ts` / `typehal-map.ts` edits.

---

## Incremental cache

Cache lives at `<source-root>/.typehal-cache.json`. It includes a toolchain fingerprint from
`transpile/`, `emit/`, and `ir/` files. If emission regresses unexpectedly, delete
`demo/src/.typehal-cache.json` and regenerate before debugging the transpiler.

---

## What NOT to touch

- `dist/` directories — generated build output, never edit directly.
- `node_modules/` — managed by npm.
- Root `tsconfig.json` — solution-style, `"files": []` intentional.
- `.typehal-cache.json` files — auto-generated cache, delete to bust.
