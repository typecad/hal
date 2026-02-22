# TypeScript → C++ AST Transpiler Design

## Goal

Build a Node/npm transpiler that converts a `.ts` input file into C++ output (`.cpp` and optional `.h`).

- Primary use case: Arduino-oriented C++ generation.
- Core requirement: maintain a general transpiler architecture (generic C++ first, target profiles layered on top).
- Library dependencies (for example `Wire.h`) are resolved via declaration-first definitions colocated with source files and are **not** transpiled.

## Scope (Current MVP)

- Parse TypeScript source with TypeScript AST.
- Build a normalized IR from supported syntax:
  - named imports
  - function declarations
  - expression statements containing call expressions
  - basic literal/identifier arguments
- Emit C++ with configurable mode:
  - `split`: `.h` + `.cpp`
  - `cpp`: `.cpp` only
- Target profiles:
  - `generic` (default)
  - `arduino` profile (maps legacy `function void()` to `setup()`)
- Auto-generate declaration-first library stubs from imports.

## Non-Goals (MVP)

- Full semantic parity for all TypeScript features.
- Transpiling third-party C++ headers/libraries themselves.
- Complete type-driven overload resolution.

## Architecture

### 1) Frontend (AST)

- Parse source using TypeScript compiler API.
- Normalize legacy Arduino syntax before parse (`function void()` → internal setup placeholder).
- Produce warnings for unsupported statements/top-level constructs.

### 2) Intermediate Representation (IR)

IR captures the minimum stable model for backend emission:

- Program imports
- Function list
- Call statements and argument expressions
- Boilerplate flags (for feature stubs, e.g., async compatibility placeholders)
- Diagnostics

### 3) Library Definition Registry (Declaration-first)

Library metadata is stored as `*.libdef.json`, colocated next to source files.

Example `wire.libdef.json`:

```json
{
  "module": "wire",
  "include": "<Wire.h>",
  "symbols": {
    "Wire": "Wire"
  }
}
```

Resolution pipeline:
- Normalize import module key (e.g., `./wire.ts` → `wire`).
- Resolve include + symbol mapping from libdef registry.
- Fallback include naming when no libdef exists (e.g., `<Wire.h>` style).

### 4) Backend Emitters

- Generic C++ emitter writes declarations/definitions and includes.
- Arduino profile adjusts lifecycle naming behavior (`setup`/`loop` conventions).
- Optional boilerplate blocks inserted when flagged by IR.

## CLI

Commands:

- `transpile <input.ts> [--emit cpp|split] [--target generic|arduino] [--out-dir <dir>]`
- `gen-libdefs <input.ts>`

`gen-libdefs` creates starter files:
- `<module>.libdef.json`

Framework type declarations (for example `Wire`, `SPI`, `EEPROM`, `tone`) are generated into `.build/arduino.d.ts` by `gen-types`/Arduino transpile.

Generated artifacts (`.ino`, `.cpp`, `.h`, `.tscppmap.json`, `arduino.d.ts`) are emitted into a `.build` folder under the source/output base directory.

## Error/Warning Strategy

- Unsupported syntax emits warnings and continues where safe.
- Feature gaps intended for future lowering are tagged in diagnostics.
- Boilerplate insertion points exist for approximations (for now, async warning + stub marker path).

## Example Mapping

Input (`example.ts`) intent:
- `Wire.begin()`
- `Wire.beginTransmission(0x11)`

Output (`example.cpp`):
- `#include <Wire.h>`
- `setup()` and `loop()` definitions
- hex literal preserved as numeric equivalent in emitted C++ expression

### 5) Runtime Polyfill System

The polyfill system provides TypeScript-to-C++ feature mapping for runtime behaviors that don't have direct language equivalents. It automatically detects usage of TypeScript patterns and generates appropriate C++ boilerplate.

#### Architecture

```
src/polyfill/
├── types.ts           # Core types: PolyfillDefinition, RuntimePolyfillIR, configs
├── registry.ts        # PolyfillRegistry - detection and generation orchestration
├── emitter.ts         # C++ code emission from polyfill IR
├── index.ts           # Public exports
└── polyfills/
    ├── console.ts     # console.log → Serial/cout mapping
    ├── async-arduino.ts  # async/await → state machine transformation
    ├── array-methods.ts  # Array.push/pop → std::vector/StaticArray
    └── string-methods.ts # String methods → std::string/StaticString
```

#### Supported Polyfills

| TypeScript Feature | Generic C++ | Arduino | AVR (constrained) |
|-------------------|-------------|---------|-------------------|
| `console.log()` | `std::cout` | `Serial.println()` | `Serial.println()` with F() macros |
| `console.error()` | `std::cerr` | `Serial.print("[ERROR]")` | Same with flash strings |
| `async/await` | State machine stub | Cooperative state machine | State machine |
| `Array.push()` | `std::vector::push_back()` | `std::vector` or `StaticArray` | `StaticArray` template |
| `Array.length` | `vector.size()` | Same | `StaticArray::size()` |
| `String.toUpperCase()` | `std::transform` + `toupper` | Same | `StaticString::toUpperCase()` |
| `String.includes()` | `std::string::find` | Same | `strstr()` |

#### Polyfill Detection

Polyfills are detected by walking the IR and identifying patterns:
- Call expressions to `console.*` methods
- Async function declarations
- Call expressions to array/string methods

#### Configuration

Polyfill behavior can be configured via `PolyfillConfig`:

```typescript
const config: PolyfillConfig = {
  console: {
    enabled: true,
    target: "auto",  // "auto" | "serial" | "cout" | "none"
    useFlashStrings: true,  // AVR F() macros
  },
  async: {
    enabled: true,
    mode: "state-machine",  // "state-machine" | "stub" | "none"
    scheduler: false,
  },
  arrays: {
    enabled: true,
    prefer: "auto",  // "auto" | "std_vector" | "static_array"
    staticMaxSize: 32,
  },
  strings: {
    enabled: true,
    prefer: "auto",  // "auto" | "std_string" | "static_string"
    staticMaxLen: 64,
  },
};
```

#### Architecture-Aware Selection

The system automatically selects implementations based on target architecture:

| Architecture | std::vector | std::string | iostream | RTTI | Exceptions |
|-------------|-------------|-------------|----------|------|------------|
| avr | ❌ | ❌ | ❌ | ❌ | ❌ |
| megaavr | ❌ | ❌ | ❌ | ❌ | ❌ |
| esp32 | ✅ | ✅ | ✅ | ✅ | ✅ |
| esp8266 | ✅ | ✅ | ✅ | ✅ | ✅ |
| rp2040 | ✅ | ✅ | ✅ | ✅ | ✅ |
| samd | ✅ | ✅ | ✅ | ✅ | ✅ |
| generic | ✅ | ✅ | ✅ | ✅ | ✅ |

For constrained platforms (AVR), the system generates lightweight alternatives:
- `StaticArray<T, MaxSize>` - fixed-capacity array with push/pop
- `StaticString<MaxLen>` - fixed-capacity string with basic operations

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Core IR | ✅ Complete | Functions, classes, enums, control flow |
| console.* transforms | ✅ Complete | `console.log` → `std::cout` / `Serial.println` |
| async/await stubs | ⚠️ Partial | Stub marker only; needs state machine |
| Array methods | 🔲 Planned | `push`/`pop`/`map`/`filter` |
| String methods | 🔲 Planned | `split`/`toUpperCase`/`includes` |
| setInterval/setTimeout | 🔲 Planned | Arduino timer abstraction |
| Promise-like patterns | 🔲 Planned | Cooperative scheduler |

---

## Domain-Specific Transpilation Patterns

### 1. Standard Library Polyfills (console.*)

**Status: ✅ Implemented**

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `console.log(x)` | `std::cout << x << std::endl;` | `Serial.println(x);` |
| `console.error(x)` | `std::cerr << "[ERROR] " << x << std::endl;` | `Serial.print("[ERROR] "); Serial.println(x);` |
| `console.warn(x)` | `std::cerr << "[WARN] " << x << std::endl;` | `Serial.print("[WARN] "); Serial.println(x);` |
| `console.info(x)` | `std::cout << "[INFO] " << x << std::endl;` | `Serial.print("[INFO] "); Serial.println(x);` |
| `console.debug(x)` | `std::cout << "[DEBUG] " << x << std::endl;` | `Serial.print("[DEBUG] "); Serial.println(x);` |

Implementation notes:
- Detects `console.*` calls via `isConsoleCall()` in emitter
- Automatically adds `#include <iostream>` for generic C++ target
- For Arduino, requires `Serial.begin()` in user code

### 2. Async/Await Patterns (Arduino Domain)

**Status: ⚠️ Stub Only - Needs Implementation**

TypeScript async/await doesn't map directly to C++ because:
- C++ has no built-in event loop
- Arduino is single-threaded with no standard coroutine support
- Blocking waits are problematic for embedded systems

#### Proposed: Cooperative State Machine Transform

**Input TypeScript:**
```typescript
async function blinkLed() {
  while (true) {
    digitalWrite(LED_BUILTIN, HIGH);
    await delay(500);
    digitalWrite(LED_BUILTIN, LOW);
    await delay(500);
  }
}
```

**Generated C++ (State Machine):**
```cpp
class BlinkLedTask {
public:
  enum State { START, WAIT1, WAIT2 };
  
  void run() {
    switch (state) {
      case START:
        digitalWrite(LED_BUILTIN, HIGH);
        waitUntil = millis() + 500;
        state = WAIT1;
        break;
        
      case WAIT1:
        if (millis() >= waitUntil) {
          digitalWrite(LED_BUILTIN, LOW);
          waitUntil = millis() + 500;
          state = WAIT2;
        }
        break;
        
      case WAIT2:
        if (millis() >= waitUntil) {
          state = START;  // Loop
        }
        break;
    }
  }
  
private:
  State state = START;
  unsigned long waitUntil = 0;
};

BlinkLedTask blinkLedTask;

void loop() {
  blinkLedTask.run();
}
```

**Implementation Approach:**
1. Detect `async` keyword in function declaration (already done in IR builder)
2. Identify `await` expressions and their positions
3. Transform control flow into switch-based state machine
4. Generate task class with `run()` method
5. Register task in `loop()` automatically or via annotation

#### Simplified Alternative: do...while Stub

For simple cases without complex await points:
```cpp
// async function doSomething() { ... }
// Becomes:
void doSomething() {
  // Function body runs to completion
  // Warning: async semantics not preserved
}
```

### 3. Timer Functions (setInterval/setTimeout)

**Status: 🔲 Planned**

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `setTimeout(fn, ms)` | `std::thread` + `std::this_thread::sleep_for` | Task scheduler |
| `setInterval(fn, ms)` | `std::thread` + loop | Task scheduler |
| `clearInterval(id)` | Thread cancel | Remove from scheduler |

**Arduino Implementation Pattern:**
```cpp
// TypeScript: setInterval(() => blink(), 1000)
// Generated:
class IntervalTask {
public:
  IntervalTask(unsigned long interval) : interval(interval) {}
  
  void run() {
    if (millis() - lastRun >= interval) {
      blink();
      lastRun = millis();
    }
  }
  
private:
  unsigned long interval;
  unsigned long lastRun = 0;
};

IntervalTask task1(1000);

void loop() {
  task1.run();
}
```

### 4. Array Methods

**Status: 🔲 Planned**

| TypeScript | Generic C++ | Arduino (AVR) | Arduino (ESP32) |
|------------|-------------|---------------|-----------------|
| `arr.push(x)` | `vec.push_back(x)` | `StaticArray::push(x)` | `std::vector` |
| `arr.pop()` | `vec.pop_back()` | `StaticArray::pop()` | `std::vector` |
| `arr.length` | `vec.size()` | `StaticArray::size()` | `vec.size()` |
| `arr.map(fn)` | ❌ Needs transform | ❌ Manual loop | ❌ Manual loop |
| `arr.filter(fn)` | ❌ Needs copy_if | ❌ Manual loop | ❌ Manual loop |

**StaticArray Template for AVR:**
```cpp
template<typename T, size_t MaxSize>
class StaticArray {
  T data[MaxSize];
  size_t count = 0;
public:
  bool push(const T& item) {
    if (count >= MaxSize) return false;
    data[count++] = item;
    return true;
  }
  
  T pop() {
    if (count == 0) return T();
    return data[--count];
  }
  
  size_t size() const { return count; }
  T& operator[](size_t i) { return data[i]; }
};
```

### 5. String Methods

**Status: 🔲 Planned**

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `str.toUpperCase()` | `std::transform` | `String::toUpperCase()` |
| `str.toLowerCase()` | `std::transform` | `String::toLowerCase()` |
| `str.includes(sub)` | `str.find(sub) != npos` | `String::indexOf() >= 0` |
| `str.split(sep)` | Custom split function | Custom split function |
| `str.trim()` | `str.erase(remove_if...)` | `String::trim()` |
| `str.startsWith(pre)` | `str.rfind(pre, 0) == 0` | `String::startsWith()` |
| `str.endsWith(suf)` | `str.compare(...)` | `String::endsWith()` |

### 6. Error Handling Patterns

**Status: 🔲 Planned**

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `try { } catch (e) { }` | `try { } catch (...) { }` | Conditional compilation |
| `throw new Error(msg)` | `throw std::runtime_error(msg)` | `Serial.println(msg); return;` |

For Arduino/AVR (exceptions disabled):
```cpp
// Option 1: Error callback
void onError(const char* msg) {
  Serial.println(msg);
}

// Option 2: Result codes
enum Result { OK, ERROR };
Result doSomething() { ... }
```

### 7. Object/Map Patterns

**Status: 🔲 Planned**

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `{ key: value }` | `struct` (current) | `struct` |
| `obj.key` | `obj.key` | `obj.key` |
| `map.get(key)` | `std::unordered_map` | Simple key-value array |
| `map.set(key, val)` | `map[key] = val` | Linear search + set |

---

## Implementation Priority

1. **High Priority**
   - ✅ `console.*` transforms (DONE)
   - 🔲 Async/await state machine for Arduino
   - 🔲 `setInterval`/`setTimeout` scheduler

2. **Medium Priority**
   - 🔲 Array `push`/`pop`/`length` with StaticArray template
   - 🔲 String `toUpperCase`/`toLowerCase`/`trim`
   - 🔲 Error handling mode selection

3. **Lower Priority**
   - 🔲 Array `map`/`filter`/`reduce`
   - 🔲 Object/Map full support
   - 🔲 Promise chain transforms

---

## Configuration Options (Planned)

```typescript
interface TranspilePolyfillConfig {
  console: {
    enabled: boolean;
    target: "auto" | "serial" | "cout" | "custom";
    customHandler?: string;  // e.g., "myLogFunction"
  };
  
  async: {
    enabled: boolean;
    mode: "state-machine" | "stub" | "none";
    scheduler: boolean;  // Auto-register tasks in loop()
  };
  
  timers: {
    enabled: boolean;
    mode: "scheduler" | "none";
  };
  
  arrays: {
    enabled: boolean;
    prefer: "auto" | "vector" | "static";
    staticMaxSize: number;  // For StaticArray
  };
  
  strings: {
    enabled: boolean;
    prefer: "auto" | "std" | "arduino-string";
  };
  
  exceptions: {
    mode: "auto" | "try-catch" | "error-callback" | "result-codes";
    errorCallback?: string;
  };
}
```

---

## Next Implementation Phases

1. ~~Expand IR coverage (control flow, variable declarations, returns with expressions).~~ ✅
2. ~~Add type-aware lowering via TypeScript type checker.~~ ✅
3. ~~Improve symbol resolution for namespaces/classes/functions across modules.~~ ✅
4. ~~Add richer boilerplate approximations (async/event-loop bridging policies).~~ ✅ (via polyfill system)
5. ✅ Integrate console.* polyfill into main transpile pipeline.
6. 🔲 Implement async/await state machine transform for Arduino.
7. 🔲 Add timer scheduler (setInterval/setTimeout).
8. 🔲 Add test fixtures and golden output snapshot tests for polyfills.
9. 🔲 Add optional validation hooks (format/lint/compile checks for generated C++).
