# LLM TRANSPILER GUIDE

This guide is for language models and future maintainers investigating or extending the TypeCAD transpiler.

## Key files

- `packages/cuttlefish/src/cli.ts` — main CLI entry, command dispatch, build/watch flows
- `packages/cuttlefish/src/utils/cli.ts` — CLI option parser, command validation, help text
- `packages/cuttlefish/src/transpile.ts` — transpilation pipeline, import resolution, emit orchestration
- `packages/cuttlefish/src/emit/cpp-emitter.ts` — C++ emission logic and platform-specific codegen
- `packages/cuttlefish/src/config-loader.ts` — cuttlefish.config.ts loading and board/package config
- `packages/cuttlefish/src/cli-utils.ts` — shared CLI helpers like expect test runner and error mapping
- `packages/cuttlefish/src/mapping/source-map.ts` — source map I/O and C++ → TypeScript error mapping
- `packages/cuttlefish/src/watch.ts` — watch mode, directory discovery, rebuild callbacks

## Main code paths for creating or evaluating transpilation

### 1. CLI command entry

- `packages/cuttlefish/src/cli.ts` is the application's entrypoint.
- `main()` calls `parseCommandLine(process.argv)` from `packages/cuttlefish/src/utils/cli.ts`.
- CLI parsing produces one of: `default`, `build`, `create`, `preview`, `doctor`, `licenses`, `board`, `library`, `gen-decls`.
- For `default` and `build`, CLI options are normalized and passed into the transpilation flow.

### 2. Config loading and effective option resolution

- `loadCuttlefishConfig()` from `packages/cuttlefish/src/config-loader.ts` reads `cuttlefish.config.ts`.
- Config values override CLI-supplied flags for board, buildTarget, target, outDir, framework, and console settings.
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
- CLI output uses `printDiagnostics()` in `packages/cuttlefish/src/cli-utils.ts`.
- A build may still produce generated outputs alongside warnings and errors.

### 6. Emission and platform strategy

- `emitCpp()` in `packages/cuttlefish/src/emit/cpp-emitter.ts` is the emission engine.
- It consumes IR, platform strategy, board constants, and polyfills.
- `registerAllEnumNames()` is required before emission to keep enum access normalization correct.

### 7. Source maps and error mapping

- Generated output may include source maps via `emitMaps`.
- `packages/cuttlefish/src/mapping/source-map.ts` reads and maps C++ error locations back to TypeScript.
- `printMappedCompileErrors()` uses this mapping during compile failures.

### 8. Watch mode and incremental rebuilds

- `packages/cuttlefish/src/watch.ts` handles filesystem watch events and rebuild callbacks.
- `discoverWatchDirs()` finds relevant directories for the entry file and config file.
- Incremental rebuilds use `packages/cuttlefish/src/incremental-cache.ts` when enabled.

### 9. Hardware-test DSL support and preprocessing

- Code that imports `@typecad/hal/testing` (the `describe`/`done` DSL) is
  transformed by the preprocessor (`src/test-runner/preprocessor.ts`,
  engine-internal since the expect package dissolved).
- `runTestRunner()` / `runExpectTests()` spawn the test-runner CLI
  (`cuttlefish test`, alias `cuttlefish-test`).

## Common extension checklist for new transpiler features

1. Decide whether the feature belongs to CLI parsing, config behavior, transpile graph resolution, emit logic, or runtime support.
2. Add the new option/command to `packages/cuttlefish/src/types.ts`.
3. Parse CLI flags in `packages/cuttlefish/src/utils/cli.ts`.
4. Wire command behavior in `packages/cuttlefish/src/cli.ts`.
5. Implement transpilation behavior in `packages/cuttlefish/src/transpile.ts` or `packages/cuttlefish/src/emit/*`.
6. Preserve diagnostics, source maps, and default `watch` semantics.
7. Add tests under `tests/` for the new CLI behavior and transpilation path.

## Important design notes

- Keep the CLI surface separate from the transpiler runtime. CLI files should only handle parsing, config, and orchestration.
- Transpilation should be driven by a single `transpileFile()` entrypoint, with internal helpers for resolution and IR building.
- Avoid adding new global mutable state in the emitter; prefer explicit context objects.
- Maintain a clear distinction between TypeScript source imports, npm package source resolution, and native module declarations.

## C++ type representation (`CppTypeIR`)

C++ types flow through the transpiler on every IR declaration field (`ParameterIR.cppType`, `VariableDeclarationIR.cppType`, `FunctionIR.returnType`, `ClassFieldIR.cppType`, etc.). These fields are typed `CppType = string` for readable construction at IR-build sites (`cppType: "int"` is clearer than a literal IR object), but **every consumer inspects types structurally** via the `CppTypeIR` module rather than re-parsing the string.

### The module: `packages/cuttlefish/src/api/shared/cpp-type-ir.ts`

- **`CppTypeIR`** — a discriminated union with 19 variants covering every C++ shape the transpiler emits: `primitive`, `auto`, `string`, `strPtr`, `named`, `pointer`, `reference`, `qualified`, `vector`, `set`, `map`, `tuple`, `variant`, `function`, `staticArray`, `cArray`, `generator`, `smartPointer`, `opaque`. Qualifiers (`const`, `&`, `*`) are orthogonal wrappers, matching how they compose in `const std::vector<T>&`.
- **`parseCppType(s): CppTypeIR`** — the single parser. Promotes the previously-private `splitTemplateArgs` as its core; correct for nested templates and multi-arg containers (`std::map<K,V>`, `std::tuple<...>`, `std::function<R(P...)>`).
- **`renderCppType(ir): string`** — the single renderer. Byte-identical round trip (`renderCppType(parseCppType(s)) === s`) for every type string in the test corpus.
- **Predicates** — `isPointer`, `isVector`, `isMap`, `isSet`, `isTuple`, `isContainer`, `isStringLike`, `isPrimitive`, `bareType`, `elementOf`, `formatKindOf`, plus string-in wrappers (`parsedIsPointer(s)`, `parsedElementString(s)`, `parsedBareString(s)`, `parsedIsPlainStructType(s)`, `needsCStrForStringLike(s)`, `collectNamedTypes(ir)`).
- **Builders** — `CppTypeIR.vector(t)`, `.pointer(t)`, `.map(k,v)`, `.reference(t, {isConst})`, etc., replace `` `std::vector<${x}>` `` string construction at producer sites.

### Conventions documented here for the first time

These were previously tribal knowledge enforced only in code:

- **Class types are always pointers.** A TypeScript class reference is emitted as `ClassName*` so `new X()` never assigns to a value-typed `X` (see `type-resolution.ts`, the `classTypeNames` branch). The parser preserves this — it does not unwrap pointers.
- **`__tc_StaticArray<T,N>`** is a compile-time fixed-size array (lowered from `new Array(N)` to avoid heap `std::vector`). First-class `staticArray` kind.
- **`__tc_str_ptr`** marks an expression that must be passed as `.c_str()`. First-class `strPtr` kind.
- **`__tc_Generator<T>`** is the coroutine generator pseudo-type. First-class `generator` kind.
- **`const` prefix vs suffix.** The producer emits `const T` (prefix). `T const` (suffix) is legal C++ but rare in this codebase; both parse to the same `qualified` variant.
- **`auto` promotion.** `normalizeTypeHintForUse` maps unresolved `auto` to `double` at use sites in `type-resolution.ts`.

### Where parsing happens (and where it doesn't)

- **Producer** (`ir/type-resolution.ts`): builds `CppTypeIR` internally via builders, flattens to string at the public boundary.
- **Consumers** (`ir/`, `emit/`): call `parseCppType` once, then inspect by `kind` or via predicates. The ~60+ historical ad-hoc `startsWith("std::vector<")` / `endsWith("*")` / `slice(len, -1)` / `/^std::vector<(.+)>$/` sites have been eliminated.
- **Out of scope**: `libdef/cpp-to-decl.ts` parses raw C++ *source text* (not IR `CppType`) along a separate pipeline; it does not consume this module.

