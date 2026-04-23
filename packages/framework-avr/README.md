# @typecode/framework-avr

Native AVR register-level code generation for TypeCode.

## Overview

`@typecode/framework-avr` provides a native AVR code generation strategy for TypeCode. It targets AVR microcontrollers such as the ATmega328P and emits direct register access instead of Arduino framework calls.

## Quick start

Use the package in your `typecode.config.ts`:

```ts
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  framework: '@typecode/framework-avr',
  output: { optimize: 'size' },
};

export default config;
```

Run the CLI to transpile and compile:

```bash
npx typecode src/main.ts --compile --upload --port COM4
```

## How to use

### Framework strategy

Set `framework` to `@typecode/framework-avr` to use the AVR-native emission strategy. This package is optimized for direct register access and low-level AVR firmware patterns.

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
