# Toolchain Management Guide

TypeCode supports multiple toolchain backends for compiling and uploading code to microcontrollers. This guide explains how to configure and use toolchains in your project.

## Overview

A **toolchain** handles:
- **Compilation**: Converting generated C++ code to firmware binaries
- **Upload**: Flashing firmware to the target board
- **Monitoring**: Serial communication with the board

TypeCode supports two toolchain backends:
1. **arduino-cli** (default) - Official Arduino command-line tool
2. **platformio** - PlatformIO's build system

## Configuration

Add a `toolchain` section to your `typecode.config.ts`:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',

  // Toolchain configuration
  toolchain: {
    type: 'arduino-cli', // or 'platformio'
  },
};

export default config;
```

## Arduino CLI

### Installation

```bash
# Windows (via winget)
winget install Arduino.ArduinoCLI

# macOS (via Homebrew)
brew install arduino-cli

# Linux
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
```

### Configuration Options

```typescript
toolchain: {
  type: 'arduino-cli',
  arduinoCli: {
    // Custom path to arduino-cli (auto-detected if not specified)
    path: '/path/to/arduino-cli',
    
    // Custom config file path
    configFile: './arduino-cli.yaml',
    
    // Enable verbose output
    verbose: true,
  },
},
```

### Board Cores

Arduino CLI requires board cores to be installed before compilation:

```bash
# Install Arduino AVR core (for Uno, Nano, etc.)
arduino-cli core install arduino:avr

# Install ESP32 core
arduino-cli core install esp32:esp32
```

## PlatformIO

### Installation

```bash
# Via pip (Python package manager)
pip install platformio

# Or via VS Code extension
# Install "PlatformIO IDE" from the marketplace
```

### Configuration Options

```typescript
toolchain: {
  type: 'platformio',
  platformio: {
    // Custom path to pio command (auto-detected if not specified)
    path: '/path/to/pio',
    
    // Target environment from platformio.ini
    env: 'uno',
  },
},
```

### Board Support

PlatformIO automatically downloads and installs required toolchains on first use. No manual core installation is needed.

## CLI Commands

### Compile

```bash
# Compile using configured toolchain
typecode build example.ts

# Compile with verbose output
typecode build example.ts --verbose
```

### Upload

```bash
# Upload to board on specified port
typecode upload example.ts --port COM4

# Upload with auto-detected port
typecode upload example.ts
```

### Serial Monitor

```bash
# Open serial monitor
typecode monitor --port COM4 --baud 115200
```

### List Ports

```bash
# List available serial ports
typecode ports
```

## Auto-Detection

If no toolchain type is specified, TypeCode will:
1. Check for `arduino-cli` in PATH
2. Check for `pio` (PlatformIO) in PATH
3. Use the first available toolchain

To see which toolchain is being used:

```bash
typecode toolchain
```

## FQBN Mapping

### Arduino CLI

Uses standard FQBN format:
- `arduino:avr:uno` - Arduino Uno
- `arduino:avr:nano` - Arduino Nano
- `esp32:esp32:esp32` - ESP32 Dev Module

### PlatformIO

FQBN is mapped to PlatformIO board IDs:
- `arduino:avr:uno` → `uno`
- `arduino:avr:nano` → `nanoatmega328`
- `esp32:esp32:esp32` → `esp32dev`

## Troubleshooting

### "Toolchain not found"

Ensure the toolchain is installed and in your PATH:

```bash
# Check arduino-cli
arduino-cli version

# Check PlatformIO
pio --version
```

### "Board core not installed" (Arduino CLI)

Install the required core:

```bash
# List available cores
arduino-cli core search esp32

# Install core
arduino-cli core install esp32:esp32
```

### Compilation errors

1. Check your FQBN matches the board
2. Ensure the correct board package is installed
3. Try verbose mode for detailed error messages

## Extending with Custom Toolchains

You can create custom toolchain implementations by implementing the `Toolchain` interface:

```typescript
import type { Toolchain, CompileOptions, CompileResult, UploadResult } from '@typecode/cli/toolchain';
import { registerToolchain } from '@typecode/cli/toolchain';

class MyCustomToolchain implements Toolchain {
  readonly id = 'my-toolchain' as const;
  readonly name = 'My Custom Toolchain';

  async isInstalled(): Promise<string | undefined> {
    // Check if toolchain is available
    return '/path/to/executable';
  }

  async compile(options: CompileOptions): Promise<CompileResult> {
    // Implement compilation
    return { success: true, output: '', errors: [] };
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    // Implement upload
    return { success: true, output: '' };
  }
}

// Register the toolchain
registerToolchain(new MyCustomToolchain());