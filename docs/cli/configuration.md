# Configuration

Complete configuration options for `typecode.config.ts`.

## Basic Configuration

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },
};

export default config;
```

## Configuration Options

### Top-Level Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `target` | string | Yes | Target architecture (`avr`, `samd`, `esp32`, etc.) |
| `board` | string | Yes | Board package name (`@typecode/board-*`) |
| `fqbn` | string | For compile | Fully Qualified Board Name |
| `entry` | string | For `build` | Entry point TypeScript file (relative to config file) |
| `output` | object | No | Output configuration |
| `include` | string[] | No | Additional include paths |
| `define` | object | No | Preprocessor definitions |

### Output Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `framework` | `'arduino' \| 'generic'` | `'arduino'` | Output framework |
| `optimize` | `'size' \| 'speed' \| 'none'` | `'none'` | Optimization level |
| `outDir` | string | `'./out'` | Output directory |
| `emitMaps` | boolean | `true` | Generate source maps |
| `emitMode` | `'cpp' \| 'split'` | `'split'` | Output file mode |

## Target Architectures

| Target | Description | Example Boards |
|--------|-------------|----------------|
| `avr` | 8-bit AVR | Arduino Uno, Nano, Mega |
| `samd` | ARM Cortex-M0+ | Arduino Zero, Nano 33 IoT |
| `esp32` | ESP32 / Xtensa | ESP32 DevKit, ESP32-S3 |
| `stm32` | STM32 ARM Cortex-M | Blue Pill, Black Pill |

## Board Packages

### Available Board Packages

| Package | FQBN | Target |
|---------|------|--------|
| `@typecode/board-arduino-uno` | `arduino:avr:uno` | `avr` |
| `@typecode/board-arduino-nano33iot` | `arduino:samd:nano_33_iot` | `samd` |
| `@typecode/board-esp32-devkit` | `esp32:esp32:esp32doit-devkit-v1` | `esp32` |

### Custom Board Package

```typescript
const config: TypecodeConfig = {
  target: 'avr',
  board: './local-board-package',  // Local path
  // ... rest of config
};
```

## FQBN (Fully Qualified Board Name)

The FQBN identifies the exact board variant for the toolchain:

```
<package>:<architecture>:<board>[:<options>]
```

### Examples

| FQBN | Description |
|------|-------------|
| `arduino:avr:uno` | Arduino Uno |
| `arduino:avr:nano:cpu=atmega328` | Arduino Nano with ATmega328P |
| `arduino:samd:nano_33_iot` | Arduino Nano 33 IoT |
| `esp32:esp32:esp32doit-devkit-v1` | ESP32 DevKit V1 |
| `esp32:esp32:esp32s3box` | ESP32-S3 Box |

## Preprocessor Definitions

```typescript
const config: TypecodeConfig = {
  // ... other options
  define: {
    DEBUG: '1',
    VERSION: '"1.0.0"',
    BAUD_RATE: '115200',
  },
};
```

Generates:

```cpp
#define DEBUG 1
#define VERSION "1.0.0"
#define BAUD_RATE 115200
```

## Include Paths

```typescript
const config: TypecodeConfig = {
  // ... other options
  include: [
    './include',
    './vendor/libraries',
  ],
};
```

### Entry Point

The `entry` field specifies the main TypeScript file for the `typecode build` command. It is required when using `npx typecode build`:

```typescript
const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  entry: './src/sketch.ts',  // Relative to config file location
  output: {
    framework: 'arduino',
    outDir: './out',
  },
};
```

When set, `typecode build` resolves the entry file from the config and transpiles the full import graph. This enables multi-file project support — see [Multi-File Projects](../transpiler/README.md#multi-file-projects) for details.

## Complete Example

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
    emitMaps: true,
    emitMode: 'split',
  },
  
  include: [
    './lib',
  ],
  
  define: {
    F_CPU: '16000000UL',
    DEBUG: '1',
  },
};

export default config;
```

## Environment-Specific Configuration

```typescript
import type { TypecodeConfig } from '@typecode/core';

const isDev = process.env.NODE_ENV !== 'production';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  
  output: {
    framework: 'arduino',
    optimize: isDev ? 'none' : 'size',
    outDir: './out',
    emitMaps: isDev,
  },
  
  define: {
    DEBUG: isDev ? '1' : '0',
  },
};

export default config;
```

## Multi-Board Projects

For projects targeting multiple boards, create separate config files:

```
project/
├── typecode.config.ts       # Default (Uno)
├── typecode.config.nano.ts  # Nano variant
├── typecode.config.esp32.ts # ESP32 variant
└── src/
    └── main.ts
```

Then specify the config file:

```bash
npx typecode src/main.ts --config typecode.config.nano.ts
```

## Validation

The CLI validates the configuration and reports errors:

```bash
$ npx typecode sketch.ts
Error: Invalid configuration
  - target "invalid" is not supported
  - board package "@typecode/board-unknown" not found