# TypeScript to C++ Language Support

This document tracks TypeScript language feature support in the transpiler. It serves as a reference for implementation status and a guide for adding new features.

## Implementation Architecture

```
TypeScript Source
       │
       ▼
┌─────────────────┐
│  AST Parser     │  src/ast/parse.ts
│  (ts.createSourceFile)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  IR Builder     │  src/ir/build-ir.ts
│  (AST → IR)     │  Transforms TS AST nodes to intermediate representation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  IR Model       │  src/ir/model.ts
│  (type defs)    │  Defines StatementIR, ExpressionIR, FunctionIR, etc.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  C++ Emitter    │  src/emit/cpp-emitter.ts
│  (IR → C++)     │  Renders IR to C++ source code
└─────────────────┘
```

### Key Files for Adding Features

| File | Purpose |
|------|---------|
| `src/ir/model.ts` | Define new IR node types |
| `src/ir/build-ir.ts` | Transform TS AST nodes to IR |
| `src/emit/cpp-emitter.ts` | Render IR nodes to C++ code |

---

## Supported Features

### Types

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| `number` → `int` | ✅ Done | `CppType = "int"` | Inferred from integer literals; explicit `: number` annotation |
| `number` → `float` | ✅ Done | `CppType = "float"` | Inferred from literals with `.` or `e/E` |
| `boolean` → `bool` | ✅ Done | `CppType = "bool"` | Explicit `: boolean` annotation or `true`/`false` literals |
| `string` → `auto` | ✅ Done | `CppType = "auto"` | Emits warning `TS2CPP_STRING_AUTO`; C++ needs proper string type |
| Return type inference | ✅ Done | `buildFunctionReturnTypeMap()` | Multi-pass inference from `return` statements |
| `void` return | ✅ Done | `CppType = "void"` | Explicit or inferred from no return value |
| `auto` (untyped) | ✅ Done | `CppType = "auto"` | Default fallback for unmapped types |

### Functions

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Named declarations | ✅ Done | `FunctionIR` | `ts.isFunctionDeclaration` in `build-ir.ts` |
| Parameters | ✅ Done | `ParameterIR[]` | Name and type extracted; `typeNodeToCppType()` |
| Default parameters | ✅ Done | `ParameterIR.defaultValue` | `param: number = 0` → `int param = 0` |
| Return statements | ✅ Done | `ReturnIR` | With or without value |
| Async functions | ⚠️ Stub | `isAsync: boolean` | Emits `TsAsyncTask` stub; approximate semantics only |
| Arduino `setup()` | ✅ Done | `mapFunctionName()` | Maps `function void()` legacy syntax and `__arduino_setup__` |
| Arduino `loop()` | ✅ Done | `mapFunctionName()` | Standard Arduino entry point |

### Variables

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| `var` declarations | ✅ Done | `VariableDeclarationIR` | `storage: "var"` |
| `let` declarations | ✅ Done | `VariableDeclarationIR` | `storage: "let"` |
| `const` declarations | ✅ Done | `VariableDeclarationIR` | `storage: "const"` → `const <type>` in C++ |
| Initializers | ✅ Done | `initializer?: ExpressionIR` | Type inferred from initializer expression |
| Type annotations | ✅ Done | `cppType` field | Explicit type takes precedence over inference |
| Top-level variables | ✅ Done | `topLevelStatements` | Global scope declarations |

### Expressions

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Numeric literals | ✅ Done | `{ kind: "number", value }` | Integer and float |
| String literals | ✅ Done | `{ kind: "string", value }` | Escaped quotes |
| Template literals (simple) | ✅ Done | `{ kind: "string", value }` | No interpolation: `` `text` `` |
| Template literals (interpolated) | ⚠️ Raw | `{ kind: "raw", value }` | Warning emitted; consider string concatenation |
| Boolean literals | ✅ Done | `{ kind: "boolean", value }` | `true`/`false` |
| Identifiers | ✅ Done | `{ kind: "identifier", value }` | Variable/function names |
| `this` keyword | ✅ Done | `{ kind: "raw", value: "this" }` | For class method access |
| Parenthesized | ✅ Done | Recurses to inner | `(expr)` preserves parens in raw output |
| Binary arithmetic | ✅ Done | `{ kind: "raw", value }` | `+`, `-`, `*`, `/`, `%` |
| Binary comparison | ✅ Done | `{ kind: "raw", value }` | Returns `bool`: `==`, `===`, `!=`, `!==`, `<`, `>`, `<=`, `>=` |
| Binary logical | ✅ Done | `{ kind: "raw", value }` | `&&`, `||` → returns `bool` |
| Assignment operators | ✅ Done | `AssignmentIR.operator` | `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=` |
| Prefix `++`/`--` | ✅ Done | `UpdateIR { prefix: true }` | `++x`, `--x` |
| Postfix `++`/`--` | ✅ Done | `UpdateIR { prefix: false }` | `x++`, `x--` |
| Function calls | ✅ Done | `CallExpressionIR` | Callee + args |
| Method calls | ✅ Done | `CallExpressionIR` | Property access: `obj.method()` |
| `new` expressions | ✅ Done | `{ kind: "raw", value }` | Emitted as raw text |
| Type assertions | ✅ Done | Stripped | `expr as Type` and `<Type>expr` use inner expression |
| Property access | ✅ Done | `{ kind: "raw", value }` | `a.b.c` chain rendering via `calleeToText()` |
| Element access | ✅ Done | `{ kind: "raw", value }` | `arr[index]` → `arr[index]` |
| Ternary operator | ✅ Done | `{ kind: "ternary", ... }` | `a ? b : c` → `(a ? b : c)` |
| Array literals | ✅ Done | `{ kind: "array", ... }` | `{ kind: "array", elementType: "auto", elements: [...] }` |
| Object literals | ✅ Done | `{ kind: "object", ... }` | Inline struct generated; `{ .field = value, ... }` |

### Statements

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Expression statements | ✅ Done | Various | Calls, assignments, updates |
| Variable declarations | ✅ Done | `VariableDeclarationIR` | See Variables section |
| Assignment | ✅ Done | `AssignmentIR` | Target, operator, value |
| Return (no value) | ✅ Done | `ReturnIR` | `return;` |
| Return (with value) | ✅ Done | `ReturnIR` | `return expr;` |
| `while` loops | ✅ Done | `WhileIR` | Condition + body statements |
| `do...while` loops | ✅ Done | `DoWhileIR` | Body executes first, then condition checked |
| `if`/`else` statements | ✅ Done | `IfIR` | Condition + thenBranch + optional elseBranch |
| `for` loops (C-style) | ✅ Done | `ForIR` | Initializer + condition + increment + body |
| `for...of` loops | ✅ Done | `ForOfIR` | Range-based for: `for (auto item : iterable)` |
| `break` statement | ✅ Done | `BreakIR` | Loop/switch exit |
| `continue` statement | ✅ Done | `ContinueIR` | Loop continuation |
| `switch` statements | ✅ Done | `SwitchIR` | Expression + cases (including default) |
| `try`/`catch` | ✅ Done | `TryIR` | Catches as `const std::exception&` |
| `throw` statements | ✅ Done | `ThrowIR` | `throw expr;` |

### Classes

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Class declarations | ✅ Done | `ClassIR` | Name + fields + methods + constructor |
| Fields | ✅ Done | `ClassFieldIR` | Name, type, visibility, initializer |
| Methods | ✅ Done | `ClassMethodIR` | Name, return type, params, body, visibility, static |
| Constructor | ✅ Done | `ClassConstructorIR` | Parameters + body statements |
| `public` visibility | ✅ Done | `visibility: "public"` | Default visibility |
| `private` visibility | ✅ Done | `visibility: "private"` | |
| `protected` visibility | ✅ Done | `visibility: "protected"` | |
| `static` methods | ✅ Done | `isStatic: boolean` | |

### Enums

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Enum declarations | ✅ Done | `EnumIR` | Emits `enum class` |
| Const enums | ✅ Done | `isConst: boolean` | Also emits as `enum class` |
| Auto-increment values | ✅ Done | `value?: number` | Members without initializer auto-increment |
| Explicit values | ✅ Done | `value?: number` | `Member = 5` syntax |
| Negative values | ✅ Done | Handled in parser | `Member = -1` |

### Comments

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Leading comments | ✅ Done | `leadingComments?: string[]` | Extracted via `ts.getLeadingCommentRanges` |
| Trailing comments | ✅ Done | `trailingComments?: string[]` | Extracted via `ts.getTrailingCommentRanges` |

### Imports

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| Named imports | ✅ Done | `ImportIR` | `import { A, B } from "module"` |
| Library definitions | ✅ Done | `*.libdef.json` | Maps modules to C++ includes and symbols |
| Platform variants | ✅ Done | `variants[]` in libdef | Architecture-specific include/symbol overrides |
| Symbol mapping | ✅ Done | `symbolMap` in emitter | TS names → C++ names |

### Arduino Platform

| Feature | Status | IR Location | Implementation Notes |
|---------|--------|-------------|---------------------|
| `#include <Arduino.h>` | ✅ Done | `resolveArduinoProfile()` | Auto-injected for Arduino target |
| `.ino` output | ✅ Done | `sourceExtension = "ino"` | Single sketch file |
| Built-in symbols | ✅ Done | Profile tables | `HIGH`, `LOW`, `OUTPUT`, `INPUT`, etc. |
| Pin constants | ✅ Done | Profile tables | `A0`, `A1`, etc. with architecture fallbacks |
| `pinMode`/`digitalWrite`/etc | ✅ Done | Capability tables | Validates against known built-ins |
| `Serial` object | ✅ Done | Built-in globals | Recognized as valid |
| `Wire` object | ✅ Done | libdef | Via `<Wire.h>` library definition |
| Architecture profiles | ✅ Done | `arduino-profile.ts` | AVR, ESP32, SAMD, RP2040, etc. |
| `arduino-cli` compile | ✅ Done | `arduino-compile.ts` | Post-transpile compilation |
| Error mapping | ✅ Done | `source-map.ts` | C++ errors → TS source locations |
| Type declarations | ✅ Done | `arduino.d.ts` | Auto-generated for editor DX |

---

## Runtime Polyfills

The transpiler includes a polyfill system that maps TypeScript runtime features to C++ equivalents. Polyfills are automatically detected and appropriate boilerplate is generated.

### Console Output

| TypeScript | Generic C++ | Arduino | AVR |
|------------|-------------|---------|-----|
| `console.log(msg)` | `std::cout << msg << std::endl` | `Serial.println(msg)` | `Serial.println(msg)` with F() macros |
| `console.error(msg)` | `std::cerr << "[ERROR] " << msg` | `Serial.print("[ERROR]"); Serial.println(msg)` | Same with flash strings |
| `console.warn(msg)` | `std::cerr << "[WARN] " << msg` | `Serial.print("[WARN]"); Serial.println(msg)` | Same with flash strings |

**Detection**: Call expressions starting with `console.`

**Generated Code Example** (Arduino):
```cpp
// Polyfill: console.log for Arduino
inline void console_log(const char* msg) { Serial.println(msg); }
inline void console_log(int val) { Serial.println(val); }
inline void console_log(float val) { Serial.println(val); }
// ... additional overloads
```

### Async/Await (Arduino)

| TypeScript | Arduino C++ |
|------------|-------------|
| `async function foo()` | `FooTask` state machine class |
| `await delay(1000)` | State transition with `millis()` check |
| `await someAsyncOp()` | State machine yield point |

**Detection**: Functions with `async` keyword

**Generated Code Pattern**:
```cpp
class FooTask {
public:
  enum State { STATE_0, STATE_1, STATE_COMPLETE };
  
  void run() {
    switch (_state) {
      case STATE_0:
        // Initial execution
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
  
  bool isComplete() const { return _state == STATE_COMPLETE; }
  void reset() { _state = STATE_0; }
  
private:
  State _state;
  unsigned long _waitUntil;
};
```

**Note**: Full async transformation requires integration with the main loop. Call `task.run()` in `loop()`.

### Array Methods

| TypeScript | std::vector (ESP32/RP2040) | StaticArray (AVR) |
|------------|---------------------------|-------------------|
| `arr.push(x)` | `arr.push_back(x)` | `arr.push_back(x)` |
| `arr.pop()` | `arr.pop_back()` | `arr.pop_back()` |
| `arr.length` | `arr.size()` | `arr.size()` |

**Detection**: Call expressions to `.push()`, `.pop()`, etc.

**AVR StaticArray Template**:
```cpp
template<typename T, size_t MaxSize = 32>
struct StaticArray {
    T data[MaxSize];
    size_t length = 0;
    
    void push_back(const T& value);
    T pop_back();
    T& operator[](size_t index);
    size_t size() const { return length; }
    bool empty() const;
    bool full() const;
    T* begin();
    T* end();
    void clear();
};
```

### String Methods

| TypeScript | std::string | StaticString (AVR) |
|------------|-------------|-------------------|
| `s.toUpperCase()` | `std::transform` + `toupper` | `s.toUpperCase()` (in-place) |
| `s.toLowerCase()` | `std::transform` + `tolower` | `s.toLowerCase()` (in-place) |
| `s.includes(sub)` | `s.find(sub) != npos` | `s.includes(sub)` |
| `s.startsWith(pre)` | `s.rfind(pre, 0) == 0` | `s.startsWith(pre)` |
| `s.endsWith(suf)` | `s.compare(...)` | `s.endsWith(suf)` |
| `s.trim()` | `find_first_not_of` pattern | `s.trim()` (in-place) |

**Detection**: Call expressions to string methods

**AVR StaticString Template**:
```cpp
template<size_t MaxLen = 64>
struct StaticString {
    char data[MaxLen + 1];
    size_t length = 0;
    
    void set(const char* s);
    bool includes(const char* substr) const;
    bool startsWith(const char* prefix) const;
    bool endsWith(const char* suffix) const;
    void toUpperCase();
    void toLowerCase();
    void trim();
    const char* c_str() const;
    size_t size() const;
};
```

### Architecture Support Matrix

| Feature | avr | megaavr | esp32 | esp8266 | rp2040 | samd | generic |
|---------|-----|---------|-------|---------|--------|------|---------|
| `std::vector` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std::string` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `<iostream>` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| RTTI | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Exceptions | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `StaticArray` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `StaticString` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Polyfill Configuration

Polyfills can be configured via `PolyfillConfig`:

```typescript
interface PolyfillConfig {
  console?: {
    enabled: boolean;
    target: "auto" | "serial" | "cout" | "none";
    useFlashStrings?: boolean;  // Use F() macros on AVR
  };
  async?: {
    enabled: boolean;
    mode: "state-machine" | "stub" | "none";
    scheduler?: boolean;
  };
  arrays?: {
    enabled: boolean;
    prefer: "auto" | "std_vector" | "static_array";
    staticMaxSize?: number;
  };
  strings?: {
    enabled: boolean;
    prefer: "auto" | "std_string" | "static_string";
    staticMaxLen?: number;
  };
}
```

### Polyfill Implementation Files

| File | Purpose |
|------|---------|
| `src/polyfill/types.ts` | Core types and architecture support tables |
| `src/polyfill/registry.ts` | PolyfillRegistry - detection and generation |
| `src/polyfill/emitter.ts` | C++ code emission from polyfill IR |
| `src/polyfill/polyfills/console.ts` | Console output polyfill |
| `src/polyfill/polyfills/async-arduino.ts` | Async/await state machine |
| `src/polyfill/polyfills/array-methods.ts` | Array method polyfills |
| `src/polyfill/polyfills/string-methods.ts` | String method polyfills |

---

## Planned Features

### Medium Priority

| Feature | Status | Priority | Implementation Notes |
|---------|--------|----------|---------------------|
| `for...in` loops | ✅ Done | Medium | Emits warning; for embedded C++, prefer array iteration |
| Interface type checking | ✅ Done | Medium | Type-only; interfaces stored in IR for type checking, no C++ output |
| Type alias support | ✅ Done | Medium | `type MyType = number` → `using MyType = <type>;` |
| `instanceof` operator | ✅ Done | Medium | Emits C++ `dynamic_cast`; RTTI must be enabled |
| Spread in arrays | ✅ Done | Medium | `[...arr, x]` emits comment placeholder; limited support |
| String interpolation | ✅ Done | Medium | `` `Hello ${name}` `` → `String(...) + "..."` concatenation |

### Low Priority

| Feature | Status | Priority | Implementation Notes |
|---------|--------|----------|---------------------|
| Destructuring | ✅ Done | Low | Object and array destructuring supported |
| Arrow functions | ✅ Done | Low | Supported via callback IR for interrupt handlers |
| Rest parameters | 🔴 Not started | Low | Requires variadic templates |
| Function overloads | 🔴 Not started | Low | C++ supports but complex IR mapping |
| `finally` block | ✅ Done | Low | `try/catch/finally` - finally executes in catch, or catch-all + rethrow for finally-only |
| Namespaces | ✅ Done | Low | C++ namespaces with enums, classes, functions, constants, type aliases |

---

## Not Supported (Out of Scope)

| Feature | Reason |
|---------|--------|
| Dynamic imports | No runtime module system in C++ |
| Generics | C++ templates are different; complex mapping required |
| Decorators | No C++ equivalent |
| JSX | Not applicable for C++ target |
| `typeof` operator | TypeScript type-level only |
| `keyof` operator | TypeScript type-level only |
| Mapped types | TypeScript type-level only |
| Conditional types | TypeScript type-level only |
| `any` type | Defeats type safety; use explicit types |
| `unknown` type | Similar issues to `any` |
| `symbol` type | No direct C++ equivalent |
| `bigint` type | Requires external library |
| Mixed enums | String/number mixed enums complex |
| Computed property names | `{ [key]: value }` requires runtime support |
| Getters/setters | Possible but not yet implemented |
| `export`/module system | C++ has different compilation model |
| `declare` keyword | Ambient declarations not emitted |
| Triple-slash directives | Only type references processed |

---

## Implementation Guide

### Adding a New Statement Type

1. **Define IR node** in `src/ir/model.ts`:
   ```typescript
   export interface NewStatementIR {
     kind: "new_statement";
     sourceSpan: SourceSpan;
     leadingComments?: string[];
     trailingComments?: string[];
     // ... additional fields
   }
   ```

2. **Update union type**:
   ```typescript
   export type StatementIR = ... | NewStatementIR;
   ```

3. **Transform in `src/ir/build-ir.ts`**:
   ```typescript
   if (ts.isSomeStatement(statement)) {
     const comments = extractNodeComments(statement, sourceText);
     // ... extract fields from TS node
     return [{
       kind: "new_statement",
       sourceSpan: makeSourceSpan(statement, fileName, sourceText),
       leadingComments: comments.leadingComments,
       trailingComments: comments.trailingComments,
       // ... additional fields
     }];
   }
   ```

4. **Render in `src/emit/cpp-emitter.ts`**:
   - Add to `renderStatement()` for header-style rendering (e.g., `for` loop header)
   - Add to `appendRenderedStatement()` for body rendering with braces

### Adding a New Expression Type

1. **Extend `ExpressionIR`** in `src/ir/model.ts`:
   ```typescript
   export type ExpressionIR =
     | ... existing kinds ...
     | { kind: "new_expr"; /* fields */ };
   ```

2. **Handle in `expressionToIR()`** in `src/ir/build-ir.ts`:
   ```typescript
   if (ts.isSomeExpression(expr)) {
     return { kind: "new_expr", /* fields */ };
   }
   ```

3. **Handle in `renderExpression()`** in `src/emit/cpp-emitter.ts`:
   ```typescript
   case "new_expr":
     return /* C++ rendering */;
   ```

4. **Also update `renderExprAsText()`** if the expression needs to be rendered in nested contexts.

### Type Inference

Types are inferred in `build-ir.ts`:

- `typeNodeToCppType()` - converts TS type annotations to C++ types
- `inferExprCppType()` - infers type from expression
- `inferNumericCppType()` - distinguishes int vs float from literal text
- `buildFunctionReturnTypeMap()` - multi-pass function return type inference
- `updateLocalTypeFromAssignment()` - tracks local variable types through assignments

### Testing New Features

1. Add test case to `example/example.ts` or create new example
2. Run: `npm run build && npm run transpile -- example/example.ts --target arduino`
3. Check output in `example/example/example.ino`
4. Verify with `--compile-arduino true` if targeting Arduino

---

## Detailed Implementation Notes

### Control Flow

#### `if`/`else` (IfIR)
- **IR**: `src/ir/model.ts:50-58`
- **Build**: `src/ir/build-ir.ts:439-461` - `ts.isIfStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:282-298` - Always uses braces for then/else
- **Notes**: Single statements are wrapped in braces for safety

#### `for` loops (ForIR)
- **IR**: `src/ir/model.ts:60-70`
- **Build**: `src/ir/build-ir.ts:463-503` - `ts.isForStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:300-312`
- **Notes**: Initializer can be variable declaration or expression; increment can be update or assignment

#### `for...of` loops (ForOfIR)
- **IR**: `src/ir/model.ts:72-81`
- **Build**: `src/ir/build-ir.ts:505-531` - `ts.isForOfStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:314-324` - Emits C++ range-based for
- **Notes**: `for (const item of arr)` → `for (auto item : arr)`

#### `while` loops (WhileIR)
- **IR**: `src/ir/model.ts:44-50`
- **Build**: `src/ir/build-ir.ts:418-437` - `ts.isWhileStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:268-281`
- **Notes**: Body always wrapped in braces

#### `do...while` loops (DoWhileIR)
- **IR**: `src/ir/model.ts:100-107`
- **Build**: `src/ir/build-ir.ts:548-567` - `ts.isDoStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:326-341`
- **Notes**: Condition checked after body executes

#### `switch` statements (SwitchIR)
- **IR**: `src/ir/model.ts:109-121` + `CaseIR` at 123-130
- **Build**: `src/ir/build-ir.ts:569-616` - `ts.isSwitchStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:343-369`
- **Notes**: Both case and default clauses supported; no automatic break insertion

#### `break`/`continue` (BreakIR/ContinueIR)
- **IR**: `src/ir/model.ts:83-94`
- **Build**: `src/ir/build-ir.ts:533-547`
- **Emit**: `src/emit/cpp-emitter.ts:332-336` (break), 337-341 (continue)
- **Notes**: Simple passthrough to C++ keywords

#### `try`/`catch` (TryIR)
- **IR**: `src/ir/model.ts:132-142`
- **Build**: `src/ir/build-ir.ts:619-652` - `ts.isTryStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:371-395`
- **Notes**: Catches `const std::exception&`; catch parameter preserved

#### `throw` (ThrowIR)
- **IR**: `src/ir/model.ts:144-151`
- **Build**: `src/ir/build-ir.ts:654-665` - `ts.isThrowStatement()`
- **Emit**: `src/emit/cpp-emitter.ts:397-404`
- **Notes**: Direct passthrough to C++ throw

### Expressions

#### Ternary operator
- **IR**: `{ kind: "ternary", condition, whenTrue, whenFalse }` in ExpressionIR union
- **Build**: `src/ir/build-ir.ts:330-340` - `ts.isConditionalExpression()`
- **Emit**: `src/emit/cpp-emitter.ts:133-135` - Wrapped in parens for safety
- **Notes**: Type inference not yet implemented for ternary

#### Array literals
- **IR**: `{ kind: "array", elementType: string, elements: ExpressionIR[] }`
- **Build**: `src/ir/build-ir.ts:343-349` - `ts.isArrayLiteralExpression()`
- **Emit**: `src/emit/cpp-emitter.ts:137-140` + `renderStatement()` for var_decl
- **Notes**: Emits C-style array `int arr[] = { ... }`; element type defaults to "auto" → "int"

#### Object literals
- **IR**: `{ kind: "object", fields: { name: string; value: ExpressionIR }[] }`
- **Build**: `src/ir/build-ir.ts:352-371` - `ts.isObjectLiteralExpression()`
- **Emit**: `src/emit/cpp-emitter.ts:142-145` + inline struct generation in `renderStatement()`
- **Notes**: Generates anonymous struct with designated initializers: `struct _name_t { int field; } name = { .field = value }`

#### Property/Element access
- **Build**: 
  - Property: `src/ir/build-ir.ts:317-321` - `ts.isPropertyAccessExpression()`
  - Element: `src/ir/build-ir.ts:324-329` - `ts.isElementAccessExpression()`
- **Notes**: Both emit as `{ kind: "raw", value: "obj.prop" }` or `arr[idx]`

### Classes

#### Class declarations
- **IR**: `ClassIR` with `ClassFieldIR`, `ClassMethodIR`, `ClassConstructorIR`
- **Build**: `src/ir/build-ir.ts:782-877` - `ts.isClassDeclaration()`
- **Emit**: `src/emit/cpp-emitter.ts:457-532`
- **Notes**: 
  - Visibility sections emitted in order: public, private, protected
  - Constructor emits as inline definition
  - Static methods use `static` keyword prefix
  - Fields with initializers use inline initialization

### Enums

- **IR**: `EnumIR` with `members: { name: string; value?: number }[]`
- **Build**: `src/ir/build-ir.ts:879-919` - `ts.isEnumDeclaration()`
- **Emit**: `src/emit/cpp-emitter.ts:441-455`
- **Notes**:
  - Always emits `enum class` (scoped enum)
  - Auto-increment: members without values get sequential integers
  - Negative values handled via prefix unary expression check

### Default Parameters

- **IR**: `ParameterIR.defaultValue?: ExpressionIR`
- **Build**: `src/ir/build-ir.ts:748-757` - `parameter.initializer`
- **Emit**: `src/emit/cpp-emitter.ts:166-175` - Appends `= value` to parameter
- **Notes**: Works for both functions and class constructors

---

## Diagnostic Codes

| Code | Severity | Meaning |
|------|----------|---------|
| `TS2CPP_RAW_EXPR` | Warning | Expression emitted as raw text; needs lowering rule |
| `TS2CPP_UNSUPPORTED_STMT` | Warning | Statement type not handled in function body |
| `TS2CPP_UNSUPPORTED_DECL` | Warning | Declaration type not supported (e.g., destructuring) |
| `TS2CPP_UNSUPPORTED_TOPLEVEL` | Warning | Top-level node skipped |
| `TS2CPP_STRING_AUTO` | Warning | `string` type emitted as `auto` |
| `TS2CPP_UNMAPPED_TYPE` | Warning | Type annotation not mapped to C++ type |
| `TS2CPP_ASYNC_STUB` | Warning | Async function using approximate stub |
| `TS2CPP_ARDUINO_SPLIT_IGNORED` | Info | Split mode ignored for Arduino target |