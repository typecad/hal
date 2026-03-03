# Transpiler Documentation

The TypeCode transpiler converts TypeScript to C++/Arduino code.

## Documents

- [Language Reference](./language-reference.md) - TypeScript to C++ mapping
- [IR Model](./ir-model.md) - Intermediate representation
- [Polyfills](./polyfills.md) - Runtime polyfill system

## Overview

TypeCode transpiles a subset of TypeScript to efficient C++ code:

```typescript
// TypeScript
import { LED, delay } from '@typecode';

LED.asOutput();

while (true) {
  LED.toggle();
  delay(1000);
}
```

```cpp
// Generated C++
#include <Arduino.h>

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, !digitalRead(13));
  delay(1000);
}
```

## Supported TypeScript Features

| Feature | Support |
|---------|---------|
| Variables (`let`, `const`) | ✅ Full |
| Functions | ✅ Full |
| Classes | ✅ Full |
| Interfaces | ✅ Compile-time only |
| Enums | ✅ Full |
| Generics | ⚠️ Limited |
| Async/Await | ❌ Not supported |
| Try/Catch | ❌ Not supported |
| Dynamic allocation | ⚠️ Limited |

## Transpilation Pipeline

```
┌─────────────────┐
│ TypeScript Code │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   AST Parsing   │ ← TypeScript Compiler API
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Type Checking │ ← Full TypeScript type info
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   IR Building   │ ← TypeCode IR
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Tree Shaking   │ ← Dead code elimination
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   C++ Emission  │ ← Platform strategy
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generated C++  │
└─────────────────┘
```

## Key Concepts

### Compile-Time vs Runtime

TypeCode distinguishes between compile-time and runtime constructs:

- **Compile-time**: Interfaces, type aliases, generics → Erased during transpilation
- **Runtime**: Functions, classes, variables → Emitted as C++ code

### Type Mapping

| TypeScript | C++ |
|------------|-----|
| `number` | `int` / `float` / `double` |
| `boolean` | `bool` |
| `string` | `const char*` / `String` |
| `void` | `void` |
| `Uint8Array` | `uint8_t[]` |
| `Array<T>` | `std::vector<T>` (limited) |

### Pin Constant Folding

Pin factory functions are folded at compile time:

```typescript
// TypeScript
const LED = createDigitalPin(13, 5);

// Transpiles to direct pin number usage
digitalWrite(13, HIGH);
```

## Platform Strategy

The transpiler uses platform strategies to customize code generation:

- **ArduinoStrategy**: Standard Arduino framework
- **NativeStrategy**: Direct register access (smaller, faster)
- **GenericStrategy**: Platform-independent C++

See [Architecture Development Guide](../architecture/development-guide.md) for details.

## Source Maps

TypeCode generates source maps linking C++ back to TypeScript:

```
sketch.ino.tscppmap.json
```

Use for:
- Error message mapping
- Debugging support
- Stack trace translation