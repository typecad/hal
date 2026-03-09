# TypeCode Architecture

This document provides a high-level overview of the TypeCode architecture for contributors and AI assistants.

## Project Overview

TypeCode is a TypeScript-to-C++ transpiler targeting embedded platforms (primarily Arduino/AVR). It allows writing embedded code in TypeScript with type safety, then transpiles to efficient C++ for compilation.

## Package Structure

```
packages/
├── core/                    # @typecode/core - Shared types and interfaces
│   └── src/
│       ├── shared/          # IR types, platform strategy interface, utilities
│       ├── types/           # Pin, GPIO, capability types
│       ├── bus/             # I2C, SPI, UART interface definitions
│       ├── board/           # Board definition builder
│       └── memory/          # Memory decorators and buffer types
│
├── cli/                     # @typecode/cli - Transpilation pipeline
│   └── src/
│       ├── transpile.ts     # Main entry point for transpilation
│       ├── ir/              # IR building and analysis
│       ├── emit/            # C++ code emission
│       ├── platform/        # Platform strategy implementations
│       ├── polyfill/        # Runtime polyfill generation
│       └── libdef/          # Library definition management
│
├── framework-arduino/       # @typecode/framework-arduino - Arduino strategy
│   └── src/
│       ├── strategy.ts      # ArduinoStrategy implementation
│       └── typecode-map.ts  # TypeCode SDK to Arduino mapping
│
├── framework-avr/           # @typecode/framework-avr - AVR-native strategy
│
├── board-arduino-uno/       # @typecode/board-arduino-uno - Uno pin definitions
├── board-arduino-nano/      # @typecode/board-arduino-nano - Nano pin definitions
│
└── expect/                  # @typecode/expect - Testing framework
    └── src/
        └── host/            # Host-side test execution
```

## Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  TypeScript │ ──▶ │     AST     │ ──▶ │     IR      │ ──▶ │    C++      │
│   Source    │     │ (TypeScript)│     │ (ProgramIR) │     │   Output    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │                   │
      │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼
  .ts files      ts.createSourceFile    buildProgramIR()    emitCpp()
```

### Pipeline Stages

1. **Parse** - TypeScript source files are parsed using `ts.createSourceFile()`
2. **Build IR** - AST is transformed to Intermediate Representation (`ProgramIR`)
3. **Tree Shake** - Dead code elimination via reachability analysis
4. **Emit** - IR is rendered to C++ code via `PlatformStrategy`

## Key Concepts

### Intermediate Representation (IR)

The IR is defined in `packages/core/src/shared/ir.ts` and represents the transpiled code in a form that can be emitted as C++.

Key types:
- `ProgramIR` - Top-level container for a transpiled file
- `StatementIR` - Union type for all statement kinds (if, while, for, etc.)
- `ExpressionIR` - Union type for all expression kinds (number, string, call, etc.)
- `FunctionIR`, `ClassIR`, `EnumIR` - Structural declarations

### Platform Strategy

The `PlatformStrategy` interface (`packages/core/src/shared/platform-strategy.ts`) defines how code is generated for a specific target. This is the primary extension point for supporting new platforms.

Key responsibilities:
- Include header management
- Type normalization (e.g., `std::string` → `String` on Arduino)
- SDK call translation (e.g., `DigitalPin.read()` → `digitalRead()`)
- Console output (e.g., `console.log` → `Serial.println`)

### Tree Shaking

Dead code elimination is performed via:
1. `buildCallGraph()` - Builds caller→callee relationships
2. `detectEntryPoints()` - Finds `setup()`, `loop()`, exported functions
3. `analyzeReachability()` - Marks reachable code
4. `filterProgramIR()` - Removes unreachable code

## Extension Points

### Adding a New Board Package

1. Create `packages/board-<name>/`
2. Define pin mappings in `src/pins.ts`
3. Define peripherals in `src/peripherals.ts`
4. Export board definition from `src/index.ts`
5. Add `BoardStrategy` export if custom behavior needed

### Adding a New Framework/Platform

1. Create `packages/framework-<name>/`
2. Implement `PlatformStrategy` interface
3. Handle SDK call translation in `tryRenderTypecodeCall()`
4. Register in `packages/cli/src/platform/registry.ts`

### Adding a New IR Node Type

1. Add type definition to `packages/core/src/shared/ir.ts`
2. Update `buildProgramIR()` in `packages/cli/src/ir/build-ir.ts`
3. Update `emitCpp()` and appropriate renderer in `packages/cli/src/emit/`
4. Add tests in `tests/` directory

## Important Files to Read

| File | Purpose |
|------|---------|
| `packages/core/src/shared/ir.ts` | IR type definitions |
| `packages/core/src/shared/platform-strategy.ts` | Strategy interface |
| `packages/cli/src/transpile.ts` | Main transpilation pipeline |
| `packages/cli/src/emit/cpp-emitter.ts` | Main C++ emitter orchestrator |
| `packages/cli/src/emit/expression-renderer.ts` | Expression rendering |
| `packages/cli/src/emit/statement-renderer.ts` | Statement rendering |
| `packages/cli/src/emit/class-emitter.ts` | Class/namespace rendering |
| `packages/cli/src/emit/enum-emitter.ts` | Enum/type alias rendering |
| `packages/cli/src/emit/function-emitter.ts` | Function/callback rendering |
| `packages/cli/src/emit/setup-emitter.ts` | setup()/loop() generation |
| `packages/framework-arduino/src/strategy.ts` | Example strategy implementation |

## Coding Conventions

### Type Exports
- Shared types go in `@typecode/core/src/shared/`
- Re-export from `@typecode/core` via `index.ts`
- Package-specific types stay in their package

### State Management
- Avoid module-level mutable state
- Use context objects passed through function calls
- State should be instantiated per-transpilation

### Error Handling
- Use `Diagnostic` objects for transpilation messages
- Throw errors for unrecoverable failures
- Warnings go to diagnostics, not console

## Testing

Tests are located in the `tests/` directory using Vitest:

```bash
npm test                    # Run all tests
npm test -- --grep "ir"     # Run tests matching pattern
```

Key test files:
- `tests/expressions.test.ts` - Expression IR tests
- `tests/statements.test.ts` - Statement IR tests
- `tests/hal-*.test.ts` - HAL interface tests