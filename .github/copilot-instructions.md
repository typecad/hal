# TypeCAD/Cuttlefish — Copilot Instructions

Cuttlefish is a TypeScript-to-C++ transpiler for embedded firmware (primary target: Arduino/AVR).
Users write TypeScript against typed hardware abstractions; the transpiler emits `.ino`/`.cpp` files
with board-aware diagnostics (wrong pin, uninitialized bus, etc.) caught at edit time.

---

## Repo structure

```
packages/
  cuttlefish/          Core transpile pipeline — IR build → validation → C++ emission, CLI, incremental cache (@typecad/cuttlefish)
  framework-arduino/   Arduino/AVR platform strategy
  framework-avr/       AVR-specific low-level helpers
  framework-native/    Native (non-hardware) framework for dev/test
  hal/                 Hardware Abstraction Layer type definitions
  board-arduino-uno/   Board pin/peripheral data for Arduino Uno
  board-esp32-devkit/  Board data for ESP32 DevKit
  board-esp32c3/       Board data for ESP32-C3
  board-esp32c6/       Board data for ESP32-C6
  board-esp32s3/       Board data for ESP32-S3
  mcu-atmega328p/      MCU metadata for ATmega328P
  mcu-esp32/           MCU metadata for ESP32 family
  ui/                  UI/display-graphics authoring library (@typecad/ui)
  simulator/           Simulation runtime
  expect/              Hardware test assertion library (@typecad/expect)
tests/                 Transpiler unit tests (vitest) — most assertions check emitted C++ or diagnostic codes
tests/packages/        Per-package unit tests (cuttlefish/, hal/, etc.)
docs/                  Architecture and language reference docs
```

---

## Where to edit what

| Goal | Primary file(s) |
|------|----------------|
| AST → IR (statements) | `packages/cuttlefish/src/ir/statement-to-ir.ts` |
| AST → IR (expressions) | `packages/cuttlefish/src/ir/expression-to-ir.ts` |
| AST → IR (declarations) | `packages/cuttlefish/src/ir/declaration-builders.ts` |
| AST → IR (functions) | `packages/cuttlefish/src/ir/function-builder.ts` |
| AST → IR (namespaces) | `packages/cuttlefish/src/ir/namespace-builder.ts` |
| IR build entry / orchestration | `packages/cuttlefish/src/ir/build-ir.ts` |
| C++ emission | `packages/cuttlefish/src/emit/cpp-emitter.ts` |
| Expression rendering | `packages/cuttlefish/src/emit/expression-renderer.ts` |
| Statement rendering | `packages/cuttlefish/src/emit/statement-renderer.ts` |
| Function emission | `packages/cuttlefish/src/emit/emitters/function-emitter-impl.ts` |
| Setup block emission | `packages/cuttlefish/src/emit/emitters/setup.ts` |
| Output finalization / shim lines | `packages/cuttlefish/src/emit/emitters/output-finalizer.ts` |
| Arduino platform strategy | `packages/framework-arduino/src/strategy.ts` |
| Arduino type/symbol mapping | `packages/framework-arduino/src/arduino-class-map.ts` |
| Arduino snprintf helpers | `packages/cuttlefish/src/emit/snprintf-helpers.ts` |
| Board pin data (Uno) | `packages/board-arduino-uno/` |
| Board pin data (ESP32) | `packages/board-esp32-devkit/` |
| Validation orchestration | `packages/cuttlefish/src/ir/build-ir.ts` |
| Per-pin capability checks | `packages/cuttlefish/src/ir/pin-capability-validation.ts` |
| Peripheral conflict checks | `packages/cuttlefish/src/ir/peripheral-validation.ts` |
| ISR safety | `packages/cuttlefish/src/ir/interrupt-analysis.ts` |
| Ownership analysis | `packages/cuttlefish/src/ir/ownership-analysis.ts` |
| Incremental build cache | `packages/cuttlefish/src/incremental-cache.ts` |

---

## Build & test

```powershell
# Run all tests
pnpm vitest run

# Run a specific test file
pnpm vitest run tests/expressions.test.ts --reporter=verbose

# Rebuild packages (required before CLI picks up changes)
pnpm --filter @typecad/cuttlefish build
pnpm --filter @typecad/framework-arduino build

# Type-check the whole repo
pnpm tsc -b
```

Tests live in `tests/` (transpiler) and `tests/packages/` (per-package).
The root `tsconfig.json` is solution-style (`"files": []`) — don't add source globs to it.

---

## Key conventions

- **Test assertions** must check concrete emitted C++ text or specific diagnostic codes.
  Avoid smoke-style checks (`toBeDefined()`) or generic substrings (`"for"`, single variable names).
- **Nullish coalescing** (`??`) must lower via the `cuttlefish_nullish` helper — never a truthy ternary —
  so `0` and `false` are preserved as values.
- **Optional chaining** lowers through a `cuttlefish_exists` guard.
- **Template literals** lower to stack `char` buffers (`__tc_str_N`, `__tc_float_N`) + `snprintf`, preserving TS variable names.
- **Arduino string declarations** must not double-prefix `const`; `Array`/`ReadonlyArray` emits C-style arrays.
- **Top-level object literals** used as destructuring sources must still be emitted as globals.
- **Free-function prototypes** must appear before `setup()` when top-level code calls helpers defined later.
  Default arguments go on the declaration, not the later definition.
- **Negative numeric literals** inside typed arrays are compile-time-safe — do not migrate them into `setup()`.
- The `cuttlefish_nullish` helper uses `template <typename T, typename U>` so mixed types (e.g. `uint8_t` fallback) compile.
- The undefined sentinel is `CUTTLEFISH_UNDEFINED`; the string buffer size macro is `CUTTLEFISH_STR_BUF_SIZE`.
- **Board-aware diagnostics** require numeric object keys to survive board-resolver flattening
  (e.g. `pins.i2c { 0: { ... } }` needs `NumericLiteral` property support).
- **ADC validation** is board-data-driven (returns `null` when data is missing — no MCU-name fallbacks).
- **ISR-unsafe operations** are parameterized via `PlatformStrategy.isrUnsafeOperations()`.

---

## Incremental cache

Cache lives at `<source-root>/.cuttlefish-cache.json`. It includes a toolchain fingerprint from
`transpile/`, `emit/`, and `ir/` files. If emission regresses unexpectedly, delete
`demo/src/.cuttlefish-cache.json` and regenerate before debugging the transpiler.

---

## What NOT to touch

- `dist/` directories — generated build output, never edit directly.
- `node_modules/` — managed by pnpm.
- Root `tsconfig.json` — solution-style, `"files": []` intentional.
- `.cuttlefish-cache.json` files — auto-generated cache, delete to bust.
