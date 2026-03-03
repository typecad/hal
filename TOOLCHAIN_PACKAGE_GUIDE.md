# Toolchain Package Creation Guide

This document explains how the `@typecode/toolchain` package was created and how it interacts with the rest of the TypeCode ecosystem.

## Package Overview

```
@typecode/toolchain/
├── src/
│   ├── index.ts           # Public API exports
│   ├── types.ts           # Interface definitions
│   ├── registry.ts        # Toolchain registry (registration + resolution)
│   ├── arduino-cli.ts     # Arduino CLI implementation
│   └── platformio.ts      # PlatformIO implementation
├── package.json           # Package manifest with exports
├── tsconfig.json          # TypeScript configuration
└── README.md              # User documentation
```

## Design Decisions

### 1. Registry Pattern

Toolchains use a **self-registration pattern**:

```typescript
// registry.ts
const registry = new Map<string, Toolchain>();

export function registerToolchain(toolchain: Toolchain): void {
  registry.set(toolchain.id, toolchain);
}
```

```typescript
// arduino-cli.ts (at bottom of file)
import { registerToolchain } from './registry.js';
registerToolchain(new ArduinoCliToolchain());
```

**Benefits:**
- Adding new toolchains doesn't require modifying the registry
- Toolchains can be added by third-party packages
- Clean separation of concerns

### 2. Interface-Based Design

The `Toolchain` interface defines the contract:

```typescript
interface Toolchain {
  readonly id: string;
  readonly name: string;
  
  isInstalled(): Promise<string | undefined>;
  compile(options: CompileOptions): Promise<CompileResult>;
  upload(options: UploadOptions): Promise<UploadResult>;
  monitor?(options: MonitorOptions): Promise<void>;
  listPorts?(): Promise<PortInfo[]>;
}
```

**Key points:**
- `isInstalled()` returns the path if found, enabling custom paths
- `monitor` and `listPorts` are optional (some toolchains may not support them)
- All operations are async for consistency

### 3. Package Exports

The `package.json` uses Node.js subpath exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./types": "./dist/types.js",
    "./registry": "./dist/registry.js",
    "./arduino-cli": "./dist/arduino-cli.js",
    "./platformio": "./dist/platformio.js"
  }
}
```

**Usage patterns:**

```typescript
// Main import (includes everything)
import { resolveToolchain, ArduinoCliToolchain } from '@typecode/toolchain';

// Type-only import
import type { Toolchain, CompileOptions } from '@typecode/toolchain/types';

// Registry-only import (avoids loading implementations)
import { getToolchain } from '@typecode/toolchain/registry';

// Specific implementation
import { ArduinoCliToolchain } from '@typecode/toolchain/arduino-cli';
```

## Configuration Flow

### 1. User Configuration

```typescript
// typecode.config.ts
const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  
  toolchain: {
    type: 'arduino-cli',
    arduinoCli: {
      path: '/custom/path/to/arduino-cli',
      verbose: true,
    },
  },
};
```

### 2. Config Loading

```typescript
// packages/cli/src/config-loader.ts
export interface ResolvedTypecodeConfig {
  // ... other fields
  toolchain?: {
    type?: 'arduino-cli' | 'platformio';
    arduinoCli?: { path?: string; configFile?: string; verbose?: boolean };
    platformio?: { path?: string; env?: string };
  };
}

// AST-based parsing extracts toolchain config from typecode.config.ts
export function parseConfigFile(configPath: string): ResolvedTypecodeConfig | undefined {
  // ... walks object literal and extracts flat key/value pairs
  // Maps toolchain.type, toolchain.arduinoCli.path, etc.
}
```

### 3. Toolchain Resolution

```typescript
// In CLI command (e.g., build.ts)
import { resolveToolchain } from '@typecode/toolchain';

const config = loadTypecodeConfig(inputDir);
const toolchain = await resolveToolchain(config?.toolchain);

if (!toolchain) {
  console.error('No toolchain found. Install arduino-cli or platformio.');
  process.exit(1);
}

const result = await toolchain.compile({
  sketchPath: outputSketchPath,
  fqbn: config.fqbn,
  optimize: config.outputOptimize,
});
```

## Creating a Custom Toolchain

### Step 1: Implement the Interface

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
    // Check if your CLI/binary exists
    // Return path if found
  }

  async compile(options: CompileOptions): Promise<CompileResult> {
    // 1. Build command arguments from options
    // 2. Execute compiler
    // 3. Parse output for errors
    // 4. Return result
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    // Similar pattern to compile
  }
}
```

### Step 2: Register the Toolchain

```typescript
// my-toolchain.ts (at bottom)
import { registerToolchain } from '@typecode/toolchain/registry';
registerToolchain(new MyToolchain());
```

### Step 3: Use in Configuration

```typescript
// typecode.config.ts
const config: TypecodeConfig = {
  // ...
  toolchain: {
    type: 'my-toolchain',
  },
};
```

## Integration Points

### With @typecode/core

The core package defines the configuration schema:

```typescript
// packages/core/src/config.ts
export type ToolchainType = 'arduino-cli' | 'platformio' | string;

export interface TypecodeToolchainConfig {
  type?: ToolchainType;
  arduinoCli?: { path?: string; configFile?: string; verbose?: boolean };
  platformio?: { path?: string; env?: string };
}

export interface TypecodeConfig {
  // ... other fields
  toolchain?: TypecodeToolchainConfig;
}
```

### With @typecode/cli

The CLI package:
1. Loads configuration via `config-loader.ts`
2. Resolves toolchain via `resolveToolchain()`
3. Calls toolchain methods in commands (build, upload, monitor)

### With External Tools

| Toolchain | Binary | Install Method |
|-----------|--------|----------------|
| Arduino CLI | `arduino-cli` | `winget install Arduino.ArduinoCLI` |
| PlatformIO | `pio` | `pip install platformio` |

## Error Handling

Compile errors are parsed from GCC-style output:

```typescript
const GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;

function parseCompileErrors(output: string): CompileError[] {
  // Returns structured errors with file, line, column, severity, message
}
```

This enables IDE integration and source map lookups to trace errors back to TypeScript source.

## Testing

The toolchain package can be tested by:

1. **Mocking the spawn functions** for unit tests
2. **Using actual toolchains** for integration tests
3. **Checking isInstalled()** to skip tests if toolchain unavailable

```typescript
import { ArduinoCliToolchain } from '@typecode/toolchain/arduino-cli';

describe('ArduinoCliToolchain', () => {
  const toolchain = new ArduinoCliToolchain();
  
  beforeAll(async () => {
    const path = await toolchain.isInstalled();
    if (!path) {
      console.log('Skipping: arduino-cli not installed');
    }
  });
  
  it('should compile a sketch', async () => {
    // ...
  });
});
```

## Future Extensions

Potential additions to the toolchain system:

1. **Board core management** - `hasBoardCore()`, `installBoardCore()`
2. **Library management** - `installLibrary()`, `listLibraries()`
3. **Debug support** - `debug()`, `attachDebugger()`
4. **Multi-target builds** - Build for multiple boards in one command
5. **Toolchain auto-install** - Download and configure toolchains automatically