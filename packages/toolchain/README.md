# @typecode/toolchain

Toolchain management package for TypeCode. Provides a unified interface for compile, upload, and serial monitor operations across different build backends (arduino-cli, PlatformIO).

## Installation

```bash
npm install @typecode/toolchain
```

## Package Structure

```
packages/toolchain/
├── src/
│   ├── index.ts           # Barrel exports
│   ├── types.ts           # Toolchain interface and types
│   ├── registry.ts        # Toolchain registry
│   ├── arduino-cli.ts     # Arduino CLI implementation
│   └── platformio.ts      # PlatformIO implementation
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture

### Toolchain Interface

All toolchains implement the `Toolchain` interface:

```typescript
interface Toolchain {
  readonly id: 'arduino-cli' | 'platformio';
  readonly name: string;
  
  // Availability
  isInstalled(): Promise<string | undefined>;
  
  // Core operations
  compile(options: CompileOptions): Promise<CompileResult>;
  upload(options: UploadOptions): Promise<UploadResult>;
  monitor?(options: MonitorOptions): Promise<void>;
  
  // Board management
  listPorts?(): Promise<Array<{ port: string; description?: string }>>;
  hasBoardCore?(fqbn: string): Promise<boolean>;
  installBoardCore?(fqbn: string): Promise<void>;
}
```

### Registry Pattern

Toolchains self-register on import:

```typescript
// Import to trigger registration
import '@typecode/toolchain/arduino-cli';
import '@typecode/toolchain/platformio';

// Resolve toolchain from config
import { resolveToolchain } from '@typecode/toolchain';
const toolchain = resolveToolchain(config?.toolchain);
```

### Configuration Flow

```
typecode.config.ts
       │
       ▼
config-loader.ts ──► parseConfigFile()
       │
       ▼
ResolvedTypecodeConfig.toolchain
       │
       ▼
resolveToolchain(config.toolchain)
       │
       ▼
Toolchain implementation
       │
       ▼
compile() / upload() / monitor()
```

## Usage

### Basic Usage

```typescript
import { resolveToolchain, type CompileOptions } from '@typecode/toolchain';

// Resolve toolchain (defaults to arduino-cli)
const toolchain = resolveToolchain();

// Check if installed
const path = await toolchain.isInstalled();
if (!path) {
  throw new Error('Toolchain not installed');
}

// Compile
const compileResult = await toolchain.compile({
  sketchPath: './out/sketch.ino',
  fqbn: 'arduino:avr:uno',
  optimize: 'size',
});

// Upload
const uploadResult = await toolchain.upload({
  sketchDir: './out',
  fqbn: 'arduino:avr:uno',
  port: 'COM4',
});
```

### With Configuration

```typescript
import { ArduinoCliToolchain, PlatformioToolchain } from '@typecode/toolchain';

// Arduino CLI with custom options
const arduino = new ArduinoCliToolchain({
  path: '/custom/path/to/arduino-cli',
  configFile: './arduino-cli.yaml',
  verbose: true,
});

// PlatformIO with custom options
const pio = new PlatformioToolchain({
  path: '/custom/path/to/pio',
  env: 'esp32dev',
});
```

### Auto-Detection

```typescript
import { findAvailableToolchain, getToolchain } from '@typecode/toolchain';

// Find first available toolchain
const toolchainId = await findAvailableToolchain();
if (toolchainId) {
  const toolchain = getToolchain(toolchainId);
  console.log(`Using: ${toolchain?.name}`);
}
```

## Creating a Custom Toolchain

### 1. Implement the Interface

```typescript
// my-toolchain.ts
import type { 
  Toolchain, 
  CompileOptions, 
  CompileResult,
  UploadOptions,
  UploadResult 
} from '@typecode/toolchain/types';

export class MyToolchain implements Toolchain {
  readonly id = 'my-toolchain' as const;
  readonly name = 'My Custom Toolchain';

  async isInstalled(): Promise<string | undefined> {
    // Check if your toolchain binary exists
    // Return path if found, undefined otherwise
  }

  async compile(options: CompileOptions): Promise<CompileResult> {
    // 1. Resolve paths
    // 2. Build command arguments
    // 3. Execute compiler
    // 4. Parse output and errors
    // 5. Return result
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    // 1. Build upload command
    // 2. Execute uploader
    // 3. Return result
  }
}
```

### 2. Register the Toolchain

```typescript
import { registerToolchain } from '@typecode/toolchain/registry';
import { MyToolchain } from './my-toolchain';

// Register on module load
registerToolchain(new MyToolchain());
```

### 3. Configure in typecode.config.ts

```typescript
const config: TypecodeConfig = {
  // ... other config
  toolchain: {
    type: 'my-toolchain',
  },
};
```

## Integration with CLI

The toolchain module integrates with the TypeCode CLI:

```bash
# Compile using configured toolchain
typecode build example.ts

# Upload using configured toolchain  
typecode upload example.ts --port COM4

# Open serial monitor
typecode monitor --port COM4 --baud 115200

# List available ports
typecode ports
```

## Error Handling

```typescript
const result = await toolchain.compile(options);

if (!result.success) {
  // Parse structured errors
  for (const error of result.errors) {
    console.error(`${error.filePath}:${error.line}:${error.column}: ${error.severity}: ${error.message}`);
  }
}
```

## Related Packages

- `@typecode/core` - Core types and configuration
- `@typecode/cli` - Command-line interface
- `@typecode/expect` - Hardware testing framework