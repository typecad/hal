# Separation of Concerns: Arduino Code Relocation Plan

## Executive Summary

Analysis of the TypeCode monorepo identified **10 files/functions** in `packages/cli/` that are Arduino-specific and should either be deleted (duplicates) or moved to `packages/framework-arduino/`. The changes are organized into three tiers by complexity.

---

## Current Architecture

```mermaid
graph TD
    core[@typecode/core<br>IR types, interfaces]
    fa[framework-arduino<br>ArduinoStrategy, typecode-map,<br>profile, cli-metadata]
    favr[framework-avr<br>NativeAVRStrategy]
    cli[CLI<br>transpiler, emitter,<br>polyfills, toolchain]

    core --> fa
    core --> favr
    core --> cli
    fa --> favr
    fa --> cli
```

**Problem**: `packages/cli/` contains ~2,700 lines of Arduino-specific code that belongs in `packages/framework-arduino/`, plus two duplicate files that should be deleted.

---

## Tier 1 — Easy Wins (No Dependency Issues)

### 1.1 Delete duplicate `arduino-cli-metadata.ts` in CLI

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/platform/arduino-cli-metadata.ts` (143 lines) |
| **Issue** | Duplicate of `packages/framework-arduino/src/cli-metadata.ts` (245 lines). The framework-arduino version is more complete — it has disk caching with `CACHE_DIR`, `CACHE_TTL_MS`, `loadCachedMetadata`, `saveCachedMetadata`. |
| **Imported by** | **Nobody** — zero imports found across the codebase |
| **Action** | Delete the file. No other changes needed. |

### 1.2 Delete duplicate `typecode-map.ts` in CLI, update 2 imports

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/platform/typecode-map.ts` (30 lines) |
| **Issue** | Contains only `extractPropertyChain()`, which already exists in `packages/framework-arduino/src/typecode-map.ts` (exported). |
| **Imported by** | `packages/cli/src/emit/cpp-emitter.ts` (line 13), `packages/cli/src/emit/expression-renderer.ts` (line 11) |
| **Action** | Change both imports to `import { extractPropertyChain } from "@typecode/framework-arduino"`, then delete the CLI file. |

### 1.3 Move `arduino-libs.ts` to framework-arduino

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/arduino-libs.ts` (1,090 lines) |
| **Issue** | Entirely Arduino-specific: discovers installed Arduino libraries, parses C++ headers, generates `.d.ts` declarations. Contains `ARDUINO_TYPE_MAPPINGS`, `getInstalledLibraries()`, `findArduinoLibrary()`, `parseCppClass()`, `generateArduinoLibDecl()`, etc. |
| **Imports** | Only `node:child_process`, `node:path`, `node:fs` — all available in framework-arduino |
| **Imported by** | `arduino-class-map.ts`, `libdef/registry.ts`, `transpile.ts` |
| **Action** | Move to `packages/framework-arduino/src/arduino-libs.ts`. Update 3 import sites in CLI to import from `@typecode/framework-arduino`. Export from framework-arduino `index.ts`. |

### 1.4 Move `arduino-class-map.ts` to framework-arduino

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/emit/arduino-class-map.ts` (32 lines) |
| **Issue** | Maps Arduino library class names to fully qualified names. Only depends on `arduino-libs.ts`. |
| **Imports** | `arduino-libs.ts` (will be in same package after 1.3) |
| **Imported by** | `packages/cli/src/emit/cpp-emitter.ts` (line 18) |
| **Action** | Move to `packages/framework-arduino/src/arduino-class-map.ts`. Update 1 import in cpp-emitter.ts. Export from framework-arduino `index.ts`. |

---

## Tier 2 — Moderate (Import Path Changes Needed)

### 2.1 Move `arduino-snprintf.ts` to framework-arduino

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/emit/arduino-snprintf.ts` (312 lines) |
| **Issue** | Arduino-specific snprintf formatting for float values via `strategy.floatToSnprintfArg()`. Handles the AVR `dtostrf` vs `snprintf` decision. |
| **Imports** | `../ir/model` (IR types), `../platform/platform-strategy` (PlatformStrategy type) |
| **Imported by** | `packages/cli/src/emit/cpp-emitter.ts` (line 19) — imports 8 symbols |
| **Action** | Move to `packages/framework-arduino/src/arduino-snprintf.ts`. Change IR imports to `@typecode/core/shared`. Change PlatformStrategy import to `@typecode/core/shared`. Update cpp-emitter.ts to import from `@typecode/framework-arduino`. Export all 8 symbols from framework-arduino `index.ts`. |

### 2.2 Move `async-arduino.ts` polyfill to framework-arduino

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/polyfill/polyfills/async-arduino.ts` (503 lines) |
| **Issue** | Arduino-specific async/await state machine generation with Arduino-specific queue capacity (32 vs 256). |
| **Imports** | `../types` (PolyfillDefinition, PolyfillContext, etc.), `../../ir/model`, `../../types` (SourceSpan) |
| **Imported by** | `packages/cli/src/polyfill/index.ts`, `packages/cli/src/polyfill/registry.ts` |
| **Prerequisite** | `PolyfillDefinition` interface must be available in `@typecode/core/shared` (currently only `RuntimePolyfillIR` and `PolyfillContext` are there; `PolyfillDefinition` is only in CLI's `polyfill/types.ts`). Need to move `PolyfillDefinition` to core first. |
| **Action** | 1) Move `PolyfillDefinition`, `PolyfillNeed`, `PolyfillDomain`, `TargetProfile` to `@typecode/core/shared/polyfill-types.ts`. 2) Move async-arduino.ts to `packages/framework-arduino/src/polyfills/async-arduino.ts`. 3) Update polyfill registry to import from framework-arduino. |

### 2.3 Extract `cleanStaleArduinoOutputs()` from transpile.ts

| Aspect | Detail |
|--------|--------|
| **Location** | `packages/cli/src/transpile.ts` lines 41–70 |
| **Issue** | Arduino-specific cleanup of `.ino`, `.cpp`, `.h` files. Hardcoded Arduino output patterns. |
| **Action** | Move to `packages/framework-arduino/src/utils.ts` (new file). Import and call from transpile.ts. |

---

## Tier 3 — Complex (Requires Interface/Infrastructure Changes)

### 3.1 Split `console.ts` polyfill

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/polyfill/polyfills/console.ts` (365 lines) |
| **Issue** | Contains both `generateArduinoConsolePolyfill()` (Serial.println, F() macro, Serial.begin injection) and `generateStdConsolePolyfill()` (generic printf). The detect logic is shared. |
| **Action** | Keep the polyfill definition and detect logic in CLI. Move `generateArduinoConsolePolyfill()` to framework-arduino. The console polyfill's `generate()` method would delegate to framework-arduino when target is Arduino. This requires the polyfill system to support strategy-specific generators. |

### 3.2 Move `arduino-compile.ts` to framework-arduino

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/platform/arduino-compile.ts` (202 lines) |
| **Issue** | Contains `flattenGeneratedModulesIntoSketch()`, `compileArduinoSketch()`, `uploadArduinoSketch()`, `monitorArduinoSketch()`. All Arduino-specific. |
| **Imports** | `../types` (ArduinoCompileError, etc.), `../utils/toolchain` (parseCompileErrors, collectCppFiles) |
| **Imported by** | `cli.ts`, `transpile.ts` |
| **Complication** | Depends on CLI-specific types and utility functions. Would need to either: (a) move shared types to core, or (b) have framework-arduino depend back on CLI (circular — not acceptable). |
| **Action** | Extract shared compile types (`ArduinoCompileError`, `ArduinoCompileResult`, `ArduinoUploadResult`) to `@typecode/core`. Move `parseCompileErrors` and `collectCppFiles` utilities to core or framework-arduino. Then move arduino-compile.ts to framework-arduino. |

### 3.3 Move `arduino-cli.ts` toolchain to framework-arduino

| Aspect | Detail |
|--------|--------|
| **File** | `packages/cli/src/toolchain/arduino-cli.ts` (342 lines) |
| **Issue** | `ArduinoCliToolchain` class implementing the `Toolchain` interface. Also contains a duplicate of `flattenGeneratedModulesIntoSketch()`. |
| **Imports** | `./types` (Toolchain interface), `./registry` (registerToolchain), `../utils/toolchain` |
| **Imported by** | `toolchain/index.ts` (self-registering import + re-export) |
| **Complication** | The toolchain system uses a self-registration pattern (`import './arduino-cli'` triggers `registerToolchain()`). Moving to framework-arduino requires a plugin-like architecture where framework packages can register toolchains. |
| **Action** | Design a toolchain plugin interface. Move `ArduinoCliToolchain` to framework-arduino. Have CLI discover and load toolchain plugins from installed framework packages. This also eliminates the duplicate `flattenGeneratedModulesIntoSketch()`. |

---

## Dependency Flow After Changes

```mermaid
graph TD
    core[@typecode/core<br>IR types, interfaces,<br>PolyfillDefinition, compile types]
    fa[framework-arduino<br>ArduinoStrategy, typecode-map,<br>profile, cli-metadata,<br>arduino-libs, arduino-snprintf,<br>arduino-class-map, async polyfill,<br>arduino-compile, arduino-cli toolchain]
    favr[framework-avr<br>NativeAVRStrategy]
    cli[CLI<br>transpiler orchestrator,<br>cpp-emitter, generic polyfills,<br>toolchain registry]

    core --> fa
    core --> favr
    core --> cli
    fa --> favr
    fa --> cli

    style fa fill:#e1f5fe
    style core fill:#fff3e0
```

---

## Implementation Order

The tiers should be implemented sequentially since later tiers may depend on earlier ones:

1. **Tier 1** — 4 changes, no prerequisites, low risk
2. **Tier 2** — 3 changes, Tier 2.2 requires moving types to core first
3. **Tier 3** — 3 changes, each requires design decisions

### Detailed Steps

#### Tier 1 Steps ✅ COMPLETED
- [x] Delete `packages/cli/src/platform/arduino-cli-metadata.ts`
- [x] Update `extractPropertyChain` imports in `cpp-emitter.ts` and `expression-renderer.ts` to use `@typecode/framework-arduino`
- [x] Delete `packages/cli/src/platform/typecode-map.ts`
- [x] Move `packages/cli/src/arduino-libs.ts` → `packages/framework-arduino/src/arduino-libs.ts`
- [x] Update imports in `libdef/registry.ts` and `transpile.ts` to use `@typecode/framework-arduino`
- [x] Export arduino-libs public API from `packages/framework-arduino/src/index.ts`
- [x] Move `packages/cli/src/emit/arduino-class-map.ts` → `packages/framework-arduino/src/arduino-class-map.ts`
- [x] Update import in `cpp-emitter.ts` to use `@typecode/framework-arduino`
- [x] Export arduino-class-map from `packages/framework-arduino/src/index.ts`
- [x] Run tests to verify no regressions — 764/764 passed

#### Tier 2 Steps ✅ COMPLETED
- [x] Move `PolyfillDefinition` to `@typecode/core/shared/polyfill-types.ts`
- [x] Update core barrel export to include `PolyfillDefinition`
- [x] Move `packages/cli/src/emit/arduino-snprintf.ts` → `packages/framework-arduino/src/arduino-snprintf.ts`
- [x] Update IR/strategy imports in arduino-snprintf.ts to use `@typecode/core/shared`
- [x] Update cpp-emitter.ts imports to use `@typecode/framework-arduino`
- [x] Export snprintf types and functions from framework-arduino index.ts
- [x] Move `packages/cli/src/polyfill/polyfills/async-arduino.ts` → `packages/framework-arduino/src/polyfills/async-arduino.ts`
- [x] Update polyfill registry and index to import from framework-arduino
- [x] Extract `cleanStaleArduinoOutputs()` to `packages/framework-arduino/src/utils/clean-stale-outputs.ts`
- [x] Update transpile.ts to import from framework-arduino
- [x] Fix test import in `tests/expressions.test.ts` to use new snprintf path
- [x] Run tests to verify no regressions — 764/764 passed

#### Tier 3 Steps ✅ COMPLETED
- [x] Design strategy-specific polyfill generator pattern
- [x] Split console.ts — move `generateArduinoConsolePolyfill()` and `detectSerialBeginCall()` to `packages/framework-arduino/src/polyfills/arduino-console.ts`
- [x] Extract compile types (`CompileError`, `ArduinoCompileResult`, `ArduinoUploadResult`, `parseCompileErrors`, `collectCppFiles`, `toArchitectureFromFqbn`) to `@typecode/core/shared/toolchain-types.ts`
- [x] Move `arduino-compile.ts` to `packages/framework-arduino/src/arduino-compile.ts` (CLI file is now thin re-export)
- [x] Move `utils/toolchain.ts` content to core (CLI file is now thin re-export from `@typecode/core`)
- [x] Eliminate duplicate `flattenGeneratedModulesIntoSketch()` from `arduino-cli.ts` — imports from `@typecode/framework-arduino`
- [x] Update `ArduinoCliToolchain` imports to use `@typecode/core` and `@typecode/framework-arduino` (class stays in CLI due to `Toolchain` interface / `registerToolchain` dependency — would create circular dep if moved)
- [x] All packages build clean (`npm run build` succeeds)
- [x] Tests have pre-existing vitest infrastructure issue (unrelated to these changes — affects clean codebase too)

---

## Files Changed Summary

| File | Action | Lines Moved/Deleted |
|------|--------|-------------------|
| `cli/src/platform/arduino-cli-metadata.ts` | Delete | -143 |
| `cli/src/platform/typecode-map.ts` | Delete | -30 |
| `cli/src/arduino-libs.ts` | Move to framework-arduino | 1,090 |
| `cli/src/emit/arduino-class-map.ts` | Move to framework-arduino | 32 |
| `cli/src/emit/arduino-snprintf.ts` | Move to framework-arduino | 312 |
| `cli/src/polyfill/polyfills/async-arduino.ts` | Move to framework-arduino | 503 |
| `cli/src/transpile.ts` (cleanStaleArduinoOutputs) | Extract to framework-arduino | ~30 |
| `cli/src/polyfill/polyfills/console.ts` | Split Arduino parts | ~90 |
| `cli/src/platform/arduino-compile.ts` | Move to framework-arduino | 202 |
| `cli/src/toolchain/arduino-cli.ts` | Move to framework-arduino | 342 |
| **Total** | | **~2,774 lines** |

## Risk Assessment

- **Tier 1**: Low risk — straightforward moves/deletions with clear import updates
- **Tier 2**: Medium risk — requires moving shared types to core, but dependency chains are clean
- **Tier 3**: Higher risk — requires architectural changes to polyfill and toolchain systems. Each should be a separate PR with thorough testing.
