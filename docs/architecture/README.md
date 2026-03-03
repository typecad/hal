# Architecture Package Documentation

Architecture packages (`@typecode/arch-*`) define how code is generated for a CPU family.

## Documents

- [Architecture Development Guide](./development-guide.md) - Creating architecture packages
- [Register Definitions](./registers.md) - CPU register mapping patterns

## Available Architecture Packages

| Package | Target | Description |
|---------|--------|-------------|
| `@typecode/arch-avr-native` | `avr` | Native AVR register access for ATmega328P |

## Purpose

Architecture packages handle:

1. **Code Generation Strategy** - Native registers vs. Arduino framework
2. **Register Definitions** - CPU memory-mapped registers
3. **Platform Polyfills** - Native implementations of runtime functions
4. **Header Management** - Required `#include` directives

## Relationship to Board Packages

```
@typecode/arch-avr-native (strategy + registers)
            │
            ▼
@typecode/board-arduino-uno (pins + constants)
            │
            ▼
        User Code
```

Board packages import and re-export architecture strategies. The architecture package provides the code generation logic, while the board package provides pin mappings.

## Strategy Interface

Architecture packages export a `PlatformStrategy` implementation:

```typescript
// src/strategy.ts
import { PlatformStrategy } from 'typecode/platform';

export class NativeAVRStrategy extends PlatformStrategy {
  readonly id = 'avr-native';
  
  forcedIncludes() { /* ... */ }
  shimLines() { /* ... */ }
  nativePolyfills() { /* ... */ }
  // ...
}
```

See the [Development Guide](./development-guide.md) for complete details.