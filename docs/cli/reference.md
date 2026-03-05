# CLI Reference

Complete command reference for the TypeCode CLI.

## Commands

```
typecode <input.ts> [options]
typecode gen-decls <input.cpp>
typecode gen-decls --scan-dir <directory>
typecode gen-libdefs <input.ts>
typecode map-error <mapFile> [options]
```

## Transpile Command

### Basic Usage

```bash
npx typecode sketch.ts [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--emit cpp\|split` | `split` | `split`: separate `.cpp`+`.h`; Arduino target always emits a single `.ino` |
| `--target arduino\|generic` | `generic` | Auto-set to `arduino` when `--compile`, `--upload`, or `--monitor` is used |
| `--outDir <path>` | input file directory | Output directory for generated files |
| `--emit-maps true\|false` | `true` | Write `.tscppmap.json` source map sidecars |
| `--fqbn <package:arch:board>` | *(from config)* | Fully Qualified Board Name; required for `--compile` when no config file is present |

### Arduino Chaining Options

| Flag | Requires | Description |
|------|----------|-------------|
| `--compile` | `fqbn` (config or `--fqbn`) | Run `arduino-cli compile` after transpilation |
| `--upload` | `--compile`, `--port` | Upload compiled sketch to the board |
| `--monitor` | `--port` | Open serial monitor after upload |
| `--port <port>` | — | Serial port, e.g. `COM4` or `/dev/ttyACM0` |
| `--baud <rate>` | `9600` | Baud rate for `--monitor` |
| `--debug` | — | Enable debug mode; injects breakpoint instrumentation from `.typecode/breakpoints.json` |

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
npx typecode sketch.ts
```

Output: `sketch.ino` (or `sketch.cpp` + `sketch.h`)

### Transpile with Custom Output Directory

```bash
npx typecode sketch.ts --outDir ./build
```

### Transpile + Compile

```bash
npx typecode sketch.ts --compile
```

Requires `fqbn` in `typecode.config.ts` or via `--fqbn` flag.

### Transpile + Compile + Upload

```bash
npx typecode sketch.ts --compile --upload --port COM4
```

### Full Chain with Serial Monitor

```bash
npx typecode sketch.ts --compile --upload --monitor --port COM4 --baud 115200
```

### Debug with Breakpoints

```bash
npx typecode sketch.ts --compile --upload --monitor --port COM4 --debug
```

See [Debug](../debug/) for breakpoint-based debugging documentation.

### Disable Tree-Shaking

```bash
npx typecode sketch.ts --no-tree-shake
```

### Keep Unused Enums

```bash
npx typecode sketch.ts --keep-unused-enums
```

## gen-libdefs Command

Generate library definition stubs for third-party imports:

```bash
npx typecode gen-libdefs src/sensor.ts
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
npx typecode gen-decls lib/sensor.cpp

# Scan a directory and generate for all C++ files missing declarations
npx typecode gen-decls --scan-dir src/lib
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

The TypeCode VSCode extension provides:

- **Auto-generation on save**: When you save a `.cpp` file without a corresponding `.d.ts`
- **Command Palette**: "TypeCode: Generate Declaration" command for manual generation

## map-error Command

Map C++ compiler errors back to TypeScript source:

```bash
npx typecode map-error out/sketch/sketch.ino.tscppmap.json --line 42 --column 5 --message "undefined reference"
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

The CLI reads configuration from `typecode.config.ts` in the same directory as the input file:

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

See [Configuration](./configuration.md) for complete options.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYPECODE_DEBUG` | Enable debug logging |
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