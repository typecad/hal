# Polyfill System Refactor Plan

## Problem

The polyfill system was designed before the board package model existed. Now that board packages can provide actual implementations, the polyfill system conflicts with them.

### Current Issue

When using `@typecode/board-native-atmega328p`:
1. The console polyfill emits `inline void console_log(...)` functions that use `Serial.println()`
2. The native strategy's shimLines emits `_uart_*` functions and tries to redefine `console_log`
3. This causes C++ redefinition errors because both sets of functions are emitted

### Root Cause

The polyfill system is global and doesn't know about board package capabilities. It always emits its implementations regardless of whether a board package provides native alternatives.

## Proposed Solution

### Option 1: Board Package Polyfill Overrides (Recommended)

Allow board packages to declare which polyfills they handle and provide their own implementations.

#### 1.1 Add Polyfill Configuration to PlatformStrategy

```typescript
// packages/cli/src/platform/platform-strategy.ts
export interface PlatformStrategy {
  // ... existing methods ...
  
  /**
   * Returns a set of polyfill IDs that this strategy handles natively.
   * The emitter will skip emitting these polyfills from the global system.
   */
  nativePolyfills(): Set<string>;
  
  /**
   * Returns polyfill IR for polyfills that this strategy provides natively.
   * This allows board packages to provide their own console.log, etc.
   */
  generateNativePolyfills(polyfillNeeds: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR[];
}
```

#### 1.2 Update Native Strategy

```typescript
// packages/board-native-atmega328p/src/strategy.ts
class NativeATmega328PStrategy extends ArduinoStrategy {
  override nativePolyfills(): Set<string> {
    return new Set(['console']);  // We handle console.log natively
  }
  
  override generateNativePolyfills(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR {
    // Generate native UART-based console.log implementation
    return {
      id: 'console',
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `inline void console_log(const char* msg) { _uart_println(msg); }`,
        `inline void console_log(int val) { _uart_println_long(val); }`,
        // ... etc
      ],
      shimMacros: ['#define console_log(...) console_log(__VA_ARGS__)']
    };
  }
}
```

#### 1.3 Update Emitter Logic

```typescript
// packages/cli/src/emit/cpp-emitter.ts
function emitProgram(program: ProgramIR, options: EmitOptions): EmitResult {
  // ... existing code ...
  
  // Get polyfills that the strategy handles natively
  const nativePolyfillIds = strategy.nativePolyfills?.() ?? new Set();
  
  // Filter out polyfills that are handled natively
  const filteredPolyfills = (options.polyfills ?? []).filter(
    p => !nativePolyfillIds.has(p.id)
  );
  
  // Emit remaining polyfills
  const emittedPolyfills = emitPolyfillBoilerplate(filteredPolyfills);
  
  // Add native polyfills from strategy
  const nativePolyfills = strategy.generateNativePolyfills?.(
    detectPolyfillNeeds(program),
    context
  ) ?? [];
  
  // Merge native polyfills with shimLines
  // ...
}
```

### Option 2: Polyfill Exclusion List

Simpler approach - allow board packages to declare which polyfills to skip.

```typescript
// packages/cli/src/platform/platform-strategy.ts
export interface PlatformStrategy {
  /**
   * Returns a set of polyfill IDs to skip.
   * The emitter will not emit these polyfills.
   */
  skipPolyfills(): Set<string>;
}
```

The board package would then provide the implementation in shimLines.

### Option 3: Remove Polyfill System Entirely

Move all polyfill functionality into board packages:
- Each board package provides its own console.log implementation
- Array/string methods are provided by a core runtime package
- This is a larger refactor but cleaner long-term

## Recommended Approach

**Option 1** is recommended because:
1. It's backward compatible - existing board packages work without changes
2. It allows board packages to provide optimized implementations
3. It keeps the polyfill detection logic in one place
4. It's a minimal change to the existing architecture

## Implementation Steps

1. Add `nativePolyfills()` and `generateNativePolyfills()` to PlatformStrategy interface
2. Update GenericStrategy and ArduinoStrategy with default implementations
3. Update NativeATmega328PStrategy to override these methods
4. Update cpp-emitter.ts to check for native polyfills
5. Test with board-native-atmega328p package
6. Update documentation

## Files to Modify

- `packages/cli/src/platform/platform-strategy.ts` - Add interface methods
- `packages/cli/src/platform/generic-strategy.ts` - Add default implementations
- `packages/cli/src/platform/arduino-strategy.ts` - Add default implementations
- `packages/cli/src/emit/cpp-emitter.ts` - Filter polyfills based on strategy
- `packages/board-native-atmega328p/src/strategy.ts` - Implement native polyfills
