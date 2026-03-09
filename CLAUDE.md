# TypeCode Project Context for AI Assistants

This file provides essential context for AI assistants (Claude, Cline, etc.) working on the TypeCode codebase.

## Quick Start - Read These First

When working on this codebase, read these files first to understand the architecture:

1. **`ARCHITECTURE.md`** - Overall architecture, package structure, data flow
2. **`packages/core/src/shared/ir.ts`** - IR type definitions (the core data structure)
3. **`packages/core/src/shared/platform-strategy.ts`** - Strategy interface (extension point)
4. **`packages/cli/src/transpile.ts`** - Main transpilation pipeline

## Project Summary

TypeCode transpiles TypeScript to C++ for embedded platforms (Arduino/AVR). The key insight is:
- TypeScript provides type safety and developer experience
- IR (Intermediate Representation) bridges TypeScript AST to C++ output
- PlatformStrategy encapsulates target-specific code generation

## Key Patterns

### IR-First Thinking
All transformations go through IR. If you're adding a feature:
1. Does it need a new IR type? → Add to `ir.ts`
2. Does it affect code generation? → Update `cpp-emitter.ts` and strategy
3. Does it affect analysis? → Update `ir/program-analysis.ts`

### Strategy Pattern
Target-specific behavior goes into `PlatformStrategy`, not conditionals:
```typescript
// ❌ Don't do this
if (target === 'arduino') { ... }

// ✅ Do this
strategy.tryRenderTypecodeCall(receiver, method, args, renderArg);
```

### Type Location Convention
- Shared types → `@typecode/core/src/shared/`
- CLI-only types → `packages/cli/src/types.ts`
- Re-export shared types from package `index.ts`

## Common Tasks

### Adding a New Statement Type
1. Add type to `StatementIR` union in `ir.ts`
2. Add building logic in `ir/build-ir.ts`
3. Add rendering in `emit/statement-renderer.ts`
4. Add fallback in `emit/cpp-emitter.ts` (legacy compatibility)
5. Add tests in `tests/statements.test.ts`

### Adding a New Platform Target
1. Create `packages/framework-<name>/`
2. Implement `PlatformStrategy` interface
3. Override methods for target-specific behavior
4. Register in `packages/cli/src/platform/registry.ts`
5. Add board package if needed

### Fixing a Code Generation Bug
1. Write a test case in `tests/` that reproduces the issue
2. Trace the data flow: TypeScript → IR → Emitter → C++
3. Fix at the appropriate level (usually strategy or emitter)
4. Verify test passes

## Module-Level State (Be Careful!)

Some files use module-level mutable state (historical reasons). These are being refactored:

```typescript
// In cpp-emitter.ts - module-level state (avoid adding more)
let _emitBoardConstants: BoardConstants | undefined;
const _emitEnumNames: Set<string> = new Set();
```

When adding new code, prefer passing context through function parameters or using context objects.

## Testing

```bash
npm test                      # Run all tests
npm test -- tests/ir-*.test.ts  # Run IR tests
```

Tests use Vitest. Each test file typically tests one IR node type or one subsystem.

## File Size Guidelines

To maintain LLM comprehension:
- Keep files under 500 lines where possible
- Split large functions into smaller helpers
- Use clear section comments (e.g., `// --- Statement Rendering ---`)

## Current Refactoring Efforts

The codebase is undergoing refactoring:
- `cpp-emitter.ts` is being split into `statement-renderer.ts` + `expression-renderer.ts`
- Module-level state is being encapsulated into context objects
- If you see duplicate code, the newer file (e.g., `statement-renderer.ts`) is preferred

## When In Doubt

1. Check existing patterns in similar files
2. Read `ARCHITECTURE.md` for high-level context
3. Look at test files for usage examples
4. Prefer the strategy pattern over conditionals