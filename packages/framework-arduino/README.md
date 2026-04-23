# @typecode/framework-arduino

Arduino framework strategy for TypeCode code generation.

## Overview

`@typecode/framework-arduino` implements the Arduino-compatible code generation strategy used by TypeCode. It emits Arduino-style C++ calls such as `pinMode()`, `digitalWrite()`, and `Serial` operations, and provides helper utilities for Arduino CLI metadata, library discovery, and runtime polyfills.

## Quick start

Add the package to your `typecode.config.ts`:

```ts
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  framework: '@typecode/framework-arduino',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size' },
};

export default config;
```

Then run the CLI:

```bash
npx typecode src/main.ts --compile --upload --port COM4
```

## How to use

### Framework strategy

When `framework` is set to `@typecode/framework-arduino`, TypeCode generates code compatible with the Arduino runtime and Arduino CLI toolchain.

### Key exports

This package exposes the main Arduino strategy and helpers for advanced workflows:

- `ArduinoStrategy`
- `FrameworkStrategy` (alias for `ArduinoStrategy`)
- `compileArduinoSketch`
- `uploadArduinoSketch`
- `monitorArduinoSketch`
- `loadArduinoCliMetadata`
- `getInstalledLibraries`
- `generateArduinoLibDecl`
- `buildArduinoClassNameMap`
- `arduinoAsyncPolyfill`
- `generateStdStringPolyfill`

### Arduino library support

The package can discover installed Arduino libraries and generate TypeScript declaration stubs for library imports. This is useful when using third-party Arduino libraries from TypeScript firmware.

### Serial and console polyfills

`@typecode/framework-arduino` includes helpers for detecting `Serial.begin()` usage and injecting Arduino console support automatically when needed.
