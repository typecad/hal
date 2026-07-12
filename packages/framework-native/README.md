# @typecad/framework-native

Native framework package for TypeCAD — compiles TypeScript to native C++ executables (Windows/Linux) via g++ or clang++.

## Overview

`@typecad/framework-native` provides the code-generation strategy for the **native** build target. Instead of targeting a microcontroller, it lowers TypeScript to standard C++ that links against the C/C++ standard library and compiles to a desktop executable. This is useful for testing HAL logic, running simulations, or building terminal applications without hardware.

## Quick start

Reference this framework in `cuttlefish.config.ts`:

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'generic',
  framework: '@typecad/framework-native',
};

export default config;
```

Compile and run:

```bash
npx cuttlefish build --compile
./main    # or main.exe on Windows
```

## What's inside

- **`NativeStrategy`** — the platform strategy that controls C++ code generation for native targets (includes, types, shims)
- **`NativeToolchain`** — invokes `g++` or `clang++` to compile the generated C++
- **Terminal-preview graphics** — a `graphics/terminal-preview` module for rendering display output to the terminal

## Related packages

- [`@typecad/cuttlefish`](../cuttlefish) — the transpiler that consumes this framework strategy
- [`@typecad/framework-arduino`](../framework-arduino) — the Arduino-framework counterpart (for MCU targets)
- [`@typecad/simulator`](../simulator) — Node.js-based simulation runtime (no compilation needed)

## License

MIT
