# @typecad/framework-avr

Native AVR register-level code generation for TypeCAD.

## Overview

`@typecad/framework-avr` provides a native AVR code generation strategy for TypeCAD. It targets AVR microcontrollers such as the ATmega328P and emits direct register access instead of Arduino framework calls.

## Quick start

Use the package in your `cuttlefish.config.ts`:

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'avr',
  mcu: '@typecad/mcu-atmega328p',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-avr',
  output: { optimize: 'size' },
};

export default config;
```

Run the CLI to transpile and compile:

```bash
npx cuttlefish src/main.ts --compile --upload --port COM4
```

## How to use

### Framework strategy

Set `framework` to `@typecad/framework-avr` to use the AVR-native emission strategy. This package is optimized for direct register access and low-level AVR firmware patterns.

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
