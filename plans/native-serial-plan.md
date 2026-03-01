# Native Serial/UART Implementation Plan for board-native-atmega328p

## Overview

Add native UART/Serial support to the `board-native-atmega328p` package using direct AVR register access instead of the Arduino `Serial` class.

## Reference

Based on LANGUAGE_REFERENCE.md console output section:
- `console.log(msg)` → `Serial.println(msg)`
- `console.error(msg)` → `Serial.print("[ERROR]"); Serial.println(msg)`
- `console.warn(msg)` → `Serial.print("[WARN]"); Serial.println(msg)`

And Serial peripheral interface:
```typescript
Serial.initialize({ baudRate: 9600 });
Serial.println("Hello, World!");
Serial.print("Value: ");
Serial.println(42);
if (Serial.available() > 0) {
  const data = Serial.read();
}
```

## ATmega328P UART Registers

| Register | Purpose |
|----------|---------|
| `UDR0` | Data Register - read/write data |
| `UCSR0A` | Status Register A - RXC0, TXC0, UDRE0 flags |
| `UCSR0B` | Status Register B - RXEN0, TXEN0, RXCIE0, TXCIE0 enables |
| `UCSR0C` | Status Register C - UMSEL0, UPM0, USBS0, UCSZ0 bits |
| `UBRR0H` | Baud Rate Register High |
| `UBRR0L` | Baud Rate Register Low |

## Files to Create/Modify

### 1. Create `src/uart.ts` - Native UART Functions

```typescript
// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Native UART/Serial functions
//
// Direct AVR register access for UART communication.
// ---------------------------------------------------------------------------

/** Initialize UART with specified baud rate. */
export declare function uart_init(baudRate: number): void;

/** Check if data is available to read. */
export declare function uart_available(): number;

/** Read a single byte. */
export declare function uart_read(): number;

/** Write a single byte. */
export declare function uart_write(byte: number): void;

/** Write a string. */
export declare function uart_print(text: string): void;

/** Write a string with newline. */
export declare function uart_println(text: string): void;

/** Write a number. */
export declare function uart_print_number(value: number): void;

/** Write a number with newline. */
export declare function uart_println_number(value: number): void;
```

### 2. Create `src/peripherals.ts` - Serial Peripheral Instance

```typescript
// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Peripheral instances
// ---------------------------------------------------------------------------

import type { ISerialPort, UARTConfig } from '@typecode/core';

/** Native UART 0 using direct register access. */
export const Serial: ISerialPort = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,

  initialize(_config?: UARTConfig) { /* native: uart_init */ },
  deinitialize() { /* native: disable UART */ },

  write(_data: Uint8Array): number { return 0; },
  writeString(_text: string): number { return 0; },
  writeLine(_text: string): number { return 0; },

  read(_length?: number): Uint8Array { return new Uint8Array(0); },
  readString(_length?: number): string { return ''; },
  readLine(_timeout?: number): string { return ''; },

  available(): number { return 0; },
  peek(): number { return -1; },
  flush() {},

  setBaudRate(_baud: number) {},
  getStatus() { return { txComplete: true, rxReady: false }; },
} as ISerialPort;
```

### 3. Update `src/strategy.ts` - Add UART Code Generation

Add to shimLines:
```typescript
// UART initialization function
static inline void _uart_init(unsigned long baud) {
  unsigned int ubrr = (F_CPU / 16 / baud - 1);
  UBRR0H = (unsigned char)(ubrr >> 8);
  UBRR0L = (unsigned char)ubrr;
  UCSR0B = (1 << RXEN0) | (1 << TXEN0);
  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);  // 8N1
}

// Check if data available
static inline int _uart_available() {
  return (UCSR0A & (1 << RXC0)) ? 1 : 0;
}

// Read byte
static inline int _uart_read() {
  while (!(UCSR0A & (1 << RXC0)));
  return UDR0;
}

// Write byte
static inline void _uart_write(unsigned char data) {
  while (!(UCSR0A & (1 << UDRE0)));
  UDR0 = data;
}

// Print string
static inline void _uart_print(const char* str) {
  while (*str) _uart_write(*str++);
}

// Print string with newline
static inline void _uart_println(const char* str) {
  _uart_print(str);
  _uart_write('\r');
  _uart_write('\n');
}

// Print number
static inline void _uart_print_long(long num) {
  char buf[12];
  ltoa(num, buf, 10);
  _uart_print(buf);
}

// Print number with newline
static inline void _uart_println_long(long num) {
  _uart_print_long(num);
  _uart_write('\r');
  _uart_write('\n');
}
```

Add to tryRenderTypecodeCall:
```typescript
// Serial.print(), Serial.println()
if (receiver === 'Serial') {
  if (method === 'print') {
    const arg = renderArg(args[0]);
    // Detect if arg is string or number
    return `_uart_print(${arg})`;
  }
  if (method === 'println') {
    const arg = args.length > 0 ? renderArg(args[0]) : '""';
    return `_uart_println(${arg})`;
  }
  if (method === 'available') {
    return '_uart_available()';
  }
  if (method === 'read') {
    return '_uart_read()';
  }
  if (method === 'write') {
    return `_uart_write(${renderArg(args[0])})`;
  }
  if (method === 'initialize') {
    const baud = args[0]?.kind === 'object' ? 
      extractBaudFromConfig(args[0]) : '9600';
    return `_uart_init(${baud})`;
  }
}
```

Add to transformConsoleCall:
```typescript
transformConsoleCall(method, renderedArgs, forHeader) {
  switch (method) {
    case 'log':
      return `_uart_println(${renderedArgs})`;
    case 'error':
      return `_uart_print("[ERROR]"); _uart_println(${renderedArgs})`;
    case 'warn':
      return `_uart_print("[WARN]"); _uart_println(${renderedArgs})`;
  }
}
```

### 4. Update `src/index.ts` - Add Exports

```typescript
// Re-export Serial peripheral
export { Serial } from './peripherals';

// Re-export native UART functions
export * from './uart';
```

### 5. Update peripheral usage tracking

Add to `PeripheralUsageIR`:
```typescript
/** UART/Serial is used */
uart: boolean;
```

Add to `analyzeTypecodeCall` in peripheral-usage.ts:
```typescript
if (receiver === 'Serial') {
  usage.uart = true;
}
```

## Baud Rate Table (16MHz clock)

| Baud Rate | UBRR Value | Error |
|-----------|------------|-------|
| 9600      | 103        | 0.2%  |
| 19200     | 51         | 0.2%  |
| 38400     | 25         | 0.2%  |
| 57600     | 16         | 2.1%  |
| 115200    | 8          | 3.7%  |

## Example Usage

```typescript
import { Serial } from '@typecode/board-native-atmega328p/peripherals';
import { A0 } from '@typecode/board-native-atmega328p/pins';

Serial.initialize({ baudRate: 9600 });

while (true) {
  const value = A0.read();
  Serial.print("ADC: ");
  Serial.println(value);
  delay(1000);
}
```

## Generated C++ Code

```cpp
// Shim functions
static inline void _uart_init(unsigned long baud) {
  unsigned int ubrr = (F_CPU / 16 / baud - 1);
  UBRR0H = (unsigned char)(ubrr >> 8);
  UBRR0L = (unsigned char)ubrr;
  UCSR0B = (1 << RXEN0) | (1 << TXEN0);
  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
}

static inline void _uart_print(const char* str) {
  while (*str) {
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = *str++;
  }
}

static inline void _uart_println(const char* str) {
  _uart_print(str);
  while (!(UCSR0A & (1 << UDRE0)));
  UDR0 = '\r';
  while (!(UCSR0A & (1 << UDRE0)));
  UDR0 = '\n';
}

static inline void _uart_print_long(long num) {
  char buf[12];
  ltoa(num, buf, 10);
  _uart_print(buf);
}

void setup() {
  _uart_init(9600);
  
  while (true) {
    int value = ({ ADMUX = (1 << REFS0) | 0; ADCSRA |= (1 << ADSC); 
                   while (ADCSRA & (1 << ADSC)); ADC; });
    _uart_print("ADC: ");
    _uart_println_long(value);
    _native_delay_ms(1000);
  }
}

void loop() {}
```

## Implementation Order

1. ✅ Analyze requirements and existing code
2. Create `src/uart.ts` with native UART function declarations
3. Create `src/peripherals.ts` with Serial stub object
4. Update `src/strategy.ts`:
   - Add UART shim functions
   - Add Serial method rendering
   - Update console.log/error/warn transformation
5. Update `src/index.ts` exports
6. Update peripheral usage tracking
7. Create example file and test
