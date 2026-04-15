# Transpiler Documentation

The TypeCode transpiler converts TypeScript to C++/Arduino code.

## Documents

- [Language Reference](./language-reference.md) - TypeScript to C++ mapping
- [IR Model](./ir-model.md) - Intermediate representation
- [Polyfills](./polyfills.md) - Runtime polyfill system
- [Multi-File Projects](#multi-file-projects) - Multi-file project support

## Overview

TypeCode transpiles a subset of TypeScript to efficient C++ code:

```typescript
// TypeScript
import { LED, delay } from '@typecode';

LED.output(LOW);

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

## Mixing TypeScript and C++

TypeCode allows you to mix TypeScript and native C++ code in the same project. This is useful for:

- Using existing C++ libraries
- Writing performance-critical code in C++
- Leveraging C++ features not supported in TypeScript

### Native C++ Modules

A native C++ module consists of two files:

1. **Declaration file (`.d.ts`)** - TypeScript type definitions
2. **Implementation file (`.cpp`)** - C++ implementation

```
src/
├── sketch.ts
└── lib/
    ├── sensor.d.ts    # TypeScript declarations
    └── sensor.cpp     # C++ implementation
```

### Auto-Generating Declarations

When you import a C++ module that doesn't have a `.d.ts` file, TypeCode automatically generates one for you:

1. Write your C++ implementation file (e.g., `lib/sensor.cpp`)
2. Import it in TypeScript: `import { Sensor } from './lib/sensor'`
3. Run transpilation - the CLI detects the missing declaration and auto-generates it

```
  Auto-generated: lib/sensor.d.ts
  from C++ source: lib/sensor.cpp
  Review the generated types and adjust if needed.

  Retrying type-checking after auto-generation...
  Type-checking passed after auto-generation.
```

**Manual Generation:**

You can also generate declarations explicitly:

```bash
# Generate for a single file
npx typecode gen-decls lib/sensor.cpp

# Scan a directory and generate for all C++ files missing declarations
npx typecode gen-decls --scan-dir src/lib
```

**VSCode Extension:**

The TypeCode VSCode extension automatically generates `.d.ts` files when you save a `.cpp` file that doesn't have one. It also provides the **"TypeCode: Generate Declaration"** command in the Command Palette for manual generation.

#### Example: Native C++ Class

**lib/sensor.d.ts** - Type declarations:
```typescript
// Declare the class interface for TypeScript
export declare class Sensor {
  constructor(address?: number);
  begin(): boolean;
  readTemperature(): number;
  readHumidity(): number;
}
```

**lib/sensor.cpp** - C++ implementation:
```cpp
#include <Arduino.h>
#include <Wire.h>

class Sensor {
public:
  Sensor(int address = 0x76) : _address(address) {}

  bool begin() {
    Wire.begin();
    // Initialize sensor...
    return true;
  }

  int readTemperature() {
    // Read from sensor registers...
    return 250; // 25.0°C as integer
  }

  int readHumidity() {
    // Read from sensor registers...
    return 450; // 45.0% as integer
  }

private:
  int _address;
};
```

**sketch.ts** - Use from TypeScript:
```typescript
import { LED, delay, Serial } from '@typecode';
import { Sensor } from './lib/sensor';

const sensor = new Sensor();

sensor.begin();

while (true) {
  const temp = sensor.readTemperature();
  Serial.print("Temperature: ");
  Serial.println(temp / 10.0);
  delay(1000);
}
```

### How It Works

1. The transpiler detects `.d.ts` + `.cpp` pairs as native modules
2. The `.cpp` file is copied to the output directory
3. The `.cpp` content is merged into the final sketch
4. TypeScript uses the `.d.ts` for type checking

### Generated Output

The C++ class is merged directly into the generated sketch:

```cpp
// ---- merged from sensor.cpp ----
class Sensor {
public:
  Sensor(int address = 0x76) : _address(address) {}
  bool begin() { /* ... */ }
  int readTemperature() { /* ... */ }
  int readHumidity() { /* ... */ }
private:
  int _address;
};

// ---- entry sketch ----
void setup() {
  const Sensor* sensor = new Sensor();
  sensor->begin();
  
  while (true) {
    int temp = sensor->readTemperature();
    Serial.print("Temperature: ");
    Serial.println(temp / 10.0);
    delay(1000);
  }
}

void loop() {}
```

### Best Practices

1. **Use integer return types** - Arduino has limited floating-point support
2. **Keep classes simple** - Avoid complex C++ features (templates, STL)
3. **Match declarations exactly** - The `.d.ts` must match the `.cpp` interface
4. **Include Arduino.h** - Your C++ code should include `<Arduino.h>` if needed

### Limitations

- Native modules must export classes or functions (no variables)
- C++ templates are not supported in declarations
- The transpiler does not parse C++ - ensure your C++ is valid
- Namespaces are not supported in native modules


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

## Multi-File Projects

TypeCode supports multi-file TypeScript projects with `import`/`export` statements. You can split your code across multiple `.ts` files and the transpiler will resolve dependencies, tree-shake across module boundaries, and generate proper C++ output with headers and forward declarations.

### Project Structure

```
project/
├── typecode.config.ts     # Config with entry point
├── src/
│   ├── main.ts            # Entry file
│   ├── sensors.ts         # Sensor module
│   ├── motors.ts          # Motor module
│   └── utils.ts           # Shared utilities
└── out/                   # Generated output
    ├── main.cpp
    ├── main.h
    ├── sensors.cpp
    ├── sensors.h
    ├── motors.cpp
    ├── motors.h
    ├── utils.cpp
    └── utils.h
```

### Configuration

Set the `entry` field in `typecode.config.ts` to specify the entry file:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  entry: './src/main.ts',   // Entry point for the build
  output: {
    framework: 'arduino',
    outDir: './out',
    emitMode: 'split',      // Generates separate .cpp/.h per module
  },
};

export default config;
```

Then build with:

```bash
npx typecode build
```

### Importing Local Modules

Use standard TypeScript `import`/`export` syntax to reference other files:

**sensors.ts** — library module:
```typescript
import { Serial } from '@typecode';

export function readTemperature(pin: number): number {
  const value = analogRead(pin);
  Serial.print("Temp: ");
  Serial.println(value);
  return value;
}

export function readHumidity(pin: number): number {
  return analogRead(pin);
}
```

**main.ts** — entry file:
```typescript
import { LED, delay } from '@typecode';
import { readTemperature } from './sensors';

while (true) {
  const temp = readTemperature(A0);
  LED.toggle();
  delay(1000);
}
```

Only `readTemperature` is included in the output — `readHumidity` is tree-shaken since it is never imported.

### Build Pipeline

Multi-file projects use a three-phase build pipeline:

```
Phase A: Build all IRs
    Parse and build IR for every file in the import graph
         │
         ▼
Phase B: Compute cross-module imports
    Detect which exported symbols are imported by other files
    and register them as entry points for tree-shaking
         │
         ▼
Phase C: Tree-shake with cross-module awareness
    Run dead-code elimination on each file, preserving
    symbols that are imported by other modules
```

Files are processed in **topological order** (dependencies first), ensuring that headers are available before they are included.

### Cross-Module Tree-Shaking

The transpiler automatically detects which exported symbols are actually used by other files in the project. Symbols that are exported but never imported are removed by tree-shaking, just like unused code within a single file.

```typescript
// utils.ts
export function used() { /* kept */ }     // imported by main.ts → kept
export function notUsed() { /* removed */ } // not imported → tree-shaken
export class Helper { /* kept */ }         // imported by main.ts → kept
export enum Mode { A, B, C }              // imported by main.ts → kept
```

```typescript
// main.ts
import { used, Helper, Mode } from './utils';
// Only used(), Helper, and Mode appear in generated C++
```

### Generated Output

In `split` mode (the default), each TypeScript file generates a pair of C++ files:

| TypeScript | C++ Header | C++ Source |
|------------|------------|------------|
| `main.ts` | `main.h` | `main.cpp` |
| `sensors.ts` | `sensors.h` | `sensors.cpp` |

- **Headers** contain class declarations, enum definitions, and function declarations
- **Sources** contain function implementations and `#include` directives for dependencies
- All headers include `#pragma once` guards to prevent multiple inclusion

### Forward Declarations

When a file uses a class defined in another module, the transpiler automatically generates forward declarations:

```cpp
// sensors.cpp
#include "motors.h"        // Full include for Motors class
class Helper;              // Forward declaration from utils module
```

This allows cross-module type references without creating circular include dependencies.

### Limitations

- Circular dependencies between TypeScript files are not supported (the build uses topological ordering)
- Re-exports (`export * from './other'`) are not supported
- Default exports are not supported — use named exports only
- Dynamic imports (`import()`) are not supported

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

### Pin Safety Warnings

TypeCode validates pin usage at compile time and generates warnings for potentially problematic configurations:

**Unsafe Pins:**

Some pins are marked as "unsafe" in board definitions. These pins can be used but may have special behaviors:

```typescript
import { D0, HIGH } from '@typecode/board-arduino-uno';

D0.asOutput();
D0.write(HIGH);  // Warning: Pin 'D0' is marked as unsafe
```

The transpiler generates warnings (not errors), allowing the code to compile while alerting you to potential issues:

```
warning [unsafe-pin-usage]: Pin 'D0' is marked as unsafe. Use with caution -
this pin may have special boot behavior or conflict with system functions.
```

**Common Unsafe Pins on Arduino Uno:**
- `D0` (RX) - UART receive pin; using interferes with serial upload/monitoring
- `D1` (TX) - UART transmit pin; using interferes with serial communication

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