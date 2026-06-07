# 🐙 typehal

TypeHAL CLI tool for transpiling TypeScript firmware to C++/Arduino, compiling with `arduino-cli`, uploading to boards, and driving test and scaffold workflows.

## Overview

The `typehal` package provides the command-line interface for the TypeHAL toolchain. It loads `typehal.config.ts`, transpiles TypeScript firmware, and can optionally chain compile, upload, and monitor steps for Arduino-compatible boards.

## Quick start

From a project root that contains `typehal.config.ts`:

```bash
npx typehal src/main.ts
npx typehal src/main.ts --compile --upload --port COM4
npx typehal src/main.ts --compile --upload --monitor --port COM4 --baud 115200
```

Create a starter project with the built-in wizard:

```bash
npx typehal init --board arduino:avr:uno --framework arduino
```

## How to use

### Common commands

- `typehal <input.ts>` — transpile a TypeScript sketch
- `typehal <input.ts> --compile` — transpile and compile using Arduino CLI
- `typehal <input.ts> --compile --upload --port <port>` — flash firmware to the board
- `typehal <input.ts> --compile --upload --monitor --port <port>` — open a serial monitor after upload
- `typehal init` — create a starter project and config file
- `typehal gen-libdefs <input.ts>` — generate library definition stubs for third-party imports
- `typehal map-error <mapFile>` — map a C++ compiler error back to its TypeScript source location

### Configuration

The CLI reads `typehal.config.ts` from the current working directory and uses it as the source of truth. When no config file is available, command-line flags such as `--fqbn` and `--board` supply board and build settings.

### Example configuration

```ts
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board: '@typehal/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

### Integration with hardware tests

The CLI integrates with the hardware test runner package `@typehal/expect` and resolves the same board metadata and compiler inputs used by firmware code.
