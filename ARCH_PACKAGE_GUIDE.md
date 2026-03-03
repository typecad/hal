# Architecture Package Development Guide

> **Audience**: This document is designed for LLM/AI agents to understand how to create architecture packages for the TypeCode transpiler.

## Overview

Architecture packages (`@typecode/arch-*`) define how code is generated for a CPU family. They contain:

- **Platform Strategy**: Code generation logic that transforms TypeScript to C++
- **Register Definitions**: CPU-specific register mappings and helpers
- **Native Polyfills**: Native implementations of runtime features (console, etc.)

Architecture packages are **imported and re-exported by board packages**. Users typically don't import arch packages directly—they import from the board package, which internally uses the arch package.

## When to Create an Architecture Package

Create a new architecture package when:

1. **Supporting a new CPU family** (e.g., ARM Cortex-M, ESP32-C3, STM32)
2. **Providing a different codegen approach** for an existing family (e.g., native registers vs. Arduino framework)
3. **Multiple boards share the same register mappings** (e.g., ATmega328P used by Uno, Nano, Pro Mini)

## Package Structure

```
packages/arch-<family>-<variant>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        ← Public exports (strategy + register helpers)
    ├── strategy.ts     ← PlatformStrategy implementation
    └── registers.ts    ← CPU register definitions (optional)
```

### Naming Convention

| Pattern | Example | Description |
|---------|---------|-------------|
| `arch-<family>-native` | `arch-avr-native` | Native register access (no framework) |
| `arch-<family>-arduino` | `arch-avr-arduino` | Arduino framework wrapper |
| `arch-<family>-<variant>` | `arch-esp32-idf` | ESP-IDF native APIs |

## Package Configuration

### package.json

```json
{
  "name": "@typecode/arch-avr-native",
  "version": "0.1.0",
  "description": "Native AVR architecture package with direct register access",
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc"
  },
  "peerDependencies": {
    "typecode": "^0.1.0"
  },
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2021",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "paths": {
      "typecode/platform": ["../cli/dist/platform/index"],
      "typecode/platform/registry": ["../cli/dist/platform/registry"],
      "typecode/ir": ["../cli/dist/ir/model"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

## Core Components

### 1. Register Definitions (`registers.ts`)

Define CPU register mappings and helper functions. This file is optional but recommended for native strategies.

```typescript
// src/registers.ts

/**
 * Pin register information for ATmega328P
 */
export interface PinRegisterInfo {
  /** Data Direction Register (DDRD, DDRB, etc.) */
  ddr: string;
  /** Output Port Register (PORTD, PORTB, etc.) */
  port: string;
  /** Input Pin Register (PIND, PINB, etc.) */
  pinReg: string;
  /** Bit position within the register (0-7) */
  bit: number;
}

/**
 * PWM timer information for ATmega328P
 */
export interface PWMInfo {
  /** Output Compare Register (OCR0A, OCR2B, etc.) */
  ocr: string;
  /** Timer/Counter Control Register */
  tccr: string;
  /** Compare Output Mode bit name */
  comBit: string;
  /** Timer identifier (timer0, timer1, timer2) */
  timerId: string;
}

// ATmega328P pin mapping
const PIN_MAP: Record<number, PinRegisterInfo> = {
  0:  { ddr: 'DDRD', port: 'PORTD', pinReg: 'PIND', bit: 0 },
  1:  { ddr: 'DDRD', port: 'PORTD', pinReg: 'PIND', bit: 1 },
  // ... pins 2-7
  8:  { ddr: 'DDRB', port: 'PORTB', pinReg: 'PINB', bit: 0 },
  // ... pins 8-13
  13: { ddr: 'DDRB', port: 'PORTB', pinReg: 'PINB', bit: 5 },  // LED
};

// PWM channel mapping
const PWM_MAP: Record<number, PWMInfo> = {
  3:  { ocr: 'OCR2B',  tccr: 'TCCR2A', comBit: 'COM2B1', timerId: 'timer2' },
  5:  { ocr: 'OCR0B',  tccr: 'TCCR0A', comBit: 'COM0B1', timerId: 'timer0' },
  6:  { ocr: 'OCR0A',  tccr: 'TCCR0A', comBit: 'COM0A1', timerId: 'timer0' },
  9:  { ocr: 'OCR1A',  tccr: 'TCCR1A', comBit: 'COM1A1', timerId: 'timer1' },
  10: { ocr: 'OCR1B',  tccr: 'TCCR1A', comBit: 'COM1B1', timerId: 'timer1' },
  11: { ocr: 'OCR2A',  tccr: 'TCCR2A', comBit: 'COM2A1', timerId: 'timer2' },
};

/**
 * Get register information for a pin
 */
export function getPinInfo(pin: number): PinRegisterInfo | undefined {
  return PIN_MAP[pin];
}

/**
 * Get pre-computed bit mask for a pin (e.g., "(1 << 5)" → "0x20")
 */
export function getPinBitMask(pin: number): string {
  const info = PIN_MAP[pin];
  if (!info) return '0';
  return `0x${(1 << info.bit).toString(16).toUpperCase()}`;
}

/**
 * Get PWM information for a pin
 */
export function getPWMInfo(pin: number): PWMInfo | undefined {
  return PWM_MAP[pin];
}
```

### 2. Platform Strategy (`strategy.ts`)

The strategy class controls code generation. Extend `ArduinoStrategy` for Arduino-compatible targets, or implement `PlatformStrategy` directly.

```typescript
// src/strategy.ts

import { ArduinoStrategy, RuntimePolyfillIR } from 'typecode/platform';
import { getPinInfo, getPinBitMask, getPWMInfo } from './registers';

/**
 * Platform strategy for native AVR code generation.
 * Generates direct register access instead of Arduino framework calls.
 */
export class NativeAVRStrategy extends ArduinoStrategy {
  // Use "arduino" ID to integrate with Arduino toolchain
  override readonly id = "arduino";

  // ═══════════════════════════════════════════════════════════════════════
  // INCLUDES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Return #include headers for generated code.
   */
  override forcedIncludes(_program?: any, _ctx?: any): string[] {
    return [
      '<avr/io.h>',         // AVR register definitions
      // Note: <util/delay.h> needs F_CPU defined first - add in shimLines()
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SHIM CODE (emitted after includes)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Return helper code emitted after includes.
   * Use for native function implementations, UART helpers, etc.
   */
  override shimLines(program?: any, _ctx?: any): string[] {
    const lines: string[] = [];
    
    // F_CPU must be defined before util/delay.h
    lines.push(
      '#ifndef F_CPU',
      '#define F_CPU 16000000UL  // 16 MHz clock frequency',
      '#endif',
      '#include <util/delay.h>',
      '#include <avr/interrupt.h>',
      ''
    );
    
    // UART helper functions (for console.log)
    lines.push(
      '// UART initialization (native AVR USART0)',
      'static inline void _uart_init(unsigned long baud) {',
      '  unsigned int ubrr = (F_CPU / 16 / baud - 1);',
      '  UBRR0H = (unsigned char)(ubrr >> 8);',
      '  UBRR0L = (unsigned char)ubrr;',
      '  UCSR0B = (1 << RXEN0) | (1 << TXEN0);',
      '  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);  // 8N1',
      '}',
      '',
      'static inline void _uart_write(unsigned char data) {',
      '  while (!(UCSR0A & (1 << UDRE0)));',
      '  UDR0 = data;',
      '}',
      '',
      'static inline void _uart_print(const char* str) {',
      '  while (*str) _uart_write(*str++);',
      '}',
      ''
    );
    
    // Add ADC, PWM, and other initializations based on program usage...
    
    return lines;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SETUP INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Return code to insert at the beginning of setup().
   * Initialize hardware based on peripheral usage analysis.
   */
  setupInitCode(program?: any, _ctx?: any): string[] {
    const lines: string[] = [];
    
    // Always initialize UART for console
    lines.push('_uart_init(9600)');
    
    const usage = program?.peripheralUsage;
    
    // Initialize ADC if used
    if (usage?.adc) {
      lines.push('_init_adc()');
    }
    
    // Initialize PWM timers if used
    if (usage?.pwm) {
      // Group pins by timer and initialize each timer once
      // ...
    }
    
    return lines;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SYMBOL ALIASES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Map TypeScript function names to C++ implementations.
   */
  override symbolAliases(_program?: any, _ctx?: any): Record<string, string> {
    return {
      'delay': '_native_delay_ms',
      'delayMicroseconds': '_native_delay_us',
      'millis': 'millis',
      'micros': 'micros',
      'noInterrupts': 'cli',
      'interrupts': 'sei',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NATIVE POLYFILLS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Return set of polyfill IDs this strategy handles natively.
   * The emitter will skip emitting the global polyfill for these.
   */
  nativePolyfills(): Set<string> {
    return new Set(['console']);  // We provide native console.log
  }

  /**
   * Return native polyfill implementations.
   */
  generateNativePolyfills(program?: any, _ctx?: any): RuntimePolyfillIR[] {
    return [{
      id: 'console',
      kind: 'polyfill',
      domain: 'arduino',
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `inline void console_log(const char* msg) { _uart_println(msg); }`,
        `inline void console_log(int val) { _uart_println_long(val); }`,
      ],
      shimMacros: [
        `#define console_log(...) console_log(__VA_ARGS__)`,
      ],
      dependencies: [],
    }];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CODE GENERATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Try to render a call statement to native code.
   * Return undefined to fall back to default rendering.
   */
  override tryRenderCallStatement(
    callee: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
    _boardConstants?: any,
  ): string | undefined {
    // Handle standalone function calls
    if (callee === 'delay') {
      return `_native_delay_ms(${args.map(renderArg).join(', ')})`;
    }
    
    // Handle pin method calls (e.g., D13.high(), LED.toggle())
    const parts = callee.split('.');
    if (parts.length === 2) {
      const [receiver, method] = parts;
      return this.tryRenderNativeCall(receiver, method, args, renderArg);
    }
    
    return undefined;
  }

  /**
   * Try to render a TypeCode method call (pin methods, Serial, etc.)
   */
  override tryRenderTypecodeCall(
    receiver: string,
    receiverKind: string,
    method: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
    _boardConstants?: any,
  ): string | undefined {
    return this.tryRenderNativeCall(receiver, method, args, renderArg);
  }

  /**
   * Core native code generation for pin/Serial method calls.
   */
  private tryRenderNativeCall(
    receiver: string,
    method: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
  ): string | undefined {
    // Handle Serial peripheral
    if (receiver === 'Serial') {
      switch (method) {
        case 'begin':
        case 'initialize':
          return `_uart_init(${renderArg(args[0])})`;
        case 'print':
          return `_uart_print(${renderArg(args[0])})`;
        case 'println':
          return `_uart_println(${renderArg(args[0])})`;
        default:
          return undefined;
      }
    }
    
    // Parse pin number from receiver (e.g., "D13" → 13, "LED" → 13)
    const pin = parsePinFromReceiver(receiver);
    if (pin === null) return undefined;
    
    // Generate native code based on method
    switch (method) {
      case 'high': {
        const info = getPinInfo(pin);
        if (!info) return undefined;
        return `${info.port} |= ${getPinBitMask(pin)}`;
      }
      case 'low': {
        const info = getPinInfo(pin);
        if (!info) return undefined;
        return `${info.port} &= ~${getPinBitMask(pin)}`;
      }
      case 'toggle': {
        const info = getPinInfo(pin);
        if (!info) return undefined;
        return `${info.port} ^= (1 << ${info.bit})`;
      }
      case 'read': {
        const info = getPinInfo(pin);
        if (!info) return undefined;
        return `((${info.pinReg} & ${getPinBitMask(pin)}) ? 1 : 0)`;
      }
      case 'write': {
        const value = renderArg(args[0]);
        const info = getPinInfo(pin);
        if (!info) return undefined;
        return `(${value}) ? (${info.port} |= ${getPinBitMask(pin)}) : (${info.port} &= ~${getPinBitMask(pin)})`;
      }
      default:
        return undefined;
    }
  }

  /**
   * Transform console.* calls to native UART output.
   */
  override transformConsoleCall(
    method: string,
    renderedArgs: string,
    forHeader: boolean,
  ): string {
    const semi = forHeader ? "" : ";";
    switch (method) {
      case 'log':
        return `_uart_println(${renderedArgs})${semi}`;
      case 'error':
        return `_uart_print("[ERROR] "); _uart_println(${renderedArgs})${semi}`;
      case 'warn':
        return `_uart_print("[WARN] "); _uart_println(${renderedArgs})${semi}`;
      default:
        return `_uart_println(${renderedArgs})${semi}`;
    }
  }
}

// Export as PlatformStrategy for architecture package convention
export { NativeAVRStrategy as PlatformStrategy };
```

### 3. Public Exports (`index.ts`)

Export the strategy and any register helpers that board packages might need.

```typescript
// src/index.ts

// Register definitions and helpers (optional - for board packages that need them)
export {
  PinRegisterInfo,
  PWMInfo,
  getPinInfo,
  getPinBitMask,
  getPWMInfo,
} from './registers';

// Platform strategy for native AVR code generation
export { NativeAVRStrategy, PlatformStrategy } from './strategy';
```

## How Board Packages Use Architecture Packages

Board packages import and re-export the architecture strategy:

```typescript
// packages/board-arduino-uno/src/index.ts

import type { BoardDefinition } from '@typecode/core';

// Re-export the architecture strategy as BoardStrategy
export { PlatformStrategy as BoardStrategy } from '@typecode/arch-avr-native';

// Export board-specific pins and constants
export { D0, D1, D2, /* ... */ LED, A0, A1, /* ... */ } from './pins';
export { I2C0, SPI0, Serial } from './peripherals';
export { delay, millis, micros } from './timing';

// Board definition manifest
export const Board: BoardDefinition = {
  name: 'Arduino Uno',
  architecture: 'avr',
  mcu: 'atmega328p',
  clockSpeed: 16000000,
  // ... pins, peripherals, etc.
};
```

## Strategy Method Reference

### Code Generation Hooks

| Method | Purpose | Example |
|--------|---------|---------|
| `forcedIncludes()` | Return `#include` headers | `['<avr/io.h>']` |
| `shimLines()` | Helper code after includes | UART functions, ADC init |
| `setupInitCode()` | Code at start of `setup()` | `_uart_init(9600)` |
| `symbolAliases()` | TS name → C++ name mapping | `{ 'delay': '_native_delay_ms' }` |

### Polyfill Control

| Method | Purpose |
|--------|---------|
| `nativePolyfills()` | Return set of polyfill IDs handled natively |
| `generateNativePolyfills()` | Return native polyfill implementations |

### Expression/Statement Rendering

| Method | Purpose |
|--------|---------|
| `tryRenderCallStatement()` | Render standalone function calls |
| `tryRenderTypecodeCall()` | Render pin/Serial method calls |
| `transformConsoleCall()` | Transform `console.*` calls |

### File Shape

| Method | Purpose | Arduino Default |
|--------|---------|-----------------|
| `sourceExtension()` | File extension | `.ino` for entry, `.cpp` otherwise |
| `entrypointFunctionName()` | Entry function | `setup` |
| `requiresLoopFunction()` | Whether `loop()` is required | `true` |

## Testing

Build and test the architecture package:

```bash
# Build the architecture package
cd packages/arch-avr-native
npm run build

# Test with a board package that uses it
cd ../..
npx typecode example.ts --compile
```

## Complete Example: arch-avr-native

Reference implementation: [`packages/arch-avr-native/`](packages/arch-avr-native/)

Key files:
- [`src/strategy.ts`](packages/arch-avr-native/src/strategy.ts) - Native AVR code generation strategy
- [`src/registers.ts`](packages/arch-avr-native/src/registers.ts) - ATmega328P register definitions
- [`src/index.ts`](packages/arch-avr-native/src/index.ts) - Public exports

## Checklist

**Package structure**
- [ ] `packages/arch-<family>-<variant>/package.json` with peer dependency on `typecode`
- [ ] `packages/arch-<family>-<variant>/tsconfig.json` with path mappings for `typecode/*`
- [ ] `src/strategy.ts` - PlatformStrategy implementation
- [ ] `src/registers.ts` - Register definitions (if needed)
- [ ] `src/index.ts` - Public exports

**Strategy implementation**
- [ ] `forcedIncludes()` returns required headers
- [ ] `shimLines()` defines native helper functions
- [ ] `setupInitCode()` initializes hardware based on usage
- [ ] `nativePolyfills()` / `generateNativePolyfills()` for native implementations
- [ ] `tryRenderCallStatement()` / `tryRenderTypecodeCall()` for native codegen

**Workspace registration**
- [ ] Root `package.json` `workspaces` array updated
- [ ] `npm install` run from workspace root

**Testing**
- [ ] Package builds cleanly (`npx tsc -b`)
- [ ] Board package can import and re-export strategy
- [ ] Generated code compiles for target FQBN