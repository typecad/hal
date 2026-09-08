# `@typecad/cuttlefish`

TypeScript → C++ transpiler for embedded firmware. Targets native (desktop)
and Zephyr-supported embedded boards from a single TypeScript codebase.

`cuttlefish` is the command-line tool at the center of the [TypeCAD](https://cuttlefish.typecad.net)
toolchain: it loads `cuttlefish.config.ts`, transpiles TypeScript firmware to
C++, and can chain compile, upload, and serial-monitor steps.

## Quick start

From a project root containing `cuttlefish.config.ts`:

```bash
npx @typecad/cuttlefish build
npx @typecad/cuttlefish build --compile --upload --port COM4
npx @typecad/cuttlefish build --compile --upload --monitor --port COM4 --baud 115200
```

Scaffold a starter project with the built-in wizard:

```bash
npx @typecad/cuttlefish create --board esp32s3
```

## Commands

| Command | Description |
| --- | --- |
| `cuttlefish build` | Transpile the entry file (default). Accepts `--compile`, `--upload`, `--monitor`, `--port`, `--baud`. |
| `cuttlefish create` | Generate a starter project and `cuttlefish.config.ts`. |
| `cuttlefish preview` | Launch the browser preview server for a UI project. |
| `cuttlefish gen-decls <file.h\|file.cpp\|--all <dir>>` | Generate `.d.ts` declaration stubs from C++ headers. |
| `cuttlefish doctor` | Check the active framework's environment (e.g. toolchain + board support). |
| `cuttlefish licenses [--all] [--strict]` | Scan this project's libraries for SPDX licenses. |
| `cuttlefish board sync [zephyr-base]` | Rebuild the local board catalog from your Zephyr tree's board DTS files. The catalog is machine-local — there is no compiled-in board database; builds create and refresh it automatically, this command forces a rebuild. |
| `cuttlefish board regen` | Regenerate the project-local board module (`.cuttlefish/board.ts` + `board.json`). Builds also regenerate it automatically whenever any input changes (config board, catalog, or Zephyr tree). |
| `cuttlefish library <search\|install\|init\|validate>` | The cuttlefish library package manager (npm keywords are the catalog). |

### Flags (for `build`)

- `--compile` — transpile, then compile via the active framework's toolchain (`west` for Zephyr, `g++` for native).
- `--upload` — flash firmware to the board (requires `--compile`).
- `--monitor` — open a serial monitor after upload.
- `--port <port>` — serial port for upload/monitor (e.g. `COM4`, `/dev/ttyUSB0`).
- `--baud <rate>` — serial monitor baud rate.

## Configuration

The CLI reads `cuttlefish.config.ts` from the current working directory and
treats it as the source of truth. When no config file is present, command-line
flags such as `--board` and `--build-target` supply board and build settings.

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  board: 'xiao_ble/nrf52840',
  framework: '@typecad/framework-zephyr',
};

export default config;
```

## Ecosystem

`@typecad/cuttlefish` is the transpiler core. It pairs with sibling packages:

- [`@typecad/hal`](https://cuttlefish.typecad.net) — hardware abstraction (GPIO, I2C, SPI, UART) as regular TypeScript.
- [`@typecad/ui`](https://cuttlefish.typecad.net) — HTML/CSS-driven graphics for microcontroller displays.
- [`@typecad/framework-zephyr`](https://cuttlefish.typecad.net) — Zephyr RTOS framework (build, flashing, and the bundled Zephyr toolchain installer).

Built in, no separate package: the hardware test runner (`cuttlefish test` —
the DSL ships in `@typecad/hal` under `@typecad/hal/testing`), the
**native** desktop target (`framework:
'@typecad/framework-native'` resolves inside cuttlefish) and the **safety**
engine (verified GPIO reads, ISO 26262 analysis — author via
`@typecad/cuttlefish/safety`).

## License

MIT
