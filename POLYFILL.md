# Polyfill System

This document describes the polyfill system for the ts2cpp transpiler, which provides runtime support for TypeScript features in generated C++ code.

## Overview

The polyfill system automatically detects TypeScript/JavaScript patterns that don't have direct C++ equivalents and generates appropriate runtime code. This includes:

- Console output (`console.log`, `console.error`, etc.)
- Array methods (`push`, `pop`, `map`, `filter`, etc.)
- String methods (`toUpperCase`, `toLowerCase`, `trim`, etc.)
- Async/await patterns (Arduino-specific state machines)

## Architecture

```
src/polyfill/
├── index.ts          # Main entry point, exports
├── types.ts          # Type definitions and configurations
├── registry.ts       # PolyfillRegistry class for detection/generation
├── emitter.ts        # Emits C++ code from polyfill IR
└── polyfills/
    ├── console.ts         # Console output polyfill
    ├── async-arduino.ts   # Async/await state machine
    ├── array-methods.ts   # Array method implementations
    └── string-methods.ts  # String method implementations
```

## How It Works

### 1. Detection Phase

Each polyfill defines a `detect()` function that scans the Program IR for patterns it can handle:

```typescript
detect(program: ProgramIR, context: PolyfillContext): PolyfillNeed[]
```

The detector walks through:
- Function statements
- Top-level statements
- Class methods
- Nested control flow (if, while, for, switch, try/catch)

### 2. Generation Phase

When needs are detected, the `generate()` function produces `RuntimePolyfillIR`:

```typescript
generate(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR
```

The IR contains:
- `requiredIncludes` - Headers to include (e.g., `<vector>`, `<iostream>`)
- `forwardDeclarations` - Forward declarations needed
- `helperStructs` - Struct/class definitions (e.g., `StaticArray`, `StaticString`)
- `helperFunctions` - Helper function implementations
- `shimMacros` - Macros or comments for mapping

### 3. Emission Phase

The `emitPolyfillBoilerplate()` function converts IR to C++ code that gets inserted into the generated output.

## Implemented Polyfills

### Console (`console.ts`)

**Status: ✅ Implemented (Inline Transformation)**

Maps `console.*` calls to platform-appropriate output:

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `console.log()` | `std::cout << ... << std::endl` | `Serial.println(...)` |
| `console.error()` | `std::cerr << "[ERROR] " << ...` | `Serial.print("[ERROR]"); Serial.println(...)` |
| `console.warn()` | `std::cerr << "[WARN] " << ...` | `Serial.print("[WARN]"); Serial.println(...)` |

**Note:** Console polyfill is currently handled inline in `cpp-emitter.ts` via `transformConsoleCall()`, not through the polyfill registry.

### Array Methods (`array-methods.ts`)

**Status: ⚠️ Partially Implemented**

Provides alternatives for JavaScript array methods:

#### std::vector Mode (ESP32, RP2040, etc.)
Maps to standard C++ vector methods:

| TypeScript | C++ |
|------------|-----|
| `arr.push(x)` | `arr.push_back(x)` |
| `arr.pop()` | `arr.pop_back()` |
| `arr.length` | `arr.size()` |

#### StaticArray Mode (AVR, embedded)
Provides a fixed-size array template:

```cpp
template<typename T, size_t MaxSize = 32>
struct StaticArray {
    T data[MaxSize];
    size_t length = 0;
    
    void push_back(const T& value);
    T pop_back();
    T& operator[](size_t index);
    size_t size() const;
    // ... iterator support
};
```

**TODO:**
- [ ] `map()` callback support
- [ ] `filter()` callback support
- [ ] `forEach()` callback support
- [ ] `shift()` / `unshift()`
- [ ] `splice()` / `slice()`

### String Methods (`string-methods.ts`)

**Status: ⚠️ Partially Implemented**

Provides alternatives for JavaScript string methods:

#### std::string Mode
```cpp
inline std::string string_toUpperCase(const std::string& s);
inline std::string string_toLowerCase(const std::string& s);
inline bool string_includes(const std::string& s, const std::string& substr);
inline bool string_startsWith(const std::string& s, const std::string& prefix);
inline bool string_endsWith(const std::string& s, const std::string& suffix);
inline std::string string_trim(const std::string& s);
```

#### StaticString Mode (AVR, embedded)
```cpp
template<size_t MaxLen = 64>
struct StaticString {
    char data[MaxLen + 1];
    size_t length = 0;
    
    void toUpperCase();
    void toLowerCase();
    bool includes(const char* substr) const;
    bool startsWith(const char* prefix) const;
    bool endsWith(const char* suffix) const;
    void trim();
};
```

**TODO:**
- [ ] `split()` - returns array of strings
- [ ] `replace()` - pattern replacement
- [ ] `substring()` / `slice()` - proper bounds handling
- [ ] `charAt()` / `charCodeAt()`

### Async/Await (`async-arduino.ts`)

**Status: 🔧 Experimental / In Progress**

Transforms async functions into cooperative state machines for Arduino:

```cpp
class MyAsyncTask {
public:
  enum State { STATE_0, STATE_1, STATE_COMPLETE };
  
  void run() {
    switch (_state) {
      case STATE_0:
        // First synchronous portion
        _state = STATE_1;
        break;
      case STATE_1:
        // After first await
        if (millis() >= _waitUntil) {
          _state = STATE_COMPLETE;
        }
        break;
      case STATE_COMPLETE:
        break;
    }
  }
  
  bool isComplete() const;
  void reset();
  
private:
  State _state;
  unsigned long _waitUntil;
};
```

**Limitations:**
- Only basic patterns supported
- No return value propagation
- Manual polling required (call `run()` in `loop()`)
- State splitting at await points not fully implemented

**TODO:**
- [ ] Automatic state splitting at await points
- [ ] Return value support
- [ ] Exception handling in state machines
- [ ] Promise-like chaining

## Configuration

Polyfills can be configured via `PolyfillConfig`:

```typescript
interface PolyfillConfig {
  console?: {
    enabled: boolean;
    target: "auto" | "serial" | "cout" | "none";
    useFlashStrings?: boolean;  // AVR: Use F() macro for strings
  };
  async?: {
    enabled: boolean;
    mode: "state-machine" | "stub" | "none";
    scheduler?: boolean;
  };
  arrays?: {
    enabled: boolean;
    prefer: "auto" | "std_vector" | "static_array" | "micro_vector";
    staticMaxSize?: number;     // Default: 32
    microMaxSize?: number;      // Default: 16
  };
  strings?: {
    enabled: boolean;
    prefer: "auto" | "std_string" | "static_string";
    staticMaxLen?: number;      // Default: 64
  };
  exceptions?: {
    enabled: boolean | "auto";
    fallback: "error_code" | "noop";
  };
}
```

## Platform Support

Standard library support varies by architecture:

| Architecture | std::vector | std::string | iostream | Exceptions | RTTI |
|--------------|-------------|-------------|----------|------------|------|
| avr | ❌ | ❌ | ❌ | ❌ | ❌ |
| megaavr | ❌ | ❌ | ❌ | ❌ | ❌ |
| esp32 | ✅ | ✅ | ✅ | ✅ | ✅ |
| esp8266 | ✅ | ✅ | ✅ | ✅ | ✅ |
| rp2040 | ✅ | ✅ | ✅ | ✅ | ✅ |
| samd | ✅ | ✅ | ✅ | ✅ | ✅ |
| generic | ✅ | ✅ | ✅ | ✅ | ✅ |

The `getStdLibSupport()` function provides runtime detection of platform capabilities.

## Integration Points

### With cpp-emitter.ts

Currently, console transformation is handled inline in `cpp-emitter.ts`:

```typescript
// In renderStatement() and transformConsoleCall()
if (isConsoleCall(statement.callee)) {
  return transformConsoleCall(statement.callee, statement.args, target, forHeader);
}
```

### Future Integration

The polyfill registry should be integrated into the main emission pipeline:

```typescript
// Proposed integration in emitCpp()
const registry = createPolyfillRegistry(options.polyfillConfig);
const polyfills = registry.detectAndGenerate(program, {
  target: options.target,
  architecture: platformContext?.architecture,
  usedIdentifiers: new Set(),
});

const polyfillCode = renderPolyfillBlock(polyfills);
// Insert polyfillCode into output
```

## Adding New Polyfills

1. Create a new file in `src/polyfill/polyfills/`
2. Define a `PolyfillDefinition` with:
   - `id` - Unique identifier
   - `name` - Human-readable name
   - `description` - What it does
   - `domains` - Where it applies ("standard", "arduino", "embedded")
   - `detect()` - Find patterns needing polyfill
   - `generate()` - Create runtime code

3. Register in `src/polyfill/registry.ts`:
```typescript
import { myNewPolyfill } from "./polyfills/my-new-polyfill";

const POLYFILLS: PolyfillDefinition[] = [
  consolePolyfill,
  arduinoAsyncPolyfill,
  arrayMethodsPolyfill,
  stringMethodsPolyfill,
  myNewPolyfill,  // Add here
];
```

## Status Summary

| Polyfill | Detection | Generation | Integration | Notes |
|----------|-----------|------------|-------------|-------|
| Console | ✅ | ✅ | ⚠️ Inline | Handled in emitter, not registry |
| Array Methods | ✅ | ✅ | ❌ | Needs IR integration |
| String Methods | ✅ | ✅ | ❌ | Needs IR integration |
| Async/Await | ✅ | ⚠️ | ❌ | Experimental, needs work |

## Next Steps

1. **Integrate polyfill registry into emission pipeline**
   - Call `detectAndGenerate()` in `emitCpp()`
   - Insert generated code at appropriate location

2. **Improve async/await state machine**
   - Automatic state splitting
   - Better control flow handling

3. **Complete array method support**
   - Callback-based methods (`map`, `filter`, `forEach`)
   - Lambda generation for callbacks

4. **Add more polyfills**
   - `Object.keys()` / `Object.values()`
   - `JSON.stringify()` / `JSON.parse()`
   - `Math.*` functions
   - `Date` operations