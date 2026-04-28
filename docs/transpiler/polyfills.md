# Polyfills

The TypeHAL polyfill system provides runtime implementations for TypeScript features not natively available in C++.

## Overview

Polyfills bridge the gap between TypeScript and embedded C++:

```
TypeScript Feature → Polyfill → C++ Implementation
```

## Built-in Polyfills

### Console

```typescript
// TypeScript
console.log("Hello");
console.error("Error");
```

```cpp
// Polyfilled C++
void console_log(const char* msg);
void console_error(const char* msg);
```

### Timing

```typescript
// TypeScript
delay(1000);
const ms = millis();
const us = micros();
```

```cpp
// Mapped to Arduino
delay(1000);
unsigned long ms = millis();
unsigned long us = micros();
```

### Math

```typescript
// TypeScript
Math.abs(-5);
Math.min(1, 2);
Math.max(1, 2);
Math.floor(3.7);
Math.ceil(3.2);
Math.round(3.5);
```

```cpp
// Mapped to C++ std/Arduino
abs(-5);
min(1, 2);
max(1, 2);
floor(3.7);
ceil(3.2);
round(3.5);
```

### Array Methods

```typescript
// TypeScript
const arr = [1, 2, 3];
arr.push(4);
arr.length;
```

```cpp
// C++ (limited support)
int arr[] = {1, 2, 3};
// Array operations are limited
```

## Polyfill Registry

Polyfills are registered in the polyfill registry:

```typescript
interface PolyfillRegistry {
  register(polyfill: RuntimePolyfillIR): void;
  get(id: string): RuntimePolyfillIR | null;
  getAll(): RuntimePolyfillIR[];
}
```

### RuntimePolyfillIR

```typescript
interface RuntimePolyfillIR {
  id: string;                    // Unique identifier
  kind: 'polyfill' | 'shim';     // Type of polyfill
  domain: 'arduino' | 'generic'; // Target domain
  requiredIncludes: string[];    // Required #include headers
  forwardDeclarations: string[]; // Forward declarations
  helperStructs: string[];       // Struct definitions
  helperFunctions: string[];     // Function implementations
  shimMacros: string[];          // #define macros
  dependencies: string[];        // Other polyfill dependencies
}
```

## Platform-Specific Polyfills

Platforms can override default polyfills:

### Arduino Platform

```typescript
// Default console polyfill for Arduino
const consolePolyfill: RuntimePolyfillIR = {
  id: 'console',
  kind: 'polyfill',
  domain: 'arduino',
  requiredIncludes: ['<Arduino.h>'],
  helperFunctions: [
    'void console_log(const char* msg) { Serial.println(msg); }',
    'void console_error(const char* msg) { Serial.println(msg); }',
  ],
};
```

### Native AVR Platform

```typescript
// Native UART console for AVR
const nativeConsolePolyfill: RuntimePolyfillIR = {
  id: 'console',
  kind: 'polyfill',
  domain: 'arduino',
  requiredIncludes: ['<avr/io.h>'],
  helperFunctions: [
    'static void _uart_init(unsigned long baud) { /* ... */ }',
    'static void _uart_println(const char* msg) { /* ... */ }',
    'void console_log(const char* msg) { _uart_println(msg); }',
  ],
};
```

## Custom Polyfills

### Creating a Polyfill

```typescript
// In a platform strategy
override generateNativePolyfills(
  program: ProgramIR,
  ctx: EmitContext
): RuntimePolyfillIR[] {
  return [
    {
      id: 'custom-helpers',
      kind: 'polyfill',
      domain: 'arduino',
      helperFunctions: [
        'int clamp(int value, int min, int max) {',
        '  if (value < min) return min;',
        '  if (value > max) return max;',
        '  return value;',
        '}',
      ],
    },
  ];
}
```

### Marking Polyfills as Native

```typescript
override nativePolyfills(): Set<string> {
  return new Set(['console', 'timing']);
}
```

When a polyfill is marked as native, the default implementation is suppressed and the platform provides its own.

## Polyfill Emission

### Emission Order

Polyfills are emitted in dependency order:

```
1. Required includes
2. Forward declarations
3. Helper structs
4. Helper functions
5. Shim macros
```

### In Generated Code

```cpp
// ===== Polyfill: console =====
#include <Arduino.h>

void console_log(const char* msg) {
  Serial.println(msg);
}

void console_error(const char* msg) {
  Serial.println(msg);
}
// ===== End Polyfill =====
```

## Shim Lines

Shim lines are helper code emitted after includes:

```typescript
// In platform strategy
override shimLines(): string[] {
  return [
    '#ifndef F_CPU',
    '#define F_CPU 16000000UL',
    '#endif',
    '',
    '// Helper for pin operations',
    'static inline void _setPin(int pin, int value) {',
    '  digitalWrite(pin, value);',
    '}',
  ];
}
```

Generated output:

```cpp
#include <Arduino.h>

#ifndef F_CPU
#define F_CPU 16000000UL
#endif

// Helper for pin operations
static inline void _setPin(int pin, int value) {
  digitalWrite(pin, value);
}
```

## Polyfill Dependencies

Polyfills can depend on other polyfills:

```typescript
const i2cPolyfill: RuntimePolyfillIR = {
  id: 'i2c',
  kind: 'polyfill',
  domain: 'arduino',
  requiredIncludes: ['<Wire.h>'],
  dependencies: ['console'],  // Requires console for debug output
  helperFunctions: [
    'void i2c_init() { Wire.begin(); }',
    'void i2c_write(byte addr, byte* data, int len) {',
    '  Wire.beginTransmission(addr);',
    '  Wire.write(data, len);',
    '  Wire.endTransmission();',
    '}',
  ],
};
```

## Best Practices

### 1. Use Static Inline

For small helper functions:

```cpp
static inline int clamp(int v, int lo, int hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
```

### 2. Avoid Dynamic Allocation

```cpp
// Bad: Uses heap
char* buffer = malloc(64);

// Good: Uses stack
char buffer[64];
```

### 3. Minimize Dependencies

Only include what's necessary:

```cpp
// Bad: Heavy include
#include <String.h>

// Good: Lightweight
#include <string.h>
```

### 4. Use Platform Abstractions

```cpp
// Portable
delay(ms);

// Platform-specific (use only in native strategies)
_delay_ms(ms);