# @typehal/core

Shared TypeScript types, board metadata definitions, and transpiler configuration interfaces for the TypeHAL ecosystem.

## Overview

`@typehal/core` is the foundation of the TypeHAL toolchain. It defines the common hardware abstraction types, board configuration shapes, peripheral enums, memory and register helpers, and project configuration interfaces used by the CLI, framework packages, HAL packages, board packages, and the hardware test runner.

## Quick start

Install or link `@typehal/core` in your workspace, then import the shared types and configuration interfaces in your `typehal.config.ts` or library code.

```ts
import type {
  TypehalConfig,
  TypehalTestConfig,
  PinMode,
  HIGH,
  LOW,
} from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board: '@typehal/board-arduino-uno',
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

Use `TypehalConfig` to declare the root `typehal.config.ts` shape. It includes:

- `target` — hardware architecture identifier such as `avr`
- `board` — board package name or local board definition path
- `framework` — code generation strategy package
- `output` — generated output layout and optimization settings
- `test` — hardware test runner settings for `@typehal/expect`
- `toolchain` — compile and upload toolchain options
- `console` — Arduino Serial polyfill configuration

### Hardware primitives

Import shared hardware primitives from `@typehal/core`:

```ts
import {
  DigitalValue,
  AnalogValue,
  PinMode,
  InterruptMode,
  createPinGroup,
  createParallelPort,
} from '@typehal/core';
```

### Board metadata and helpers

The package also exports core board metadata and helper types used by board packages and HAL implementations:

- `ArchitectureIdentifier`
- `TypehalOutputConfig`
- `TypehalToolchainConfig`
- `TypehalConsoleConfig`
- `TypehalTestConfig`
- memory decorators such as `Static`, `ProgramMemory`, `EEPROM`, `NoInit`
- register utilities like `register`, `bits`, `Bit`, `Bits`
- concurrency interfaces like `ITaskManager`, `ITimerManager`, `IMutex`, `IQueue`

These exports let TypeHAL model embedded hardware safely in TypeScript and provide the shared contract used across packages.
