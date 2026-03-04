# Architecture Package Documentation

Architecture packages (`@typecode/arch-<cpu>-<hal>`) define how code is generated for a CPU family with a specific HAL/framework.

## Documents

- [Architecture Development Guide](./development-guide.md) - Creating architecture packages
- [Register Definitions](./registers.md) - CPU register mapping patterns

## Naming Convention

Architecture packages follow the pattern: `@typecode/arch-<cpu>-<hal>`

| Component | Description | Examples |
|-----------|-------------|----------|
| `<cpu>` | CPU architecture | `avr`, `esp32`, `arm`, `riscv` |
| `<hal>` | HAL/framework variant | `native`, `arduino`, `espidf`, `freertos`, `zephyr` |

### Examples

| Package | CPU | HAL | Description |
|---------|-----|-----|-------------|
| `@typecode/arch-avr-native` | AVR | Native | Direct register access, no framework |
| `@typecode/arch-avr-arduino` | AVR | Arduino | Arduino framework API calls |
| `@typecode/arch-esp32-arduino` | ESP32 | Arduino | Arduino ESP32 core |
| `@typecode/arch-esp32-espidf` | ESP32 | ESP-IDF | ESP-IDF FreeRTOS |
| `@typecode/arch-arm-zephyr` | ARM | Zephyr | Zephyr RTOS |

## Purpose

Architecture packages handle:

1. **Code Generation Strategy** - Native registers vs. framework APIs
2. **Register Definitions** - CPU memory-mapped registers (for native HALs)
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

## HAL/Framework Variants

Different HALs provide different runtime services:

| HAL | Threading | Timing | Notes |
|-----|-----------|--------|-------|
| `native` | None (bare metal) | `_delay_ms()` | Direct register access |
| `arduino` | `loop()` cooperative | `delay()`, `millis()` | Arduino framework |
| `espidf` | FreeRTOS tasks | `vTaskDelay()` | ESP-IDF with FreeRTOS |
| `freertos` | FreeRTOS tasks | `vTaskDelay()` | Generic FreeRTOS |
| `zephyr` | Zephyr threads | `k_sleep()` | Zephyr RTOS |

### Why No Separate HAL Package Type?

We considered a 3-package architecture (Board → HAL → Architecture) but decided against it because:

1. **HAL-architecture coupling** - Most HALs are architecture-specific (ESP-IDF only works on ESP32)
2. **Simpler mental model** - 2 package types vs 3
3. **Less versioning complexity** - No need for compatibility matrices
4. **Current design supports flexibility** - The `PlatformStrategy` pattern already allows HAL variations

This may be reconsidered if the same HAL needs to support multiple architectures with substantial code reuse.

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