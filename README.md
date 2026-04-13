# TypeCode — TypeScript to C++ Transpiler

AST-based Node/npm tool that transpiles TypeScript into C++ (or Arduino `.ino`) output.

---

## Quick start

### 1. Configure the board

Create `typecode.config.ts` in the same directory as your sketch:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board:  '@typecode/board-arduino-uno',
  fqbn:   'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

Available board packages:

| Package | FQBN | `target` |
|---|---|---|
| `@typecode/board-arduino-uno` | `arduino:avr:uno` | `avr` |
| `@typecode/board-arduino-nano33iot` | `arduino:samd:nano_33_iot` | `samd` |
| `@typecode/board-esp32-devkit` | `esp32:esp32:esp32doit-devkit-v1` | `esp32` |

### 2. Write your sketch

Import pins, peripherals, and utilities from the virtual `@typecode` specifier — the transpiler resolves it to your configured board package:

```typescript
import { LED, delay, HIGH } from '@typecode';

LED.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
```

### 3. Transpile

```bash
npm run build

# Transpile only
npx typecode sketch.ts

# Transpile + compile (fqbn comes from typecode.config.ts)
npx typecode sketch.ts --compile

# Transpile + compile + upload
npx typecode sketch.ts --compile --upload --port COM4

# Full chain: transpile → compile → upload → monitor
npx typecode sketch.ts --compile --upload --monitor --port COM4 --baud 115200
```

The `fqbn` is read automatically from `typecode.config.ts`. Pass `--fqbn` on the command line only when there is no config file and you need a one-off override.

### 4. Editor type checking

When you run the transpiler for the first time, it auto-generates `typecode-env.d.ts` next to your config file:

```typescript
// typecode-env.d.ts — auto-generated, do not edit
declare module '@typecode' {
  export * from '@typecode/board-arduino-uno';
}
```

TypeScript's language server discovers this file automatically, resolving the `@typecode` virtual import without any `tsconfig.json` changes. The file is regenerated whenever the transpiler runs, keeping it in sync if you change boards.

### 5. Board-aware safety

TypeCode uses your configured board definition during transpilation, so it can warn about hardware mistakes before you flash code:

- `unsafe-pin-usage`: using pins marked risky on the current board, such as `D0` and `D1` on Uno while `UART0` is in play
- `peripheral-pin-conflict`: reusing pins that belong to an enabled peripheral, such as `A4`/`A5` for I2C or `D11`/`D12`/`D13` for SPI
- `pulldown-not-supported`: requesting hardware features the board does not have
- suspicious peripheral units: values that look like `kHz` or UART baud values passed where `Hz` are expected

On Arduino Uno specifically, keep these constraints in mind early:

- `D0` / `D1`: UART0 RX/TX
- `A4` / `A5`: I2C0 SDA/SCL
- `D11` / `D12` / `D13`: SPI0 MOSI/MISO/SCK

The intent is not to mimic Arduino's API surface. TypeCode leans on board metadata and static analysis so the editor and transpiler can explain conflicts before they become runtime debugging sessions.

---

## Commands

```
typecode <input.ts> [options]
typecode gen-libdefs <input.ts>
typecode map-error <mapFile> [options]
```

### Transpile options

| Flag | Default | Description |
|---|---|---|
| `--emit cpp\|split` | `split` | `split`: separate `.cpp`+`.h`; Arduino target always emits a single `.ino` |
| `--target arduino\|generic` | `generic` | Auto-set to `arduino` when `--compile`, `--upload`, or `--monitor` is used |
| `--outDir <path>` | input file directory | Output directory for generated files |
| `--emit-maps true\|false` | `true` | Write `.tscppmap.json` source map sidecars |
| `--fqbn <package:arch:board>` | *(from config)* | Fully Qualified Board Name; required for `--compile` when no config file is present |

### Arduino chaining (left to right, each requires the previous)

| Flag | Requires | Description |
|---|---|---|
| `--compile` | `fqbn` (config or `--fqbn`) | Run `arduino-cli compile` after transpilation |
| `--upload` | `--compile`, `--port` | Upload compiled sketch to the board |
| `--monitor` | `--port` | Open serial monitor after upload |
| `--port <port>` | — | Serial port, e.g. `COM4` or `/dev/ttyACM0` |
| `--baud <rate>` | — | Baud rate for `--monitor` (default: `9600`) |

### Tree-shaking options

Dead code elimination is enabled by default.

| Flag | Description |
|---|---|
| `--no-tree-shake` | Disable tree-shaking entirely |
| `--keep-unused-enums` | Keep all enums even if not referenced |
| `--keep-unused-classes` | Keep all classes even if not instantiated |
| `--keep-unused-types` | Keep all type aliases even if not used |
| `--keep-unused-variables` | Keep all top-level variables even if not referenced |
| `--no-report-unused` | Suppress diagnostics for removed code |
| `--entry-point <name>` | Add a custom entry point (repeatable) |

Default entry points: `setup`/`loop` (Arduino target), `main` (generic target).

---

## Mapping compiler errors

```bash
npx typecode map-error out/sketch/sketch.ino.tscppmap.json --line 42 --column 5 --message "undefined reference"
```

Prints the mapped TypeScript file, line, column, and node kind for the given C++ error location.

---

## Library definitions

Use `gen-libdefs` to create starter metadata stubs for third-party imports:

```bash
npx typecode gen-libdefs src/sensor.ts
```

Outputs `<module>.libdef.json` files alongside the source. These map TypeScript imports to C++ `#include` directives. Conditional variants allow architecture-specific overrides:

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

---

## Arduino target behaviour

- Output is always a single `.ino` sketch file (the `--emit` mode is ignored for Arduino targets).
- Stale generated artifacts (`.ino`, `.h`, `.cpp`, `.tscppmap.json`) in the output folder are removed automatically before each run to prevent duplicate-symbol errors.
- `Board.LED` resolves to the correct pin number for the configured board via constants folded from the board package's `BoardDefinition`.
- `PinMode` and `InterruptMode` enum class definitions are wrapped in `#if !defined(ARDUINO_API_VERSION)` guards automatically to prevent redefinition errors on new-API boards (SAMD, nRF52, RP2040-mbed).
