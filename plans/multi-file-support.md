# Plan: Multi-File Project Support

## Goal

Enable `typecode build` as a config-driven entry point so users don't need to specify a single `.ts` file on every invocation. Improve generated header quality for multi-module projects (generic target). Add cross-module tree-shaking so unused exports from imported modules are eliminated.

## Current State

The transpiler already supports multi-file projects via the import graph:

- `collectTranspileGraph()` in `packages/cli/src/transpile.ts:744` walks relative and npm imports
- Each file gets its own IR build + tree-shake pass
- Arduino target flattens all `.cpp`/`.h` into one `.ino`
- Generic target emits separate `.cpp`/`.h` per module

**Gaps:**

1. CLI requires `typecode <input.ts>` — no config-driven `build` command
2. Generated headers lack `#pragma once` guards
3. Include ordering is not topologically sorted (dependency order)
4. Tree-shaking is per-file, not cross-module
5. No forward declarations for cross-module type references

---

## Phase 1: `typecode build` Command

### 1.1 Add `entry` to config schema

**File:** `packages/cli/src/config-loader.ts`

Add `entry` field to `ResolvedTypecodeConfig` (line 22):

```typescript
export interface ResolvedTypecodeConfig {
  // ... existing fields ...
  /** Entry point TypeScript file (relative to config file). */
  entry?: string;
}
```

In the AST extraction logic, `entry` is a simple string property — it will be picked up automatically by the existing `collectScalarProperties()` walk. Just add it to the interface.

### 1.2 Add `build` subcommand to CLI parser

**File:** `packages/cli/src/utils/cli.ts`

In `parseCommandLine()` (line 187), add a `build` subcommand branch after the `init` handler (around line 258):

```typescript
// build subcommand
if (firstArg === "build") {
  return {
    command: "build",
    emitMode: "split" as EmitMode,
    target: "generic" as TargetProfile,
    outDir: undefined,
    emitMaps: true,
    noTranspile: false,
    compile: argv.includes("--compile"),
    upload: argv.includes("--upload"),
    monitor: argv.includes("--monitor"),
    port: readFlags(argv, ["--port"]),
    baud: 9600,
    platformContext: undefined,
    treeShaking: undefined,
    boardPackage: undefined,
    frameworkPackage: undefined,
    debug: argv.includes("--debug"),
    force: argv.includes("--force"),
    watch: argv.includes("--watch") || argv.includes("-w"),
  } as CommandLineOptions;
}
```

Update the `CommandLineOptions.command` union type in `types.ts` to include `"build"`.

### 1.3 Add `build` command handler

**File:** `packages/cli/src/cli.ts`

In `main()`, after the `map-error` handler (around line 313) and before the `!options.inputFile` check (line 315), add:

```typescript
// Handle build command — entry point comes from config
if (options.command === "build") {
  const config = loadTypecodeConfig(process.cwd());
  if (!config) {
    throw new Error("No typecode.config.ts found. Run 'typecode init' to create one.");
  }
  if (!config.entry) {
    throw new Error(
      "typecode.config.ts has no 'entry' field.\n" +
      "Add: entry: './src/sketch.ts'"
    );
  }

  const entryFile = path.resolve(path.dirname(config.configPath), config.entry);
  if (!fs.existsSync(entryFile)) {
    throw new Error(`Entry file not found: ${entryFile}`);
  }

  // Override options.inputFile with config entry, then fall through to normal pipeline
  options.inputFile = entryFile;
}
```

This reuses the entire existing transpile pipeline — the `build` command just resolves the entry point from config.

### 1.4 Update help text

**File:** `packages/cli/src/utils/cli.ts`

In `printHelp()`, add to the USAGE section (around line 16):

```
  typecode build [options]
```

And add a new section:

```
BUILD COMMAND
  build                    Build using entry point from typecode.config.ts
                           Requires 'entry' field in config file.
  --compile                Also compile with arduino-cli
  --upload                 Also upload to board
  --watch, -w              Watch for changes
```

### 1.5 Update types

**File:** `packages/cli/src/types.ts`

Update `CommandLineOptions.command` (line 134):

```typescript
command: "default" | "build" | "gen-libdefs" | "gen-decls" | "map-error" | "create-board" | "init";
```

---

## Phase 2: Header Quality for Generic Target

### 2.1 Add `#pragma once` to generated headers

**File:** `packages/cli/src/emit/cpp-emitter-refactored.ts`

In the header emission logic, prepend `#pragma once\n\n` to every generated `.h` file. Look for where the header content is assembled (the `headerLines` array or similar) and ensure `#pragma once` is the first line.

This is a one-line addition at the point where header file content is composed.

### 2.2 Topological include ordering

**File:** `packages/cli/src/transpile.ts`

The `collectTranspileGraph()` function (line 744) already returns files in BFS order (discovery order). This is close to but not exactly topological order. Modify it to emit in dependency order:

1. Build an adjacency list during graph collection
2. After collection, perform a topological sort (Kahn's algorithm)
3. Return files in reverse topological order (dependencies first)

```typescript
function topologicalSort(
  files: string[],
  edges: Map<string, Set<string>>
): string[] {
  const inDegree = new Map<string, number>();
  for (const f of files) inDegree.set(f, 0);
  for (const [from, deps] of edges) {
    for (const dep of deps) {
      if (inDegree.has(dep)) {
        // dep must come before from
        // We track this as: from depends on dep
      }
    }
  }
  // Kahn's algorithm: emit files with no unresolved deps first
  // ...
}
```

The `collectTranspileGraph` function already tracks which files import which — extend it to also return the dependency edges, then sort before returning.

---

## Phase 3: Cross-Module Tree-Shaking

### 3.1 Unified call graph across files

**File:** `packages/cli/src/transpile.ts`

Currently, tree-shaking runs per-file in the `buildIRForFile` async function (line 1074). The approach:

1. **Phase A (keep):** Build per-file IR as now
2. **Phase B (new):** Before tree-shaking, merge all per-file IRs into a unified view
3. **Phase C (modify):** Run tree-shaking on the unified IR, tracking which symbols are imported by which files
4. **Phase D (new):** Split the shaken results back into per-file IRs

Concrete changes in `transpileFile()`:

```typescript
// After all IRs are built (around line 1118), before tree-shaking:

// Build cross-module import map: for each file, which symbols does it import?
const crossModuleImports = new Map<string, Set<string>>();
for (const filePath of transpileFiles) {
  const ir = preBuiltFiles.find(f => f.filePath === filePath)?.programIR;
  if (!ir) continue;
  const imported = new Set<string>();
  for (const imp of ir.imports) {
    // Track which symbols are imported from other files in the graph
    for (const symbol of imp.namedImports) {
      imported.add(symbol);
    }
  }
  crossModuleImports.set(filePath, imported);
}
```

Then modify `applyTreeShaking` to accept the cross-module import map and treat symbols imported by other files as entry points.

### 3.2 Mark exported symbols as entry points

**File:** `packages/cli/src/ir/entry-points.ts`

Add a new function:

```typescript
export function detectExportedEntryPoints(
  program: ProgramIR,
  importedByOtherFiles: Set<string>
): Set<string> {
  const entryPoints = new Set<string>();
  
  // Any symbol imported by another file in the project is an entry point
  for (const symbol of importedByOtherFiles) {
    if (program.functions.some(f => f.originalName === symbol)) {
      entryPoints.add(symbol);
    }
    if (program.classes.some(c => c.name === symbol)) {
      entryPoints.add(symbol);
    }
    // enums and variables too
  }
  
  return entryPoints;
}
```

---

## Phase 4: Forward Declarations (Future)

This is lower priority and can be deferred. The approach would be:

1. During emission, collect all type names referenced but not defined in the current module
2. Generate forward declarations (`class Foo;`) for those types
3. Only needed for generic target where modules stay as separate compilation units

---

## Files to Modify

| File | Change | Phase |
|------|--------|-------|
| `packages/cli/src/config-loader.ts` | Add `entry` to `ResolvedTypecodeConfig` | 1 |
| `packages/cli/src/types.ts` | Add `"build"` to command union | 1 |
| `packages/cli/src/utils/cli.ts` | Add `build` subcommand parser + help text | 1 |
| `packages/cli/src/cli.ts` | Add `build` command handler | 1 |
| `packages/cli/src/emit/cpp-emitter-refactored.ts` | Add `#pragma once` to headers | 2 |
| `packages/cli/src/transpile.ts` | Topological sort in `collectTranspileGraph` | 2 |
| `packages/cli/src/transpile.ts` | Cross-module tree-shaking | 3 |
| `packages/cli/src/ir/entry-points.ts` | Exported symbol entry points | 3 |

## New Test Files

| File | Purpose |
|------|---------|
| `tests/build-command.test.ts` | Test `build` command reads config.entry |
| `tests/multi-file-tree-shaking.test.ts` | Test cross-module dead code elimination |
| `tests/header-guards.test.ts` | Test `#pragma once` in generated headers |
| `tests/topological-order.test.ts` | Test include ordering |

## Example Multi-File Project Structure

After implementation, a user can create:

```
my-project/
├── typecode.config.ts
├── tsconfig.json
├── package.json
├── typecode-env.d.ts
└── src/
    ├── sketch.ts          ← entry point
    ├── motor.ts           ← import { MotorController } from './motor'
    ├── sensors.ts         ← import { SensorArray } from './sensors'
    └── utils/
        └── math.ts        ← import { clamp } from './utils/math'
```

```typescript
// typecode.config.ts
import type { TypecodeConfig } from '@typecode/core';
const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  entry: './src/sketch.ts',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};
export default config;
```

```bash
# Build from project root — no file argument needed
npx typecode build --compile --upload --port COM4

# Watch mode
npx typecode build --watch
```

## Implementation Order

Phase 1 is the highest priority and smallest scope. Phase 2 is straightforward. Phase 3 is the most complex. Phase 4 can be deferred.

```
Phase 1 (build command) → Phase 2 (header quality) → Phase 3 (cross-module shaking) → Phase 4 (forward decls)
```
