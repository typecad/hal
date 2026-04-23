# typecode

TypeCode CLI tool for transpiling TypeScript firmware to C++/Arduino, compiling with `arduino-cli`, uploading to boards, and driving test and scaffold workflows.

## Overview

The `typecode` package provides the command-line interface for the TypeCode toolchain. It loads `typecode.config.ts`, transpiles TypeScript firmware, and can optionally chain compile, upload, and monitor steps for Arduino-compatible boards.

## Quick start

From a project root that contains `typecode.config.ts`:

```bash
npx typecode src/main.ts
npx typecode src/main.ts --compile --upload --port COM4
npx typecode src/main.ts --compile --upload --monitor --port COM4 --baud 115200
```

Create a starter project with the built-in wizard:

```bash
npx typecode init --board arduino:avr:uno --framework arduino
```

## How to use

### Common commands

- `typecode <input.ts>` — transpile a TypeScript sketch
- `typecode <input.ts> --compile` — transpile and compile using Arduino CLI
- `typecode <input.ts> --compile --upload --port <port>` — flash firmware to the board
- `typecode <input.ts> --compile --upload --monitor --port <port>` — open a serial monitor after upload
- `typecode init` — create a starter project and config file
- `typecode gen-libdefs <input.ts>` — generate library definition stubs for third-party imports
- `typecode map-error <mapFile>` — map a C++ compiler error back to its TypeScript source location

### Configuration

The CLI reads `typecode.config.ts` from the current working directory and uses it as the source of truth. When no config file is available, command-line flags such as `--fqbn` and `--board` supply board and build settings.

### Example configuration

```ts
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

### Integration with hardware tests

The CLI integrates with the hardware test runner package `@typecode/expect` and resolves the same board metadata and compiler inputs used by firmware code.
