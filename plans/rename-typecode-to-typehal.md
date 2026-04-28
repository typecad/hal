# Rename Plan: typecode → typeHAL

## Overview

Rename the entire workspace from **typecode** to **typeHAL**. This affects package names, CLI binaries, config files, TypeScript identifiers, generated C++ identifiers, documentation, and directory/file names.

## Naming Convention Mapping

| Current | New | Context |
|---------|-----|---------|
| `typecode` | `typehal` | Package names, CLI commands, file names, config |
| `TypeCode` | `TypeHAL` | Display names, prose, headings |
| `Typecode` | `Typehal` | PascalCase identifiers in TS |
| `@typecode/` | `@typehal/` | npm package scope |
| `typecode_` | `typehal_` | Generated C++ identifiers |
| `TYPECODE_` | `TYPEHAL_` | Generated C++ macros |
| `__typecode_` | `__typehal_` | Generated C++ temp variables |
| `typecode-call` | `typehal-call` | IR node kind string |
| `typecode_async` | `typehal_async` | C++ namespace |
| `tscppmap` | `thcppmap` | Source map file extension |
| `.typecode/` | `.typehal/` | Debug config directory |
| `.typecode-cache.json` | `.typehal-cache.json` | Incremental cache file |
| `typecode.config.ts` | `typehal.config.ts` | Project config file |
| `typecode-env.d.ts` | `typehal-env.d.ts` | Virtual module declaration |
| `typecode-test` | `typehal-test` | Test runner CLI binary |
| `create-typecode` | `create-typehal` | Scaffolding CLI binary |
| `vscode-typecode-debug` | `vscode-typehal-debug` | VS Code extension |

## Specific Identifier Mappings

### TypeScript Interfaces/Types
| Current | New |
|---------|-----|
| `TypecodeConfig` | `TypehalConfig` |
| `TypecodeReceiverKind` | `TypehalReceiverKind` |
| `TypecodeCallStatementIR` | `TypehalCallStatementIR` |
| `ResolvedTypecodeConfig` | `ResolvedTypehalConfig` |

### TypeScript Functions
| Current | New |
|---------|-----|
| `loadTypecodeConfig()` | `loadTypehalConfig()` |
| `inferKindByName()` | stays same |

### Generated C++ Identifiers
| Current | New |
|---------|-----|
| `typecode_nullish()` | `typehal_nullish()` |
| `typecode_exists()` | `typehal_exists()` |
| `typecode_halt` | `typehal_halt` |
| `typecode_pump_microtasks()` | `typehal_pump_microtasks()` |
| `TYPECODE_UNDEFINED` | `TYPEHAL_UNDEFINED` |
| `__typecode_str_N` | `__typehal_str_N` |
| `__typecode_float_N` | `__typehal_float_N` |
| `__typecode_println_N` | `__typehal_println_N` |
| `__typecode_spi_result` | `__typehal_spi_result` |
| `namespace typecode_async` | `namespace typehal_async` |

### File/Module Exports
| Current | New |
|---------|-----|
| `typecode-symbols` | `typehal-symbols` |
| `typecode-map.ts` | `typehal-map.ts` |
| `typecode/platform` | `typehal/platform` |
| `typecode/polyfill` | `typehal/polyfill` |
| `typecode/ir` | `typehal/ir` |

---

## Phase 1: Rename Files and Directories

### Config files to rename
- `demo/typecode.config.ts` → `demo/typehal.config.ts`
- `demo/typecode-env.d.ts` → `demo/typehal-env.d.ts`
- `native_demo/typecode.config.ts` → `native_demo/typehal.config.ts`
- `examples/typecode-env.d.ts` → `examples/typehal-env.d.ts`
- `packages/framework-arduino/typecode.config.ts` → `packages/framework-arduino/typehal.config.ts`

### Source files to rename
- `packages/framework-arduino/src/typecode-map.ts` → `packages/framework-arduino/src/typehal-map.ts`
- `packages/core/src/shared/typecode-symbols.ts` → `packages/core/src/shared/typehal-symbols.ts`
- `packages/core/src/shared/typecode-symbols.d.ts` → `packages/core/src/shared/typehal-symbols.d.ts`
- `packages/core/src/shared/typecode-symbols.js` → `packages/core/src/shared/typehal-symbols.js`
- `packages/core/src/shared/typecode-symbols.js.map` → `packages/core/src/shared/typehal-symbols.js.map`
- `packages/core/src/shared/typecode-symbols.d.ts.map` → `packages/core/src/shared/typehal-symbols.d.ts.map`
- `packages/cli/src/ir/typecode-symbols.ts` → `packages/cli/src/ir/typehal-symbols.ts`
- `packages/transpiler/src/ir/typecode-symbols.ts` → `packages/transpiler/src/ir/typehal-symbols.ts`

### Directories to rename
- `vscode-typecode-debug/` → `vscode-typehal-debug/`
- `.typecode/` → `.typehal/`

### Auto-generated files to DELETE (will regenerate)
- `demo/src/.typecode-cache.json`
- `native_demo/src/.typecode-cache.json`
- `packages/framework-arduino/tests/.typecode-cache.json`
- `demo/src/out/` (entire directory)
- `packages/framework-arduino/tests/out/` (entire directory)
- `packages/framework-arduino/.build/` (entire directory)

---

## Phase 2: Update All package.json Files

### Root `package.json`
- `"name": "typecode-monorepo"` → `"name": "typehal-monorepo"`
- All `@typecode/` references → `@typehal/`
- `"typecode-test"` → `"typehal-test"` in scripts

### Per-package `package.json` (14 packages)
Each needs:
- `"name": "@typecode/xxx"` → `"name": "@typehal/xxx"`
- All `@typecode/` in dependencies → `@typehal/`
- `"typecode"` in bin → `"typehal"`
- `"typecode-test"` in bin → `"typehal-test"`
- `"create-typecode"` in bin → `"create-typehal"`
- `"typecode-symbols"` in exports → `"typehal-symbols"`

Packages affected:
1. `packages/core/package.json`
2. `packages/hal/package.json`
3. `packages/cli/package.json`
4. `packages/transpiler/package.json`
5. `packages/framework-avr/package.json`
6. `packages/framework-arduino/package.json`
7. `packages/framework-native/package.json`
8. `packages/board-arduino-uno/package.json`
9. `packages/board-esp32-devkit/package.json`
10. `packages/simulator/package.json`
11. `packages/expect/package.json`
12. `packages/create/package.json`
13. `packages/schema/package.json`
14. `demo/package.json`
15. `native_demo/package.json`
16. `vscode-typehal-debug/package.json`

---

## Phase 3: Update All tsconfig.json Files

### Path mappings to update
- `"@typecode"` → `"@typehal"`
- `"@typecode/*"` → `"@typehal/*"`
- `"@typecode/core"` → `"@typehal/core"`
- `"@typecode/board-*"` → `"@typehal/board-*"`
- `"@typecode/expect"` → `"@typehal/expect"`
- `"typecode/platform"` → `"typehal/platform"`

### Include patterns
- `"typecode.config.ts"` → `"typehal.config.ts"`
- `"typecode-env.d.ts"` → `"typehal-env.d.ts"`

Files affected:
- `demo/tsconfig.json`
- `native_demo/tsconfig.json`
- `examples/tsconfig.json`
- `packages/board-arduino-uno/tsconfig.json`
- `packages/board-esp32-devkit/tsconfig.json`
- `packages/framework-arduino/tests/tsconfig.json`
- `tests/tsconfig.json`

---

## Phase 4: Update TypeScript Source Files

### 4a. Import statements (~100+ files)
All `from '@typecode/xxx'` → `from '@typehal/xxx'`
All `from '@typecode'` → `from '@typehal'`

### 4b. Type references (~50+ files)
- `TypecodeConfig` → `TypehalConfig`
- `TypecodeReceiverKind` → `TypehalReceiverKind`
- `TypecodeCallStatementIR` → `TypehalCallStatementIR`
- `ResolvedTypecodeConfig` → `ResolvedTypehalConfig`

### 4c. IR node kind strings (~30+ files)
- `"typecode-call"` → `"typehal-call"` in all IR builders, validators, emitters

### 4d. Generated C++ string literals (~20+ files)
- `typecode_nullish` → `typehal_nullish`
- `typecode_exists` → `typehal_exists`
- `typecode_halt` → `typehal_halt`
- `typecode_pump_microtasks` → `typehal_pump_microtasks`
- `TYPECODE_UNDEFINED` → `TYPEHAL_UNDEFINED`
- `__typecode_str_` → `__typehal_str_`
- `__typecode_float_` → `__typehal_float_`
- `__typecode_println_` → `__typehal_println_`
- `__typecode_spi_result` → `__typehal_spi_result`
- `namespace typecode_async` → `namespace typehal_async`

### 4e. Config file references (~15+ files)
- `typecode.config.ts` → `typehal.config.ts` in string literals
- `typecode-env.d.ts` → `typehal-env.d.ts` in string literals
- `.typecode-cache.json` → `.typehal-cache.json` in string literals
- `.typecode/` → `.typehal/` in string literals

### 4f. File extension references
- `.tscppmap.json` → `.thcppmap.json` in source-map.ts files

### 4g. Module path exports
- `typecode-symbols` → `typehal-symbols` in package.json exports and import paths
- `typecode-map` → `typehal-map` in import paths

### 4h. Function names
- `loadTypecodeConfig` → `loadTypehalConfig`
- `ResolvedTypecodeConfig` → `ResolvedTypehalConfig`

---

## Phase 5: Update Documentation

### Top-level docs
- `README.md` — extensive typecode references
- `CLAUDE.md` — project instructions

### docs/ directory (~30 files)
- `docs/README.md`
- `docs/hal-guide.md`
- `docs/framework-authoring-guide.md`
- `docs/architecture/README.md`
- `docs/architecture/development-guide.md`
- `docs/architecture/registers.md`
- `docs/board/builder-api.md`
- `docs/board/development-guide.md`
- `docs/board/README.md`
- `docs/board/usage-guide.md`
- `docs/cli/configuration.md`
- `docs/cli/README.md`
- `docs/cli/reference.md`
- `docs/debug/README.md`
- `docs/expect/cli-reference.md`
- `docs/expect/README.md`
- `docs/expect/writing-tests.md`
- `docs/simulator/board-factory.md`
- `docs/simulator/bus-simulation.md`
- `docs/simulator/gpio-simulation.md`
- `docs/simulator/README.md`
- `docs/toolchain/arduino-cli.md`
- `docs/toolchain/README.md`
- `docs/transpiler/arduino-libs.md`
- `docs/transpiler/ir-model.md`
- `docs/transpiler/language-reference.md`
- `docs/transpiler/ownership.md`
- `docs/transpiler/polyfill-plugins.md`
- `docs/transpiler/polyfills.md`
- `docs/transpiler/README.md`

### promo/ directory (~6 files)
- `promo/index.md`
- `promo/quickstart.md`
- `promo/typescript-to-cpp.md`
- `promo/hardware-safety.md`
- `promo/ownership-and-safety.md`
- `promo/test-and-simulate.md`

### Package READMEs
- `packages/core/README.md`
- `packages/framework-avr/README.md`
- `packages/framework-arduino/README.md`
- `packages/expect/README.md`
- `packages/board-arduino-uno/README.md`
- `packages/board-arduino-uno/src/USAGE.md`
- `examples/README.md`
- `demo/README.md`

---

## Phase 6: Update CLI Help Text and Scaffolding Templates

### CLI help text
- `packages/cli/src/utils/cli.ts` — all usage examples
- `packages/transpiler/src/utils/cli.ts` — all usage examples
- `packages/expect/src/host/cli.ts` — test runner help

### Scaffolding templates
- `packages/create/src/init-templates.ts` — generated project files
- `packages/cli/src/scaffold/init-templates.ts` — generated project files
- `packages/transpiler/src/scaffold/init-templates.ts` — generated project files

These templates generate `typecode.config.ts`, `typecode-env.d.ts`, `package.json`, `tsconfig.json`, `.gitignore` for new projects — all must reference `typehal` instead of `typecode`.

---

## Phase 7: Update Config/Meta Files

- `.changeset/config.json` — fixed package list
- `.gitignore` — `demo/typecode.config.js` → `demo/typehal.config.js`
- `vitest.config.ts` — comment referencing `@typecode/expect`
- `.github/copilot-instructions.md` — full rewrite of references
- `test-results.json` / `test-results-new.json` — can be deleted (auto-generated)

---

## Phase 8: Update VS Code Extension

- `vscode-typehal-debug/package.json` — name, displayName, publisher, commands, activation events
- `vscode-typehal-debug/src/extension.ts` — all string references
- `vscode-typehal-debug/src/extension.js` — compiled output (or delete and rebuild)
- `vscode-typehal-debug/out/extension.js` — compiled output (or delete and rebuild)

---

## Phase 9: Delete Auto-Generated Artifacts

- `demo/src/.typecode-cache.json`
- `native_demo/src/.typecode-cache.json`
- `packages/framework-arduino/tests/.typecode-cache.json`
- `demo/src/out/` (build output directory)
- `packages/framework-arduino/tests/out/` (build output directory)
- `packages/framework-arduino/.build/` (build output directory)
- `test-results.json`
- `test-results-new.json`
- All `dist/` directories (rebuild after rename)
- All `.tsbuildinfo` files

---

## Phase 10: Regenerate package-lock.json

After all package.json changes:
```bash
rm package-lock.json
npm install
```

---

## Phase 11: Verify

```bash
npm run typecheck
npm test
npm run build --workspaces
```

---

## Execution Strategy

This is a large-scale find-and-replace operation. The recommended approach is:

1. **Use a scripted approach** — a Node.js or shell script that performs all the string replacements across all file types in one pass
2. **Then rename files/directories** — after content is updated
3. **Then regenerate** — delete caches, lock files, and rebuild

### Suggested replacement order (to avoid double-replacement issues):
1. First replace longest/most-specific patterns to avoid partial matches:
   - `TYPECODE_UNDEFINED` → `TYPEHAL_UNDEFINED`
   - `__typecode_` → `__typehal_`
   - `typecode_nullish` → `typehal_nullish`
   - `typecode_exists` → `typehal_exists`
   - `typecode_halt` → `typehal_halt`
   - `typecode_pump_microtasks` → `typehal_pump_microtasks`
   - `typecode_async` → `typehal_async`
   - `typecode-call` → `typehal-call`
   - `typecode-symbols` → `typehal-symbols`
   - `typecode-map` → `typehal-map`
   - `typecode.config` → `typehal.config`
   - `typecode-env` → `typehal-env`
   - `typecode-test` → `typehal-test`
   - `create-typecode` → `create-typehal`
   - `typecode-monorepo` → `typehal-monorepo`
   - `typecode-demo` → `typehal-demo`
   - `typecode-native-demo` → `typehal-native-demo`
   - `vscode-typecode-debug` → `vscode-typehal-debug`
   - `.typecode-cache` → `.typehal-cache`
   - `.tscppmap` → `.thcppmap`
   - `@typecode/` → `@typehal/`
   - `@typecode` → `@typehal`
   - `TypecodeConfig` → `TypehalConfig`
   - `TypecodeReceiverKind` → `TypehalReceiverKind`
   - `TypecodeCallStatementIR` → `TypehalCallStatementIR`
   - `ResolvedTypecodeConfig` → `ResolvedTypehalConfig`
   - `loadTypecodeConfig` → `loadTypehalConfig`
   - `TypeCode` → `TypeHAL`
   - `Typecode` → `Typehal`
   - `typecode` → `typehal`

### Files to EXCLUDE from replacement
- `node_modules/` — managed by npm
- `dist/` directories — regenerated from source
- `.git/` — version control metadata
- `package-lock.json` — regenerated

---

## Risk Areas

1. **Generated C++ output** — Tests assert against specific C++ strings like `typecode_nullish`. All test expectations must be updated in lockstep with the emitter changes.
2. **IR node kind strings** — The string `"typecode-call"` is used as a discriminated union kind in many places. Must be changed consistently.
3. **File path references in caches** — The `.typecode-cache.json` files contain absolute paths with `typecode` in them. These should be deleted rather than edited.
4. **Binary names in package.json `bin` fields** — These determine CLI command names. Changing `"typecode"` to `"typehal"` means users will run `npx typehal` instead of `npx typecode`.
5. **VS Code extension activation events** — The `workspaceContains:**/typecode.config.ts` pattern must be updated.
