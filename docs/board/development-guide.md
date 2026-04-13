# Board Package Development Guide

> **Audience**: This document is designed for LLM/AI agents to understand how to create and configure board packages for the TypeCode transpiler.

## Overview

TypeCode uses a **two-tier package organization** that separates architecture concerns from board specifics:

### Architecture Packages (`@typecode/arch-*`)
Define how code is generated for a CPU family (AVR, ARM, ESP32, etc.):
- Register definitions and memory layouts
- Code generation strategy (native vs. Arduino framework)
- Peripheral access patterns
- Architecture-specific optimizations

### Board Packages (`@typecode/board-*`)
Define a specific board's capabilities and pin mappings:
- Pin names and numbers (D13, A0, LED, etc.)
- Which peripherals are available and their pins
- Board constants (clock speed, flash size, etc.)
- Optional board-specific customizations

## Package Organization

### Recommended Structure

```
packages/
├── arch-avr-native/           # Architecture: Native AVR register access
│   ├── package.json
│   └── src/
│       ├── registers.ts       # AVR register definitions (PORTB, DDRB, etc.)
│       ├── strategy.ts        # NativeAVRStrategy code generation
│       └── index.ts
│
├── arch-avr-arduino/          # Architecture: Arduino framework for AVR
│   ├── package.json
│   └── src/
│       ├── strategy.ts        # ArduinoStrategy (standard Arduino calls)
│       └── index.ts
│
├── board-arduino-uno/         # Board: Arduino Uno (uses arch-avr-native or arch-avr-arduino)
│   ├── package.json
│   └── src/
│       ├── pins.ts            # Pin constants: D0-D13, A0-A5, LED
│       ├── board.ts           # Board definition
│       └── index.ts           # Re-exports architecture + board pins
│
└── board-arduino-mega/        # Board: Arduino Mega (different pin mappings)
    ├── package.json
    └── src/
        ├── pins.ts            # Pin constants: D0-D53, A0-A15
        ├── board.ts           # Board definition
        └── index.ts
```

### When to Create an Architecture Package

Create a new **architecture package** when:
- Supporting a new CPU family (e.g., ARM Cortex-M, ESP32-C3)
- Providing a different code generation approach (e.g., native registers vs. Arduino)
- The same register mappings apply to multiple boards

### When to Create a Board Package

Create a new **board package** when:
- Adding support for a specific hardware board
- Pin mappings differ from existing boards
- Board-specific constants are needed (LED pin, crystal frequency, etc.)

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

```
TypeScript Source
       │
       ▼
Build IR
       │
       ▼
Load Board Strategy
       │
       ▼
Emit C++
       │
       ▼
┌─────────────────────────────────┐
│ Strategy Method Called          │
├─────────────────────────────────┤
│ forcedIncludes                  │
│ shimLines                       │
│ nativePolyfills                 │
│ generateNativePolyfills         │
│ setupInitCode                   │
│ tryRenderCallStatement          │
│ transformConsoleCall            │
└─────────────────────────────────┘
       │
       ▼
Generated .ino/.cpp
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
    unsafe: ['D0', 'D1'],  // Pins that generate warnings when used
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

### Marking Pins as Unsafe

Some pins have special behaviors that make them "unsafe" for general use. Common examples:
- **UART TX/RX pins** - Using these interferes with serial communication
- **Boot strapping pins** - Pins that affect boot mode when held in certain states
- **JTAG/Debug pins** - Reserved for debugging

Add pins to the `unsafe` array in the `pins` object:

```typescript
pins: {
  digital: [0, 1, 2, /* ... */ 13],
  unsafe: ['D0', 'D1'],  // D0 (RX) and D1 (TX) interfere with serial
}
```

When a user writes code that uses an unsafe pin, the transpiler generates a warning:

```
warning [unsafe-pin-usage]: Pin 'D0' is marked as unsafe. Use with caution -
this pin may have special boot behavior or conflict with system functions.
```

The code still compiles, but the warning alerts users to potential issues.

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

## Architecture vs Board Package Relationship

### Architecture Package Responsibilities
- CPU register definitions (e.g., ATmega328P register map)
- Code generation strategy (native registers vs. Arduino framework)
- Native helper functions (UART, ADC, PWM initialization)
- Platform-specific polyfills (console.log via UART, etc.)

### Board Package Responsibilities
- Pin name mappings (D13 → pin 13, LED → D13, etc.)
- Board-specific constants (clock speed, LED pin)
- Peripheral availability (which pins support I2C, SPI, etc.)
- Re-export architecture strategy as `BoardStrategy`

### How They Work Together

```typescript
// Board package (board-arduino-uno) re-exports architecture strategy
// src/index.ts
export { PlatformStrategy as BoardStrategy } from '@typecode/arch-avr-native';

// Board package provides pin mappings
export const LED: IDigitalPin = createDigitalPin(13, 5);
export const D13: IDigitalPin = LED;

// User code imports from board package
import { LED, BoardStrategy } from '@typecode/board-arduino-uno';
LED.high();  // Architecture strategy generates: PORTB |= (1 << PB5)
```

## Complete Examples

### Architecture Package: arch-avr-native

Reference implementation: [`packages/arch-avr-native/`](packages/arch-avr-native/)

Key files:
- [`src/strategy.ts`](packages/arch-avr-native/src/strategy.ts) - Native AVR code generation strategy
- [`src/registers.ts`](packages/arch-avr-native/src/registers.ts) - ATmega328P register definitions
- [`src/index.ts`](packages/arch-avr-native/src/index.ts) - Public exports

See [Architecture Development Guide](../architecture/development-guide.md) for detailed architecture package documentation.

### Board Package: board-arduino-uno

Reference implementation: [`packages/board-arduino-uno/`](packages/board-arduino-uno/)

Key files:
- [`src/index.ts`](packages/board-arduino-uno/src/index.ts) - Re-exports architecture + board pins
- [`src/pins.ts`](packages/board-arduino-uno/src/pins.ts) - Pin mappings (D0-D13, A0-A5, LED)
- [`src/board.ts`](packages/board-arduino-uno/src/board.ts) - Board definition

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

// A0 supports both digital I/O AND analog input (IMPORTANT: use this pattern!)
export const A0: IDigitalPin & IAnalogInput = createAnalogPin(14, 14);
```

**Important:** Analog pins (A0-A5 on Arduino Uno) are also digital-capable. Always type them as `IDigitalPin & IAnalogInput` so users can use `A0.inputPullUp()` for digital input in addition to `A0.readAnalog()` for analog reads.

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
// NOTE: Use IDigitalPin & IAnalogInput so users can access both:
//   - A0.inputPullUp() for digital input mode
//   - A0.readAnalog() for analog input mode
export const A0: IDigitalPin & IAnalogInput = createAnalogPin(14, 0);
export const A1: IDigitalPin & IAnalogInput = createAnalogPin(15, 1);
export const A2: IDigitalPin & IAnalogInput = createAnalogPin(16, 2);
export const A3: IDigitalPin & IAnalogInput = createAnalogPin(17, 3);
export const A4: IDigitalPin & IAnalogInput = createAnalogPin(18, 4);
export const A5: IDigitalPin & IAnalogInput = createAnalogPin(19, 5);

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