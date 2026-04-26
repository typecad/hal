# @typecode/schema

Board definition schema and metadata builders for TypeCode.

## Overview

`@typecode/schema` defines the core board metadata types and definition helpers used by TypeCode board packages and the transpiler. It provides the data model for pins, peripherals, feature flags, memory, and board capabilities.

## Quick start

Import the schema builder and metadata types when creating a custom board package or extending an existing board definition.

```ts
import {
  GPIO,
  PinBuilder,
  PeripheralBuilder,
  BoardDefinitionBuilder,
  validateBoardDefinition,
} from '@typecode/schema';

const board = new BoardDefinitionBuilder('custom-board')
  .addPin(new PinBuilder('D0').setCapabilities(GPIO.digital()).build())
  .addPeripheral(new PeripheralBuilder('UART0').build())
  .build();

validateBoardDefinition(board);
```

## How to use

### Board metadata

`@typecode/schema` exports the core metadata types for board definitions:

- `BoardDefinition`
- `PinDefinition`
- `PeripheralDefinition`
- `FeatureFlags`
- `MemorySpec`
- `BuildConfig`

### Builders and helpers

Use the builder utilities to construct and validate board packages:

- `BoardDefinitionBuilder`
- `PinBuilder`
- `PeripheralBuilder`
- `PinCapabilityBuilder`
- `validateBoardDefinition`

### Typical usage

A board package can use `@typecode/schema` to describe which pins exist, what peripherals are available, and which features are supported. The CLI and framework packages consume this metadata to drive safe hardware code generation and diagnostics.
