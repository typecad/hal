# Toolchain Documentation

The TypeHAL toolchain manages compilers, uploaders, and build tools for embedded and desktop development.

## Documents

- [Arduino CLI](./arduino-cli.md) - Arduino CLI integration

## Overview

TypeHAL delegates compilation to the active framework's toolchain. Each framework provides its own compiler integration.

| Toolchain | Framework | Description | Use Case |
|-----------|-----------|-------------|----------|
| Arduino CLI | `@typehal/framework-arduino` | Official Arduino command-line | Microcontroller development |
| Native (g++/clang++) | `@typehal/framework-native` | System C++ compiler | Desktop executables, testing |

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

### Native C++ Compiler

The native toolchain auto-detects `g++` or `clang++` on your system. On Windows, it also checks MSYS2/MinGW paths.

```bash
# Windows — install MSYS2, then add C:\msys64\ucrt64\bin to PATH
# macOS — Xcode Command Line Tools provide clang++
xcode-select --install

# Linux — install g++
sudo apt install g++     # Debian/Ubuntu
sudo dnf install gcc-c++ # Fedora
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
npx typehal sketch.ts --compile --upload --port COM4
```

### Via Configuration

```typescript
// typehal.config.ts — Arduino project
const config: TypehalConfig = {
  toolchain: {
    type: 'arduino-cli',
    arduinoCli: {
      verbose: true,
    },
  },
  // ... other options
};
```

### Native (g++/clang++) Configuration

For desktop C++ projects, customize the compiler through the `native` section:

```typescript
// typehal.config.ts — Native project
const config: TypehalConfig = {
  framework: '@typehal/framework-native',
  native: {
    compiler: 'clang++',              // Override auto-detected compiler
    cxxStandard: 'c++20',             // C++ standard
    warnings: 'extra',                // Warning level
    includePaths: ['./vendor/include'], // -I flags
    libraries: ['curl'],              // -l flags
  },
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
npx typehal list-boards
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
npx typehal install-core arduino:avr

# Install ESP32 core
npx typehal install-core esp32:esp32
```

## Library Management

Install libraries:

```bash
# Install library
npx typehal install-library Servo

# Install specific version
npx typehal install-library Servo@1.1.8
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