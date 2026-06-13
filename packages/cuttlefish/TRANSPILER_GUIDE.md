# LLM TRANSPILER GUIDE

This guide is for language models and future maintainers investigating or extending the TypeCAD transpiler.

## Key files

- `packages/transpiler/src/cli.ts` — main CLI entry, command dispatch, build/watch flows
- `packages/transpiler/src/utils/cli.ts` — CLI option parser, command validation, help text
- `packages/transpiler/src/transpile.ts` — transpilation pipeline, import resolution, emit orchestration
- `packages/transpiler/src/emit/cpp-emitter.ts` — C++ emission logic and platform-specific codegen
- `packages/transpiler/src/config-loader.ts` — cuttlefish.config.ts loading and board/package config
- `packages/transpiler/src/cli-utils.ts` — shared CLI helpers like expect test runner and error mapping
- `packages/transpiler/src/mapping/source-map.ts` — source map I/O and C++ → TypeScript error mapping
- `packages/transpiler/src/watch.ts` — watch mode, directory discovery, rebuild callbacks

## Main code paths for creating or evaluating transpilation

### 1. CLI command entry

- `packages/transpiler/src/cli.ts` is the application's entrypoint.
- `main()` calls `parseCommandLine(process.argv)` from `packages/transpiler/src/utils/cli.ts`.
- CLI parsing produces one of: `default`, `build`, `gen-libdefs`, `gen-decls`, `map-error`, `create-board`, `init`.
- For `default` and `build`, CLI options are normalized and passed into the transpilation flow.

### 2. Config loading and effective option resolution

- `loadCuttlefishConfig()` from `packages/transpiler/src/config-loader.ts` reads `cuttlefish.config.ts`.
- Config values override CLI-supplied flags for board package, fqbn, target, outDir, framework, and console settings.
- `generateVirtualTypeDeclaration()` is used to keep editor type resolution aligned with bare `@typecad` imports.

### 3. Transpilation flow

The main runtime entry is `transpileFile(options)` in `transpile.ts`. It performs these steps:

1. Resolve the input file and watch/config context.
2. Collect the dependency graph and resolve imports.
3. Type-check the candidate files (unless `skipTypeCheck` is set).
4. Build IR for every file via `buildProgramIR()`.
5. Tree-shake and filter the program IR.
6. Register enum metadata with `registerAllEnumNames()`.
7. Emit C++/headers with `emitCpp()`.
8. Write generated files and source maps.

Output is a `GeneratedOutputs` object with generated paths and diagnostics.

### 4. Import resolution and source discovery

- `resolveImport()` decides whether an import is local or npm-based.
- `resolveLocalImport()` handles relative TypeScript imports and `.js` / `.mjs` rewrite patterns.
- `resolveNpmPackageImport()` locates packages in `node_modules` and monorepo layouts.
- `detectNativeCppModule()` identifies `.d.ts` + `.cpp` pairs used for native bindings.
- `getNpmPackageInfoForFile()` maps a file path back to its npm package metadata after resolution.

### 5. Type-checking and diagnostics

- `typeCheckFiles()` performs TS compilation and reports errors before emission.
- Diagnostics are surfaced via `GeneratedOutputs.diagnostics`.
- CLI output uses `printDiagnostics()` in `packages/transpiler/src/cli-utils.ts`.
- A build may still produce generated outputs alongside warnings and errors.

### 6. Emission and platform strategy

- `emitCpp()` in `packages/transpiler/src/emit/cpp-emitter.ts` is the emission engine.
- It consumes IR, platform strategy, board constants, and polyfills.
- `registerAllEnumNames()` is required before emission to keep enum access normalization correct.
- For Arduino, `flattenGeneratedModulesIntoSketch()` is used to create an `.ino` sketch.

### 7. Source maps and error mapping

- Generated output may include source maps via `emitMaps`.
- `packages/transpiler/src/mapping/source-map.ts` reads and maps C++ error locations back to TypeScript.
- `printMappedCompileErrors()` uses this mapping during Arduino compile failures.

### 8. Watch mode and incremental rebuilds

- `packages/transpiler/src/watch.ts` handles filesystem watch events and rebuild callbacks.
- `discoverWatchDirs()` finds relevant directories for the entry file and config file.
- Incremental rebuilds use `packages/transpiler/src/incremental-cache.ts` when enabled.

### 9. @typecad/expect support and preprocessing

- Code that imports `@typecad/expect` is transformed by the preprocessor.
- `loadExpectPreprocessor()` loads `@typecad/expect/preprocessor` lazily.
- `runExpectTests()` is the runtime test harness invoked after transpilation/upload.

## Common extension checklist for new transpiler features

1. Decide whether the feature belongs to CLI parsing, config behavior, transpile graph resolution, emit logic, or runtime support.
2. Add the new option/command to `packages/transpiler/src/types.ts`.
3. Parse CLI flags in `packages/transpiler/src/utils/cli.ts`.
4. Wire command behavior in `packages/transpiler/src/cli.ts`.
5. Implement transpilation behavior in `packages/transpiler/src/transpile.ts` or `packages/transpiler/src/emit/*`.
6. Preserve diagnostics, source maps, and default `watch` semantics.
7. Add tests under `tests/` for the new CLI behavior and transpilation path.

## Important design notes

- Keep the CLI surface separate from the transpiler runtime. CLI files should only handle parsing, config, and orchestration.
- Transpilation should be driven by a single `transpileFile()` entrypoint, with internal helpers for resolution and IR building.
- Avoid adding new global mutable state in the emitter; prefer explicit context objects.
- Maintain a clear distinction between TypeScript source imports, npm package source resolution, and native module declarations.
