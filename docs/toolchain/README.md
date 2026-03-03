# Toolchain Documentation

The TypeCode toolchain manages compilers, uploaders, and build tools for embedded development.

## Documents

- [Arduino CLI](./arduino-cli.md) - Arduino CLI integration
- [PlatformIO](./platformio.md) - PlatformIO integration

## Overview

TypeCode supports multiple toolchains:

| Toolchain | Description | Use Case |
|-----------|-------------|----------|
| Arduino CLI | Official Arduino command-line | Standard Arduino development |
| PlatformIO | Professional embedded platform | Advanced features, more boards |

## Installation

### Arduino CLI

```bash
# Windows (via scoop)
scoop install arduino-cli

# macOS (via Homebrew)
brew install arduino-cli

# Linux
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
```

### PlatformIO

```bash
# Via pip
pip install platformio

# Via VS Code extension
# Install "PlatformIO IDE" extension
```

## Toolchain Registry

The toolchain registry manages available toolchains:

```typescript
interface ToolchainRegistry {
  register(toolchain: Toolchain): void;
  get(name: string): Toolchain | null;
  getDefault(): Toolchain;
}
```

## Toolchain Interface

All toolchains implement a common interface:

```typescript
interface Toolchain {
  name: string;
  
  // Check if toolchain is available
  isAvailable(): Promise<boolean>;
  
  // Compile a sketch
  compile(sketchPath: string, fqbn: string, options?: CompileOptions): Promise<CompileResult>;
  
  // Upload to board
  upload(sketchPath: string, fqbn: string, port: string, options?: UploadOptions): Promise<UploadResult>;
  
  // Open serial monitor
  monitor(port: string, baudRate: number): Promise<void>;
  
  // List connected boards
  listBoards(): Promise<BoardInfo[]>;
  
  // Install a core/library
  installCore(package: string): Promise<void>;
  installLibrary(name: string): Promise<void>;
}
```

## Usage

### Via CLI

```bash
# Arduino CLI (default)
npx typecode sketch.ts --compile --upload --port COM4

# PlatformIO
npx typecode sketch.ts --toolchain platformio --compile --upload --port COM4
```

### Via Configuration

```typescript
// typecode.config.ts
const config: TypecodeConfig = {
  toolchain: 'arduino-cli',
  // ... other options
};
```

## Compile Options

```typescript
interface CompileOptions {
  buildPath?: string;        // Custom build directory
  warnings?: 'none' | 'default' | 'more' | 'all';
  optimization?: 'size' | 'speed' | 'debug';
  defines?: Record<string, string>;
  includes?: string[];
  verbose?: boolean;
}
```

## Upload Options

```typescript
interface UploadOptions {
  verify?: boolean;          // Verify after upload
  verbose?: boolean;
  programMode?: boolean;     // Use programmer instead of bootloader
}
```

## Board Detection

List connected boards:

```bash
npx typecode list-boards
```

Output:
```
Port      Board              FQBN
COM4      Arduino Uno        arduino:avr:uno
COM5      Arduino Nano       arduino:avr:nano
/dev/ttyACM0  Arduino Zero   arduino:samd:zero
```

## Core Management

Install Arduino cores:

```bash
# Install AVR core
npx typecode install-core arduino:avr

# Install ESP32 core
npx typecode install-core esp32:esp32
```

## Library Management

Install libraries:

```bash
# Install library
npx typecode install-library Servo

# Install specific version
npx typecode install-library Servo@1.1.8
```

## Troubleshooting

### Arduino CLI Not Found

```
Error: arduino-cli not found in PATH
```

Solution: Install Arduino CLI or set `ARDUINO_CLI_PATH` environment variable.

### Board Not Detected

```
Error: No board found on port COM4
```

Solutions:
1. Check USB cable
2. Install correct drivers (e.g., CH340 for clones)
3. Press reset button while uploading

### Compilation Failed

```
Error: Compilation failed
```

Check:
1. Correct FQBN for your board
2. Required cores installed
3. Required libraries installed