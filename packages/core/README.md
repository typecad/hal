# @typecode/core

Shared TypeScript types, board metadata definitions, and transpiler configuration interfaces for the TypeCode ecosystem.

## Overview

`@typecode/core` is the foundation of the TypeCode toolchain. It defines the common hardware abstraction types, board configuration shapes, peripheral enums, memory and register helpers, and project configuration interfaces used by the CLI, framework packages, HAL packages, board packages, and the hardware test runner.

## Quick start

Install or link `@typecode/core` in your workspace, then import the shared types and configuration interfaces in your `typecode.config.ts` or library code.

```ts
import type {
  TypecodeConfig,
  TypecodeTestConfig,
  PinMode,
  HIGH,
  LOW,
} from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  output: { framework: 'arduino', optimize: 'size' },
  test: {
    port: 'COM4',
    baudRate: 115200,
  },
};

export default config;
```

## How to use

### Configuration types

Use `TypecodeConfig` to declare the root `typecode.config.ts` shape. It includes:

- `target` — hardware architecture identifier such as `avr`
- `board` — board package name or local board definition path
- `framework` — code generation strategy package
- `output` — generated output layout and optimization settings
- `test` — hardware test runner settings for `@typecode/expect`
- `toolchain` — compile and upload toolchain options
- `console` — Arduino Serial polyfill configuration

### Hardware primitives

Import shared hardware primitives from `@typecode/core`:

```ts
import {
  DigitalValue,
  AnalogValue,
  PinMode,
  InterruptMode,
  createPinGroup,
  createParallelPort,
} from '@typecode/core';
```

### Board metadata and helpers

The package also exports core board metadata and helper types used by board packages and HAL implementations:

- `ArchitectureIdentifier`
- `TypecodeOutputConfig`
- `TypecodeToolchainConfig`
- `TypecodeConsoleConfig`
- `TypecodeTestConfig`
- memory decorators such as `Static`, `ProgramMemory`, `EEPROM`, `NoInit`
- register utilities like `register`, `bits`, `Bit`, `Bits`
- concurrency interfaces like `ITaskManager`, `ITimerManager`, `IMutex`, `IQueue`

These exports let TypeCode model embedded hardware safely in TypeScript and provide the shared contract used across packages.
