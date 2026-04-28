# @typehal/framework-avr

Native AVR register-level code generation for TypeHAL.

## Overview

`@typehal/framework-avr` provides a native AVR code generation strategy for TypeHAL. It targets AVR microcontrollers such as the ATmega328P and emits direct register access instead of Arduino framework calls.

## Quick start

Use the package in your `typehal.config.ts`:

```ts
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board: '@typehal/board-arduino-uno',
  framework: '@typehal/framework-avr',
  output: { optimize: 'size' },
};

export default config;
```

Run the CLI to transpile and compile:

```bash
npx typehal src/main.ts --compile --upload --port COM4
```

## How to use

### Framework strategy

Set `framework` to `@typehal/framework-avr` to use the AVR-native emission strategy. This package is optimized for direct register access and low-level AVR firmware patterns.

### Key exports

Use these exports when working with AVR-specific codegen and board metadata:

- `NativeAVRStrategy`
- `FrameworkStrategy`
- `PlatformStrategy`
- `PinRegisterInfo`
- `PWMInfo`
- `getPinInfo`
- `parsePinFromReceiver`
- `getPortReg`
- `getDDRReg`
- `getADCChannel`
- `isPWMPin`
- `getInterruptInfo`

### Use cases

This package is a good fit when you want tighter control over AVR hardware behavior, faster firmware, or fewer runtime dependencies than the Arduino framework provides.
