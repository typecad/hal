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