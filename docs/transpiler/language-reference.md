# Language Reference

TypeScript to C++ language mapping for TypeCode.

## Types

### Primitive Types

| TypeScript | C++ | Notes |
|------------|-----|-------|
| `number` | `int` | Default integer type |
| `number` (float literal) | `float` | Inferred from usage |
| `boolean` | `bool` | |
| `string` | `const char*` | String literals |
| `void` | `void` | |
| `null` | `nullptr` | |
| `undefined` | *(omitted)* | Treated as uninitialized |

### Explicit Number Types

```typescript
// TypeScript type annotations
let a: int8 = 127;
let b: uint8 = 255;
let c: int16 = 32767;
let d: uint16 = 65535;
let e: int32 = 2147483647;
let f: uint32 = 4294967295;
let g: float = 3.14;
let h: double = 3.14159265359;
```

```cpp
// Generated C++
int8_t a = 127;
uint8_t b = 255;
int16_t c = 32767;
uint16_t d = 65535;
int32_t e = 2147483647;
uint32_t f = 4294967295;
float g = 3.14;
double h = 3.14159265359;
```

### Arrays

```typescript
// Fixed-size array
const data: uint8[] = [1, 2, 3, 4, 5];

// Typed array (preferred for binary data)
const buffer = new Uint8Array(64);
```

```cpp
// Generated C++
const uint8_t data[] = {1, 2, 3, 4, 5};
uint8_t buffer[64] = {0};
```

## Variables

### Declaration

```typescript
// TypeScript
let counter = 0;
const LED_PIN = 13;
let message = "Hello";
```

```cpp
// Generated C++
int counter = 0;
const int LED_PIN = 13;
const char* message = "Hello";
```

### Assignment

```typescript
counter = 10;
counter += 1;
counter++;
```

```cpp
counter = 10;
counter += 1;
counter++;
```

## Functions

### Basic Functions

```typescript
function add(a: number, b: number): number {
  return a + b;
}
```

```cpp
int add(int a, int b) {
  return a + b;
}
```

### Arrow Functions

```typescript
const square = (x: number) => x * x;
```

```cpp
int square(int x) {
  return x * x;
}
```

### Default Parameters

```typescript
function greet(name: string = "World"): string {
  return "Hello, " + name;
}
```

```cpp
String greet(String name = "World") {
  return "Hello, " + name;
}
```

### Overloaded Functions

TypeScript overload **signatures** (declarations without a body) are filtered
out — only the implementation signature (the one with a body) is emitted:

```typescript
function process(value: number): number;
function process(value: string): string;
function process(value: number | string): number | string {
  return value;
}
```

```cpp
// Only the implementation signature is emitted;
// overload declarations without a body are skipped.
int process(int value) { return value; }
String process(String value) { return value; }
```

## Classes

### Basic Class

```typescript
class LED {
  private pin: number;
  
  constructor(pin: number) {
    this.pin = pin;
    pinMode(this.pin, OUTPUT);
  }
  
  on(): void {
    digitalWrite(this.pin, HIGH);
  }
  
  off(): void {
    digitalWrite(this.pin, LOW);
  }
}
```

```cpp
class LED {
private:
  int pin;
  
public:
  LED(int pin) : pin(pin) {
    pinMode(this->pin, OUTPUT);
  }
  
  void on() {
    digitalWrite(this->pin, HIGH);
  }
  
  void off() {
    digitalWrite(this->pin, LOW);
  }
};
```

### Inheritance

```typescript
class PWMPin extends LED {
  private channel: number;
  
  constructor(pin: number, channel: number) {
    super(pin);
    this.channel = channel;
  }
  
  pwm(percent: number): void {
    ledcWrite(this.channel, percent);
  }
}
```

```cpp
class PWMPin : public LED {
private:
  int channel;
  
public:
  PWMPin(int pin, int channel) : LED(pin), channel(channel) {}
  
  void pwm(int percent) {
    ledcWrite(this->channel, percent);
  }
};
```

When a derived class appears before its base class in source order, the
transpiler emits a forward declaration of the base class so the C++ compiler
can resolve the inheritance.

### Static Members

```typescript
class Math {
  static PI = 3.14159;
  
  static square(x: number): number {
    return x * x;
  }
}
```

```cpp
class Math {
public:
  static constexpr double PI = 3.14159;
  
  static int square(int x) {
    return x * x;
  }
};
```

#### Static Member Access

TypeScript dot-access on class or enum types is converted to C++ scope
resolution (`::`):

```typescript
const area = Math.PI * Math.square(4);
```

```cpp
const double area = Math::PI * Math::square(4);
```

## Enums

### Numeric Enums

```typescript
enum PinMode {
  INPUT,
  OUTPUT,
  INPUT_PULLUP
}
```

```cpp
enum class PinMode {
  INPUT,
  OUTPUT,
  INPUT_PULLUP
};
```

### Const Enums

```typescript
const enum Speed {
  SLOW = 100,
  MEDIUM = 500,
  FAST = 1000
}
```

```cpp
// Inlined at compile time
```

## Interfaces

Interfaces are compile-time only and erased during transpilation. The
`implements` clause is omitted from the generated C++ since C++ has no
interface concept — structural compatibility is validated at the TypeScript
level:

```typescript
interface IPin {
  read(): number;
  write(value: number): void;
}

class DigitalPin implements IPin {
  constructor(private pin: number) {}
  
  read(): number {
    return digitalRead(this.pin);
  }
  
  write(value: number): void {
    digitalWrite(this.pin, value);
  }
}
```

```cpp
// Interface erased, only class emitted
class DigitalPin {
private:
  int pin;
  
public:
  DigitalPin(int pin) : pin(pin) {}
  
  int read() {
    return digitalRead(this->pin);
  }
  
  void write(int value) {
    digitalWrite(this->pin, value);
  }
};
```

## Control Flow

### If/Else

```typescript
if (value > 100) {
  // ...
} else if (value > 50) {
  // ...
} else {
  // ...
}
```

```cpp
if (value > 100) {
  // ...
} else if (value > 50) {
  // ...
} else {
  // ...
}
```

### Switch

```typescript
switch (mode) {
  case PinMode.INPUT:
    // ...
    break;
  case PinMode.OUTPUT:
    // ...
    break;
  default:
    // ...
}
```

```cpp
switch (mode) {
  case PinMode::INPUT:
    // ...
    break;
  case PinMode::OUTPUT:
    // ...
    break;
  default:
    // ...
}
```

### While Loop

```typescript
while (running) {
  // ...
}
```

```cpp
while (running) {
  // ...
}
```

### For Loop

```typescript
for (let i = 0; i < 10; i++) {
  console.log(i);
}
```

```cpp
for (int i = 0; i < 10; i++) {
  console_log(i);
}
```

### For-Of Loop

```typescript
const values = [1, 2, 3, 4, 5];
for (const v of values) {
  console.log(v);
}
```

```cpp
int values[] = {1, 2, 3, 4, 5};
for (int v : values) {
  console_log(v);
}
```

## Expressions

### Arithmetic

| TypeScript | C++ |
|------------|-----|
| `a + b` | `a + b` |
| `a - b` | `a - b` |
| `a * b` | `a * b` |
| `a / b` | `a / b` |
| `a % b` | `a % b` |

### Comparison

| TypeScript | C++ |
|------------|-----|
| `a === b` | `a == b` |
| `a !== b` | `a != b` |
| `a > b` | `a > b` |
| `a < b` | `a < b` |
| `a >= b` | `a >= b` |
| `a <= b` | `a <= b` |

### Logical

| TypeScript | C++ |
|------------|-----|
| `a && b` | `a && b` |
| `a \|\| b` | `a \|\| b` |
| `!a` | `!a` |

### Bitwise

| TypeScript | C++ |
|------------|-----|
| `a & b` | `a & b` |
| `a \| b` | `a \| b` |
| `a ^ b` | `a ^ b` |
| `~a` | `~a` |
| `a << n` | `a << n` |
| `a >> n` | `a >> n` |

### Strings

#### String Concatenation

The `+` operator with string operands wraps the result in Arduino's `String()`
constructor to ensure proper C++ concatenation:

```typescript
const greeting = "Hello, " + name + "!";
```

```cpp
String greeting = String("Hello, ") + name + "!";
```

#### String `.length`

Accessing `.length` on a string-typed variable emits `strlen()`:

```typescript
function getMessageLength(msg: string): number {
  return msg.length;
}
```

```cpp
int getMessageLength(const char* msg) {
  return strlen(msg);
}
```

> **Note:** Array `.length` is handled separately and uses `sizeof(array) /
> sizeof(array[0])`.

## Console

Console output is polyfilled:

```typescript
console.log("Hello");
console.log("Value:", 42);
console.error("Error occurred");
```

```cpp
console_log("Hello");
console_log("Value: ", 42);
console_error("Error occurred");
```

## Identifier Safety

### C++ Keyword Escaping

TypeScript identifiers that collide with C++ reserved keywords are
automatically suffixed with `_` to avoid compilation errors:

```typescript
function setRegister(register: number, auto: number): void {
  // ...
}
```

```cpp
void setRegister(int register_, int auto_) {
  // ...
}
```

This applies to all declarations — variable names, function parameters, class
members, etc.

## Limitations

### Not Supported

- Dynamic `import()`
- `eval()`
- `Proxy`
- `Reflect`
- `Symbol`

### Limited Support

- `async`/`await`: lowered approximately through a cooperative runtime model
- `try`/`catch`/`throw`: validated per target; blocked on AVR and megaAVR
- `Promise`: partial runtime/polyfill behavior only
- `Map`/`Set`: type-level lowering exists, but runtime behavior is still limited by target and usage
- Template literals: lowered to concatenation and string helpers rather than native template semantics
- Generics: Type parameters erased, limited inference
- Closures: Captured variables have lifetime constraints
- Recursion: May cause stack overflow on embedded targets