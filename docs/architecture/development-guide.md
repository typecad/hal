# Architecture Package Development Guide

This guide explains how to create architecture packages for new CPU families.

## Package Structure

```
packages/arch-<family>-<variant>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Public exports
    ├── registers.ts    # CPU register definitions
    └── strategy.ts     # PlatformStrategy implementation
```

## Core Components

### 1. Register Definitions (`registers.ts`)

Define memory-mapped registers for the target CPU:

```typescript
// ATmega328P Register definitions
export const PORTB = 0x25;  // Port B Data Register
export const DDRB  = 0x24;  // Port B Data Direction Register
export const PINB  = 0x23;  // Port B Input Pins

export const PORTC = 0x28;  // Port C Data Register
export const DDRC  = 0x27;  // Port C Data Direction Register
export const PINC  = 0x26;  // Port C Input Pins

export const PORTD = 0x2B;  // Port D Data Register
export const DDRD  = 0x2A;  // Port D Data Direction Register
export const PIND  = 0x29;  // Port D Input Pins

// ADC registers
export const ADMUX  = 0x7C;
export const ADCSRA = 0x7A;
export const ADCH   = 0x79;
export const ADCL   = 0x78;

// UART registers
export const UBRR0H = 0xC5;
export const UBRR0L = 0xC4;
export const UCSR0A = 0xC0;
export const UCSR0B = 0xC1;
export const UCSR0C = 0xC2;
export const UDR0   = 0xC6;
```

### 2. Strategy Implementation (`strategy.ts`)

Implement the `PlatformStrategy` interface:

```typescript
import { PlatformStrategy } from 'typehal/platform';

export class NativeAVRStrategy extends PlatformStrategy {
  readonly id = 'avr-native';
  
  // === Headers ===
  forcedIncludes(): string[] {
    return [
      '<avr/io.h>',
      '<util/delay.h>',
      '<avr/interrupt.h>',
    ];
  }
  
  // === Helper Code ===
  shimLines(): string[] {
    return [
      '#ifndef F_CPU',
      '#define F_CPU 16000000UL',
      '#endif',
      '',
      '// Native UART implementation',
      'static inline void _uart_init(unsigned long baud) { ... }',
      'static inline void _uart_write(unsigned char data) { ... }',
    ];
  }
  
  // === Initialization ===
  setupInitCode(): string[] {
    return [
      '_uart_init(9600)',
    ];
  }
  
  // === Polyfill Control ===
  nativePolyfills(): Set<string> {
    return new Set(['console']);
  }
  
  generateNativePolyfills(): RuntimePolyfillIR[] {
    return [{
      id: 'console',
      kind: 'polyfill',
      domain: 'arduino',
      helperFunctions: [
        'void console_log(const char* msg) { _uart_println(msg); }',
      ],
    }];
  }
}
```

### 3. Public Exports (`index.ts`)

```typescript
// Export strategy
export { NativeAVRStrategy } from './strategy';

// Export registers for board packages
export * from './registers';

// Register strategy globally
import { registerPlatformStrategy } from 'typehal/platform/registry';
import { NativeAVRStrategy } from './strategy';

registerPlatformStrategy(new NativeAVRStrategy());
```

## Strategy Methods Reference

### Code Generation Hooks

| Method | Purpose |
|--------|---------|
| `forcedIncludes()` | Returns `#include` headers |
| `shimLines()` | Returns helper code after includes |
| `setupInitCode()` | Returns code at start of `setup()` |
| `symbolAliases()` | Maps TypeScript names to C++ names |

### Polyfill Control

| Method | Purpose |
|--------|---------|
| `nativePolyfills()` | Returns polyfill IDs handled natively |
| `generateNativePolyfills()` | Returns native polyfill implementations |

### File Shape

| Method | Purpose |
|--------|---------|
| `sourceExtension()` | Returns `"ino"`, `"cpp"`, or `"c"` |
| `entrypointFunctionName()` | Returns `"setup"` or `"main"` |
| `requiresLoopFunction()` | Returns `true` for Arduino |

### Type Mapping

| Method | Purpose |
|--------|---------|
| `normalizeCppType()` | Normalizes C++ type names |
| `mapReturnType()` | Maps function return types |

### Statement Rendering

| Method | Purpose |
|--------|---------|
| `tryRenderCallStatement()` | Custom call statement rendering |
| `tryRenderTypehalCall()` | TypeHAL-specific call rendering |
| `transformConsoleCall()` | `console.*` transformation |

## Native vs Arduino Framework

### Native Strategy

For direct register access without Arduino framework:

```typescript
class NativeAVRStrategy extends PlatformStrategy {
  shimLines(): string[] {
    return [
      // Define F_CPU for delay functions
      '#ifndef F_CPU',
      '#define F_CPU 16000000UL',
      '#endif',
      
      // Native digitalWrite implementation
      'static inline void _pinMode(uint8_t pin, uint8_t mode) {',
      '  volatile uint8_t* ddr = _ddr_reg(pin);',
      '  uint8_t bit = _pin_bit(pin);',
      '  if (mode == OUTPUT) *ddr |= (1 << bit);',
      '  else *ddr &= ~(1 << bit);',
      '}',
    ];
  }
}
```

### Arduino Strategy

For Arduino framework compatibility:

```typescript
class ArduinoStrategy extends PlatformStrategy {
  forcedIncludes(): string[] {
    return ['<Arduino.h>'];
  }
  
  // Arduino framework handles everything
  shimLines(): string[] {
    return [];  // No native helpers needed
  }
}
```

## Pin Mapping Integration

Architecture strategies provide helper functions that board packages use:

```typescript
// In arch-avr-native/src/strategy.ts
export function getPortRegister(pin: number): string {
  if (pin >= 0 && pin <= 7) return 'PORTD';
  if (pin >= 8 && pin <= 13) return 'PORTB';
  if (pin >= 14 && pin <= 19) return 'PORTC';
  throw new Error(`Invalid pin: ${pin}`);
}

export function getBitMask(pin: number): number {
  if (pin >= 0 && pin <= 7) return 1 << pin;
  if (pin >= 8 && pin <= 13) return 1 << (pin - 8);
  if (pin >= 14 && pin <= 19) return 1 << (pin - 14);
  throw new Error(`Invalid pin: ${pin}`);
}
```

Board packages then use these:

```typescript
// In board-arduino-uno/src/pins.ts
import { getPortRegister, getBitMask } from '@typehal/arch-avr-native';

export const D13 = createDigitalPin(13, 5);  // Port B, bit 5
export const LED = D13;
```

## Testing

```bash
# Build the architecture package
cd packages/arch-avr-native
npm run build

# Test with a board package
cd ../..
npx typehal examples/01-blink.ts --compile
```

## Common Patterns

### UART Initialization

```typescript
shimLines(): string[] {
  return [
    'static void _uart_init(unsigned long baud) {',
    '  unsigned int ubrr = (F_CPU / 16 / baud - 1);',
    '  UBRR0H = (unsigned char)(ubrr >> 8);',
    '  UBRR0L = (unsigned char)ubrr;',
    '  UCSR0B = (1 << RXEN0) | (1 << TXEN0);',
    '  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);',
    '}',
  ];
}
```

### ADC Initialization

```typescript
shimLines(): string[] {
  return [
    'static void _adc_init() {',
    '  ADMUX = (1 << REFS0);  // AVcc reference',
    '  ADCSRA = (1 << ADEN) | (1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0);',
    '}',
    '',
    'static uint16_t _adc_read(uint8_t channel) {',
    '  ADMUX = (ADMUX & 0xF0) | (channel & 0x0F);',
    '  ADCSRA |= (1 << ADSC);',
    '  while (ADCSRA & (1 << ADSC));',
    '  return ADC;',
    '}',
  ];
}
```

### I2C Implementation

```typescript
shimLines(): string[] {
  return [
    'static void _i2c_init() {',
    '  TWSR = 0;  // Prescaler = 1',
    '  TWBR = ((F_CPU / 100000UL) - 16) / 2;  // 100 kHz',
    '}',
    '',
    'static void _i2c_start() {',
    '  TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN);',
    '  while (!(TWCR & (1 << TWINT)));',
    '}',
  ];
}