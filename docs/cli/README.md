# CLI Documentation

The TypeHAL CLI (`@typehal/cli`) is the command-line interface for transpiling TypeScript to C++/Arduino code.

## Documents

- [CLI Reference](./reference.md) - Complete command reference
- [Configuration](./configuration.md) - Configuration file options

## Installation

```bash
npm install typehal
```

## Quick Start

```bash
# Transpile only
npx typehal sketch.ts

# Transpile + compile
npx typehal sketch.ts --compile

# Transpile + compile + upload
npx typehal sketch.ts --compile --upload --port COM4

# Full chain with serial monitor
npx typehal sketch.ts --compile --upload --monitor --port COM4 --baud 115200
```

## Architecture

The CLI package contains:

```
packages/cli/
├── src/
│   ├── cli.ts           # Entry point, command parsing
│   ├── config-loader.ts # typehal.config.ts loading
│   ├── transpile.ts     # Main transpilation orchestration
│   ├── types.ts         # Shared type definitions
│   ├── ast/
│   │   └── parse.ts     # TypeScript AST parsing
│   ├── ir/
│   │   ├── build-ir.ts  # IR construction
│   │   ├── model.ts     # IR type definitions
│   │   ├── reachability.ts # Tree-shaking
│   │   └── ...
│   ├── emit/
│   │   ├── cpp-emitter.ts        # Main emitter orchestrator
│   │   ├── expression-renderer.ts # Expression rendering
│   │   ├── statement-renderer.ts  # Statement rendering
│   │   ├── class-emitter.ts       # Class/namespace rendering
│   │   ├── enum-emitter.ts        # Enum/type alias rendering
│   │   ├── function-emitter.ts    # Function/callback rendering
│   │   ├── setup-emitter.ts       # setup()/loop() generation
│   │   ├── emitter-context.ts     # Emitter state management
│   │   ├── base-emitter.ts        # Base emitter class
│   │   └── utils/                 # Utility functions
│   │       ├── type-inference.ts  # Type inference helpers
│   │       ├── include-resolver.ts # Include handling
│   │       └── comment-helpers.ts  # Comment handling
│   ├── platform/
│   │   ├── platform-strategy.ts # Strategy interface
│   │   ├── arduino-strategy.ts  # Arduino implementation
│   │   └── registry.ts          # Strategy registry
│   ├── polyfill/
│   │   ├── registry.ts  # Polyfill registry
│   │   └── polyfills/   # Built-in polyfills
│   └── mapping/
│       └── source-map.ts # Source map generation
```

## Transpilation Pipeline

```
TypeScript Source (sketch.ts)
         │
         ▼
┌─────────────────────┐
│   Config Loading    │  typehal.config.ts
│   (config-loader)   │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│    AST Parsing      │  TypeScript Compiler API
│   (ast/parse.ts)    │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│    IR Building      │  TypeHAL Intermediate Representation
│   (ir/build-ir.ts)  │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   Tree Shaking      │  Dead code elimination
│ (ir/reachability)   │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   C++ Emission      │  Code generation
│ (emit/cpp-emitter)  │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│  Platform Strategy  │  Arduino/Generic
│ (platform/strategy) │
└─────────────────────┘
         │
         ▼
Generated C++/Arduino (.ino/.cpp)
```

## Key Modules

### config-loader.ts

Loads `typehal.config.ts` and resolves board packages:

```typescript
export function loadConfig(configPath: string): TypehalConfig;
export function resolveBoardPackage(boardName: string): BoardPackage;
```

### transpile.ts

Main orchestration:

```typescript
export async function transpile(
  inputPath: string,
  options: TranspileOptions
): Promise<TranspileResult>;
```

### ast/parse.ts

TypeScript parsing:

```typescript
export function parseTypeScript(source: string): ts.SourceFile;
export function extractExports(sourceFile: ts.SourceFile): ExportInfo[];
```

### ir/build-ir.ts

Intermediate representation:

```typescript
export function buildIR(
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker
): ProgramIR;
```

### emit/cpp-emitter.ts

Code generation:

```typescript
export function emitCPP(
  ir: ProgramIR,
  strategy: PlatformStrategy
): EmittedCode;
```

## Error Handling

The CLI provides source-mapped error messages:

```bash
# Map C++ error back to TypeScript
npx typehal map-error out/sketch/sketch.ino.thcppmap.json --line 42 --column 5
```

## Library Definitions

Generate library definition stubs for third-party imports:

```bash
npx typehal gen-libdefs src/sensor.ts
```

This creates `<module>.libdef.json` files that map TypeScript imports to C++ includes.