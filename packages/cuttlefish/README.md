# `@typecad/cuttlefish`

TypeScript → C++ transpiler for embedded firmware. Targets native (desktop),
Arduino, and bare-metal MCU builds from a single TypeScript codebase.

`cuttlefish` is the command-line tool at the center of the [TypeCAD](https://cuttlefish.typecad.net)
toolchain: it loads `cuttlefish.config.ts`, transpiles TypeScript firmware to
C++, and can chain compile, upload, and serial-monitor steps.

## Quick start

From a project root containing `cuttlefish.config.ts`:

```bash
npx cuttlefish build
npx cuttlefish build --compile --upload --port COM4
npx cuttlefish build --compile --upload --monitor --port COM4 --baud 115200
```

Scaffold a starter project with the built-in wizard:

```bash
npx cuttlefish create --board arduino:avr:uno --framework arduino
```

## Commands

| Command | Description |
| --- | --- |
| `cuttlefish build` | Transpile the entry file (default). Accepts `--compile`, `--upload`, `--monitor`, `--port`, `--baud`. |
| `cuttlefish create` | Generate a starter project and `cuttlefish.config.ts`. |
| `cuttlefish board-add` | Add a new board package via the board-codegen scaffolder. |
| `cuttlefish preview` | Launch the browser preview server for a UI project. |
| `cuttlefish map-error <mapFile>` | Map a C++ compiler error back to its TypeScript source location. |
| `cuttlefish gen-decls` | Generate type declaration stubs. |
| `cuttlefish gen-libdefs <input.ts>` | Generate library definition stubs for third-party imports. |

### Flags (for `build`)

- `--compile` — transpile, then compile via the active framework's toolchain (`arduino-cli` for Arduino, `g++` for native).
- `--upload` — flash firmware to the board (implies `--compile`).
- `--monitor` — open a serial monitor after upload.
- `--port <port>` — serial port for upload/monitor (e.g. `COM4`, `/dev/ttyUSB0`).
- `--baud <rate>` — serial monitor baud rate.

## Configuration

The CLI reads `cuttlefish.config.ts` from the current working directory and
treats it as the source of truth. When no config file is present, command-line
flags such as `--fqbn` and `--board` supply board and build settings.

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
};

export default config;
```

## Ecosystem

`@typecad/cuttlefish` is the transpiler core. It pairs with sibling packages:

- [`@typecad/hal`](https://cuttlefish.typecad.net) — hardware abstraction (GPIO, I2C, SPI, UART) as regular TypeScript.
- [`@typecad/ui`](https://cuttlefish.typecad.net) — HTML/CSS-driven graphics for microcontroller displays.
- [`@typecad/expect`](https://cuttlefish.typecad.net) — hardware test framework (vitest-style assertions over serial).
- [`@typecad/framework-arduino`](https://cuttlefish.typecad.net) — Arduino framework code-gen strategy.
- [`@typecad/framework-native`](https://cuttlefish.typecad.net) — native desktop C++ code-gen strategy.
- `@typecad/mcu-*` and `@typecad/board-*` — silicon- and board-level pin/peripheral definitions.

## License

MIT
