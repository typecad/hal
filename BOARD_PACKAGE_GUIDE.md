# Board Package Development Guide

> **Audience**: This document is designed for LLM/AI agents to understand how to create and configure board packages for the TypeCode transpiler.

## Overview

Board packages are npm packages that define hardware-specific code generation for the TypeCode TypeScript-to-C++ transpiler. Each board package provides:

1. **TypeScript type definitions** for pins, peripherals, and board capabilities
2. **A code generation strategy** that controls how TypeScript is translated to C++
3. **Native implementations** that replace Arduino framework calls with direct register access

## Package Structure

```
packages/board-<vendor>-<model>/
├── package.json              # npm package configuration
├── tsconfig.json             # TypeScript configuration
└── src/
    ├── index.ts              # Entry point: exports BoardStrategy + BoardDefinition
    ├── strategy.ts           # PlatformStrategy implementation
    ├── pins.ts               # Pin constants and mappings
    ├── peripherals.ts        # I2C, SPI, Serial peripheral definitions
    ├── analog.ts             # ADC/PWM configuration
    ├── timing.ts             # delay/millis functions
    ├── interrupts.ts         # Interrupt handling
    └── board.ts              # Board namespace facade
```

## Core Concepts

### 1. PlatformStrategy Interface

The [`PlatformStrategy`](packages/cli/src/platform/platform-strategy.ts) interface defines all hooks for code generation. Key methods:

```typescript
interface PlatformStrategy {
  readonly id: string;  // Strategy identifier (e.g., "arduino", "generic")
  
  // === Code Generation Hooks ===
  forcedIncludes(program, ctx): string[];           // #include headers
  symbolAliases(program, ctx): Record<string, string>;  // TS name → C++ name
  shimLines(program, ctx): string[];                // Extra code after includes
  setupInitCode?(program, ctx): string[];           // Code at start of setup()
  
  // === Polyfill Control ===
  nativePolyfills?(): Set<string>;                  // Polyfills handled natively
  generateNativePolyfills?(program, ctx): RuntimePolyfillIR[];  // Native implementations
  
  // === File Shape ===
  sourceExtension(isEntryFile, isNpmPackage): string;  // "ino", "cpp", "c"
  entrypointFunctionName(): string;                     // "setup" or "main"
  requiresLoopFunction(): boolean;                      // Arduino needs loop()
  
  // === Type Mapping ===
  normalizeCppType(typeName: string): string;
  mapReturnType(functionName, returnType): string;
  
  // === Expression/Statement Rendering ===
  tryRenderCallStatement(callee, args, renderArg, boardConstants): string | undefined;
  tryRenderTypecodeCall(receiver, receiverKind, method, args, ...): string | undefined;
  transformConsoleCall(method, renderedArgs, forHeader): string;
  
  // === Reserved Names ===
  reservedNames(): ReadonlySet<string>;  // Names that conflict with platform
}
```

### 2. ArduinoStrategy Base Class

Most board packages should extend [`ArduinoStrategy`](packages/cli/src/platform/arduino-strategy.ts):

```typescript
import { ArduinoStrategy } from 'typecode/platform';

export class MyBoardStrategy extends ArduinoStrategy {
  override readonly id = "arduino";  // Keep "arduino" to use Arduino toolchain
  
  // Override specific methods as needed
  override forcedIncludes(program, ctx): string[] {
    return ['<avr/io.h>', '<util/delay.h>'];
  }
}
```

### 3. Strategy Registration

Board packages must export their strategy as `BoardStrategy`:

```typescript
// src/index.ts
import { registerPlatformStrategy } from 'typecode/platform/registry';
import { MyBoardStrategy } from './strategy';

// Export for CLI to load
export { MyBoardStrategy as BoardStrategy } from './strategy';

// Auto-register when imported
registerPlatformStrategy(new MyBoardStrategy());
```

## Code Generation Flow

```mermaid
flowchart TD
    A[TypeScript Source] --> B[Build IR]
    B --> C[Load Board Strategy]
    C --> D[Emit C++]
    D --> E{Strategy Method Called}
    
    E --> F[forcedIncludes]
    E --> G[shimLines]
    E --> H[nativePolyfills]
    E --> I[generateNativePolyfills]
    E --> J[setupInitCode]
    E --> K[tryRenderCallStatement]
    E --> L[transformConsoleCall]
    
    F --> M[Generated .ino/.cpp]
    G --> M
    H --> M
    I --> M
    J --> M
    K --> M
    L --> M
```

## Key Strategy Methods

### forcedIncludes()

Returns `#include` headers for the generated file:

```typescript
override forcedIncludes(_program?: any, _ctx?: any): string[] {
  return [
    '<avr/io.h>',        // AVR register definitions
    '<util/delay.h>',    // Delay functions
    '<avr/interrupt.h>', // Interrupt support
  ];
}
```

### shimLines()

Returns helper code emitted after includes. Use for native implementations:

```typescript
override shimLines(program?: any, _ctx?: any): string[] {
  return [
    '#ifndef F_CPU',
    '#define F_CPU 16000000UL  // 16 MHz clock frequency',
    '#endif',
    '',
    '// UART initialization (native AVR USART0)',
    'static inline void _uart_init(unsigned long baud) {',
    '  unsigned int ubrr = (F_CPU / 16 / baud - 1);',
    '  UBRR0H = (unsigned char)(ubrr >> 8);',
    '  UBRR0L = (unsigned char)ubrr;',
    '  UCSR0B = (1 << RXEN0) | (1 << TXEN0);',
    '  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);  // 8N1',
    '}',
  ];
}
```

### setupInitCode()

Returns code to insert at the beginning of `setup()`:

```typescript
setupInitCode(program?: any, _ctx?: any): string[] {
  return [
    '_uart_init(9600)',  // Initialize UART for serial output
    '_init_adc()',       // Initialize ADC for analog reads
  ];
}
```

**Important**: Return statements WITHOUT trailing semicolons. The emitter handles semicolon insertion.

### nativePolyfills()

Returns set of polyfill IDs that this strategy handles natively:

```typescript
nativePolyfills(): Set<string> {
  return new Set(['console']);  // We provide native console.log
}
```

### generateNativePolyfills()

Returns native polyfill implementations:

```typescript
generateNativePolyfills(program?: any, _ctx?: any): RuntimePolyfillIR[] {
  return [{
    id: 'console',
    kind: 'polyfill',
    domain: 'arduino',
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [
      'inline void console_log(const char* msg) { _uart_println(msg); }',
      'inline void console_log(int val) { _uart_println_long(val); }',
    ],
    shimMacros: [
      '#define console_log(...) console_log(__VA_ARGS__)',
    ],
    dependencies: [],
  }];
}
```

### tryRenderCallStatement()

Transforms function calls to native implementations:

```typescript
tryRenderCallStatement(
  callee: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  boardConstants?: BoardConstants,
): string | undefined {
  // Transform digitalWrite(pin, value) to native register access
  if (callee === 'digitalWrite') {
    const pin = parseInt(renderArg(args[0]));
    const value = renderArg(args[1]);
    return this.renderNativeDigitalWrite(pin, value);
  }
  
  return undefined;  // Fall back to default rendering
}
```

### transformConsoleCall()

Transforms console.* calls:

```typescript
transformConsoleCall(
  method: string,
  renderedArgs: string,
  forHeader: boolean,
): string {
  if (method === 'console.log') {
    return forHeader 
      ? `console_log(${renderedArgs})`
      : `console_log(${renderedArgs});`;
  }
  // ... handle error/warn
}
```

## Native Implementation Pattern

For native board packages (no Arduino framework), follow this pattern:

### 1. Define Native Helpers in shimLines()

```typescript
override shimLines(program?: any, _ctx?: any): string[] {
  const lines: string[] = [];
  
  // F_CPU must be defined before util/delay.h
  lines.push('#ifndef F_CPU');
  lines.push('#define F_CPU 16000000UL');
  lines.push('#endif');
  lines.push('#include <util/delay.h>');
  lines.push('');
  
  // Native UART functions
  lines.push('// UART initialization (native AVR USART0)');
  lines.push('static inline void _uart_init(unsigned long baud) { ... }');
  lines.push('static inline void _uart_write(unsigned char data) { ... }');
  lines.push('static inline void _uart_print(const char* str) { ... }');
  
  return lines;
}
```

### 2. Provide Native Polyfills

```typescript
nativePolyfills(): Set<string> {
  return new Set(['console']);  // Replace console polyfill
}

generateNativePolyfills(program?: any, _ctx?: any): RuntimePolyfillIR[] {
  return [{
    id: 'console',
    kind: 'polyfill',
    domain: 'arduino',
    // ... native console implementation using _uart_* functions
  }];
}
```

### 3. Initialize Hardware in setupInitCode()

```typescript
setupInitCode(program?: any, _ctx?: any): string[] {
  return [
    '_uart_init(9600)',   // Initialize UART for console
    '_init_adc()',        // Initialize ADC
  ];
}
```

## Pin Mapping

Define pin constants in `pins.ts`:

```typescript
// Pin mappings for ATmega328P
export const PIN_MAP = {
  // Digital pins
  0:  { port: 'D', bit: 0 },
  1:  { port: 'D', bit: 1 },
  // ...
  13: { port: 'B', bit: 5 },  // LED
  
  // Analog pins
  A0: { port: 'C', bit: 0, adc: 0 },
  // ...
};

// Helper functions
export function getPortReg(pin: number): string | undefined {
  const mapping = PIN_MAP[pin];
  if (!mapping) return undefined;
  return `PORT${mapping.port}`;
}

export function getDDRReg(pin: number): string | undefined {
  const mapping = PIN_MAP[pin];
  if (!mapping) return undefined;
  return `DDR${mapping.port}`;
}

export function getPinMask(pin: number): number | undefined {
  const mapping = PIN_MAP[pin];
  if (!mapping) return undefined;
  return 1 << mapping.bit;
}
```

## Board Definition

Export a `BoardDefinition` in `index.ts`:

```typescript
import type { BoardDefinition } from '@typecode/core';

export const Board: BoardDefinition = {
  name: 'ATmega328P Native',
  architecture: 'avr',
  mcu: 'atmega328p',
  clockSpeed: 16000000,
  
  pins: {
    digital: [0, 1, 2, /* ... */ 13],
    analog: ['A0', 'A1', /* ... */ 'A5'],
    pwm: [3, 5, 6, 9, 10, 11],
  },
  
  capabilities: {
    gpio: true,
    adc: true,
    pwm: true,
    uart: true,
    i2c: true,
    spi: true,
  },
};
```

## Configuration

Users configure the board in `typecode.config.ts`:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-native-atmega328p',
  fqbn: 'arduino:avr:uno',
  output: {
    framework: 'arduino',
    outDir: './out',
  },
};

export default config;
```

## Testing

Build and test the board package:

```bash
# Build the board package
cd packages/board-native-atmega328p
npm run build

# Test with an example
cd ../..
npx typecode example.ts --compile
```

## Complete Example: Native ATmega328P

Reference implementation: [`packages/board-native-atmega328p/`](packages/board-native-atmega328p/)

Key files:
- [`src/strategy.ts`](packages/board-native-atmega328p/src/strategy.ts) - Code generation strategy
- [`src/pins.ts`](packages/board-native-atmega328p/src/pins.ts) - Pin mappings
- [`src/analog.ts`](packages/board-native-atmega328p/src/analog.ts) - Native ADC/PWM
- [`src/uart.ts`](packages/board-native-atmega328p/src/uart.ts) - Native UART

## Troubleshooting

### Strategy Not Loading

Ensure the package:
1. Exports `BoardStrategy` class
2. Calls `registerPlatformStrategy()` in `index.ts`
3. Is listed in `typecode.config.ts` → `board` field

### Polyfills Not Replaced

1. Return the polyfill ID from `nativePolyfills()`
2. Provide implementation in `generateNativePolyfills()`
3. Ensure `shimLines()` includes required helper functions

### setupInitCode Not Emitted

1. Return an array of strings (not empty array)
2. Each string should be a valid C++ statement (without trailing semicolon)
3. The emitter adds semicolons automatically

### Compilation Errors

1. Check `forcedIncludes()` returns required headers
2. Verify `shimLines()` defines all native functions
3. Ensure F_CPU is defined before including `<util/delay.h>`

## Transpiler Compatibility Guidelines

Board packages must follow specific patterns to avoid transpiler warnings and ensure correct code generation. This section documents the compile-time constructs that the transpiler recognizes.

### Recognized Compile-Time Types

The transpiler recognizes certain TypeScript types as **compile-time-only** constructs that don't need C++ emission. Using these types prevents `TS2CPP_UNMAPPED_TYPE` warnings:

#### Pin Interface Types
These define pin capabilities and are erased at compile time:

```typescript
// All these types are recognized as compile-time-only
type PinInterfaces =
  | 'IPin'           // Base pin interface
  | 'IDigitalPin'    // Digital read/write
  | 'IDigitalInput'  // Digital input only
  | 'IDigitalOutput' // Digital output only
  | 'IPWMPin'        // PWM output
  | 'IAnalogInput'   // ADC input
  | 'IAnalogOutput'  // DAC output
  | 'IInterruptPin'  // Interrupt support
  | 'ITouchPin'      // Touch sensing (ESP32)
  | 'IADCPin'        // ADC capability
  | 'IDACPin';       // DAC capability
```

#### Value Types
```typescript
// Board constant value types
type ValueTypes =
  | 'PinNumber'      // Pin number alias
  | 'DigitalValue'   // HIGH/LOW
  | 'AnalogValue'    // 0-1023 or 0-4095
  | 'PinMode'        // INPUT/OUTPUT/INPUT_PULLUP
  | 'InterruptMode'; // CHANGE/FALLING/RISING
```

#### Bus/Peripheral Interfaces
```typescript
// Peripheral bus interfaces
type BusInterfaces =
  | 'II2CBus'        // I2C bus
  | 'ISPIBus'        // SPI bus
  | 'ISerialPort'    // Serial port
  | 'IUART'          // UART interface
  | 'I2CConfig'      // I2C configuration
  | 'SPIConfig'      // SPI configuration
  | 'UARTConfig';    // UART configuration
```

#### Strategy Types
```typescript
// Platform strategy types (compile-time only)
type StrategyTypes =
  | 'NativeStrategy'      // Native AVR/ESP implementation
  | 'ArduinoStrategy'     // Arduino framework wrapper
  | 'BoardStrategy'       // Strategy union type
  | 'RuntimePolyfillIR'   // Polyfill IR
  | 'PeripheralUsage';    // Peripheral usage analysis
```

### Intersection Types for Multi-Capability Pins

Pins often have multiple capabilities. Use intersection types to express this:

```typescript
// Pin 2 supports both digital I/O and external interrupts
export const D2: IDigitalPin & IInterruptPin = createDigitalPin(2, 2);

// Pin 3 supports digital I/O, PWM, and interrupts
export const D3: IDigitalPin & IPWMPin & IInterruptPin = createPWMPin(3, 3);

// A0 supports analog input and digital I/O
export const A0: IAnalogInput & IDigitalPin = createAnalogPin(14, 0);
```

The transpiler recognizes intersection types if all component types are known compile-time types.

### Pin Factory Pattern

Use pin factory functions for constant-folding. The transpiler folds these to simple pin numbers at compile time:

```typescript
// These functions are constant-folded to just the first argument (pin number)
createDigitalPin(pinNumber, gpioNumber)  // → pinNumber
createPWMPin(pinNumber, gpioNumber)      // → pinNumber
createAnalogPin(pinNumber, adcChannel)   // → pinNumber
createInterruptPin(pinNumber, irqNumber) // → pinNumber
pinNumber(expression)                     // → evaluated expression
```

**Example:**
```typescript
// In pins.ts
export const LED: IDigitalPin = createDigitalPin(13, 5);

// Transpiles to C++ that references pin 13 directly
// The IDigitalPin type is erased, and createDigitalPin is folded to 13
```

### Peripheral Stub Pattern

Peripheral definitions (I2C, SPI, Serial) use object literals with type assertions. The transpiler handles these as compile-time constructs:

```typescript
// In peripherals.ts
import type { II2CBus, ISPIBus, ISerialPort } from '@typecode/core';

// Object literal with type assertion - recognized as compile-time stub
export const I2C0: II2CBus = {
  initialize: (config?: I2CConfig) => { /* stub */ },
  write: (address: I2CAddress, data: Uint8Array) => { /* stub */ },
  read: (address: I2CAddress, length: number) => new Uint8Array(0),
};

// Method stubs in object literals are also handled
export const SPI0: ISPIBus = {
  initialize(config?: SPIConfig) { /* stub */ },
  transfer(data: Uint8Array) { return data; },
  write(data: Uint8Array) { /* stub */ },
};

// Serial port with getters/setters
export const Serial: ISerialPort = {
  get baudRate() { return 9600; },
  set baudRate(value: number) { /* stub */ },
  write(data: string | Uint8Array) { /* stub */ },
  read() { return ''; },
};
```

The transpiler recognizes:
- Property assignments with function/arrow initializers
- Method declarations (`methodName() { }`)
- Getter/setter accessors

### Board Constant Naming Convention

Pin constants should follow these naming patterns for automatic recognition:

```typescript
// Digital pins: D0, D1, D2, ..., D53
export const D0 = createDigitalPin(0, 0);
export const D13 = createDigitalPin(13, 5);  // LED on Arduino Uno

// Analog pins: A0, A1, A2, ..., A15
export const A0 = createAnalogPin(14, 0);
export const A5 = createAnalogPin(19, 5);

// Special pins: LED, TX, RX, TX0, RX0, TX1, RX1, etc.
export const LED = D13;
export const TX = D1;
export const RX = D0;
```

### Type Annotation Best Practices

**DO:**
```typescript
// Use recognized interface types
export const D2: IDigitalPin & IInterruptPin = createDigitalPin(2, 2);

// Use type assertions for peripheral stubs
export const I2C0: II2CBus = { /* ... */ };

// Use 'auto' for variables that need runtime type inference
let counter: auto = 0;  // Emits as 'int counter = 0;'
```

**DON'T:**
```typescript
// Don't use unknown interface types without registering them
export const D2: IMyCustomPinInterface = createDigitalPin(2, 2);  // Warning!

// Don't create peripheral objects without type assertions
export const I2C0 = { initialize() { } };  // Warning!

// Don't use complex generic types that aren't recognized
export const pins: Map<string, IDigitalPin> = new Map();  // May warn
```

### Handling UNMAPPED_TYPE Warnings

If you see `TS2CPP_UNMAPPED_TYPE` warnings:

1. **Check if the type is a known compile-time type** - See the lists above
2. **Add a type assertion** - Use `as KnownType` to guide the transpiler
3. **Use 'auto' explicitly** - For variables where C++ type inference is desired
4. **Register custom types** - For board-specific types, extend the transpiler's type map

### Handling RAW_EXPR Warnings

If you see `TS2CPP_RAW_EXPR` warnings:

1. **Use pin factory functions** - `createDigitalPin()` instead of object literals for pins
2. **Add type assertions to object literals** - `as II2CBus`, `as ISPIBus`, etc.
3. **Use method syntax in object literals** - `method() { }` instead of `method: () => { }`
4. **Check for unsupported expressions** - Some TypeScript expressions have no C++ equivalent

### Example: Complete Pin Definition File

```typescript
// pins.ts - Complete example
import type { 
  IDigitalPin, IDigitalInput, IDigitalOutput,
  IPWMPin, IAnalogInput, IInterruptPin 
} from '@typecode/core';
import { createDigitalPin, createPWMPin, createAnalogPin } from './factory';

// Digital-only pins
export const D0: IDigitalPin = createDigitalPin(0, 0);
export const D1: IDigitalPin = createDigitalPin(1, 1);
export const D2: IDigitalPin & IInterruptPin = createDigitalPin(2, 2);

// PWM-capable pins
export const D3: IDigitalPin & IPWMPin & IInterruptPin = createPWMPin(3, 3);
export const D5: IDigitalPin & IPWMPin = createPWMPin(5, 5);
export const D6: IDigitalPin & IPWMPin = createPWMPin(6, 6);
export const D9: IDigitalPin & IPWMPin = createPWMPin(9, 9);
export const D10: IDigitalPin & IPWMPin = createPWMPin(10, 10);
export const D11: IDigitalPin & IPWMPin = createPWMPin(11, 11);

// Analog input pins (also digital-capable)
export const A0: IAnalogInput & IDigitalPin = createAnalogPin(14, 0);
export const A1: IAnalogInput & IDigitalPin = createAnalogPin(15, 1);
export const A2: IAnalogInput & IDigitalPin = createAnalogPin(16, 2);
export const A3: IAnalogInput & IDigitalPin = createAnalogPin(17, 3);
export const A4: IAnalogInput & IDigitalPin = createAnalogPin(18, 4);
export const A5: IAnalogInput & IDigitalPin = createAnalogPin(19, 5);

// Special pins
export const LED: IDigitalPin = createDigitalPin(13, 5);
export const TX: IDigitalPin = createDigitalPin(1, 1);
export const RX: IDigitalPin = createDigitalPin(0, 0);
```

### Summary

Following these patterns ensures:
- Clean transpilation without warnings
- Correct constant-folding of pin numbers
- Proper type erasure for compile-time constructs
- Generated C++ code that compiles without errors
