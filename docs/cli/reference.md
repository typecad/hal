# CLI Reference

Complete command reference for the TypeHAL CLI.

## Commands

```
typehal <input.ts> [options]
typehal build [options]
typehal gen-decls <input.cpp>
typehal gen-decls --scan-dir <directory>
typehal gen-libdefs <input.ts>
typehal map-error <mapFile> [options]
```

## Build Command

Builds a project using the entry point from `typehal.config.ts`. Requires the `entry` field in the config file.

```bash
npx typehal build [options]
```

This resolves the entry file from `typehal.config.ts`, discovers the full import graph, and transpiles all TypeScript files in dependency order. It supports all the same options as the transpile command.

### Options

The build command accepts all [Transpile Options](#options) plus:

| Flag | Description |
|------|-------------|
| `--watch`, `-w` | Watch for file changes and rebuild automatically |
| `--compile` | Run `arduino-cli compile` after transpilation |
| `--upload` | Upload compiled sketch (requires `--compile`, `--port`) |
| `--monitor` | Open serial monitor after upload |
| `--port <port>` | Serial port (e.g. `COM4` or `/dev/ttyACM0`) |
| `--baud <rate>` | Baud rate for serial monitor (default: `9600`) |
| `--debug` | Enable debug mode with breakpoint instrumentation |

### Example

```bash
# Build and compile
npx typehal build --compile

# Build, compile, and upload
npx typehal build --compile --upload --port COM4

# Build with watch mode
npx typehal build --watch
```

See [Multi-File Projects](../transpiler/README.md#multi-file-projects) for details on project structure.

## Transpile Command

### Basic Usage

```bash
npx typehal sketch.ts [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--emit cpp\|split` | `split` | `split`: separate `.cpp`+`.h`; Arduino target always emits a single `.ino` |
| `--target arduino\|generic` | `generic` | Auto-set to `arduino` when `--compile`, `--upload`, or `--monitor` is used |
| `--outDir <path>` | input file directory | Output directory for generated files |
| `--emit-maps true\|false` | `true` | Write `.thcppmap.json` source map sidecars |
| `--fqbn <package:arch:board>` | *(from config)* | Fully Qualified Board Name; required for `--compile` when no config file is present |

### Arduino Chaining Options

| Flag | Requires | Description |
|------|----------|-------------|
| `--compile` | `fqbn` (config or `--fqbn`) | Run `arduino-cli compile` after transpilation |
| `--upload` | `--compile`, `--port` | Upload compiled sketch to the board |
| `--monitor` | `--port` | Open serial monitor after upload |
| `--port <port>` | — | Serial port, e.g. `COM4` or `/dev/ttyACM0` |
| `--baud <rate>` | `9600` | Baud rate for `--monitor` |
| `--debug` | — | Enable debug mode; injects breakpoint instrumentation from `.typehal/breakpoints.json` |

### Tree-Shaking Options

| Flag | Description |
|------|-------------|
| `--no-tree-shake` | Disable tree-shaking entirely |
| `--keep-unused-enums` | Keep all enums even if not referenced |
| `--keep-unused-classes` | Keep all classes even if not instantiated |
| `--keep-unused-types` | Keep all type aliases even if not used |
| `--keep-unused-variables` | Keep all top-level variables even if not referenced |
| `--no-report-unused` | Suppress diagnostics for removed code |
| `--entry-point <name>` | Add a custom entry point (repeatable) |

Default entry points: `setup`/`loop` (Arduino target), `main` (generic target).

## Examples

### Transpile Only

```bash
npx typehal sketch.ts
```

Output: `sketch.ino` (or `sketch.cpp` + `sketch.h`)

### Transpile with Custom Output Directory

```bash
npx typehal sketch.ts --outDir ./build
```

### Transpile + Compile

```bash
npx typehal sketch.ts --compile
```

Requires `fqbn` in `typehal.config.ts` or via `--fqbn` flag.

### Transpile + Compile + Upload

```bash
npx typehal sketch.ts --compile --upload --port COM4
```

### Full Chain with Serial Monitor

```bash
npx typehal sketch.ts --compile --upload --monitor --port COM4 --baud 115200
```

### Debug with Breakpoints

```bash
npx typehal sketch.ts --compile --upload --monitor --port COM4 --debug
```

See [Debug](../debug/) for breakpoint-based debugging documentation.

### Disable Tree-Shaking

```bash
npx typehal sketch.ts --no-tree-shake
```

### Keep Unused Enums

```bash
npx typehal sketch.ts --keep-unused-enums
```

## gen-libdefs Command

Generate library definition stubs for third-party imports:

```bash
npx typehal gen-libdefs src/sensor.ts
```

Creates `<module>.libdef.json` files alongside the source:

```json
{
  "module": "wire",
  "include": "<Wire.h>",
  "symbols": { "Wire": "Wire" },
  "variants": [
    {
      "when": { "target": "arduino", "architecture": "esp32" },
      "include": "<Wire.h>",
      "symbols": { "Wire": "Wire" }
    }
  ]
}
```

### Library Definition Schema

| Field | Type | Description |
|-------|------|-------------|
| `module` | string | TypeScript module name |
| `include` | string | C++ `#include` directive |
| `symbols` | object | Map of TS names to C++ names |
| `variants` | array | Architecture-specific overrides |

## gen-decls Command

Generate TypeScript declaration files (`.d.ts`) from C++ source files:

```bash
# Generate for a single C++ file
npx typehal gen-decls lib/sensor.cpp

# Scan a directory and generate for all C++ files missing declarations
npx typehal gen-decls --scan-dir src/lib
```

### How It Works

The `gen-decls` command parses C++ header-style definitions and generates TypeScript declaration files:

**Input (lib/sensor.cpp):**
```cpp
#include <Arduino.h>

#define SENSOR_ADDRESS 0x76

class Sensor {
public:
  Sensor(int address = 0x76);
  bool begin();
  int readTemperature();
  int readHumidity();
};
```

**Output (lib/sensor.d.ts):**
```typescript
export declare const SENSOR_ADDRESS: number;

export declare class Sensor {
  constructor(address?: number);
  begin(): boolean;
  readTemperature(): number;
  readHumidity(): number;
}
```

### Auto-Generation

The CLI automatically generates declaration files when:

1. You import a C++ module in TypeScript
2. The corresponding `.d.ts` file doesn't exist
3. The transpiler detects the missing module error

```
  Auto-generated: lib/sensor.d.ts
  from C++ source: lib/sensor.cpp
  Review the generated types and adjust if needed.
```

### Options

| Flag | Description |
|------|-------------|
| `--scan-dir <path>` | Scan directory for C++ files missing `.d.ts` files |

### VSCode Integration

The TypeHAL VSCode extension provides:

- **Auto-generation on save**: When you save a `.cpp` file without a corresponding `.d.ts`
- **Command Palette**: "TypeHAL: Generate Declaration" command for manual generation

## map-error Command

Map C++ compiler errors back to TypeScript source:

```bash
npx typehal map-error out/sketch/sketch.ino.thcppmap.json --line 42 --column 5 --message "undefined reference"
```

### Options

| Flag | Description |
|------|-------------|
| `--line <n>` | C++ error line number |
| `--column <n>` | C++ error column number |
| `--message <text>` | Error message to include in output |

### Output

```
TypeScript Source: src/sketch.ts
Line: 15, Column: 8
Node Kind: CallExpression
Context: myFunction()
```

## Configuration File

The CLI reads configuration from `typehal.config.ts` in the same directory as the input file:

```typescript
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board: '@typehal/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },
};

export default config;
```

See [Configuration](./configuration.md) for complete options.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYPEHAL_DEBUG` | Enable debug logging |
| `ARDUINO_CLI_PATH` | Path to arduino-cli binary |
| `PLATFORMIO_CORE_DIR` | PlatformIO core directory |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | Transpilation error |
| 2 | Configuration error |
| 3 | Compilation error |
| 4 | Upload error |