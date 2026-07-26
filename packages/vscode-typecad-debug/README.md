# TypeCAD Debug

A Visual Studio Code extension that bridges VSCode's breakpoint gutter to the
TypeCAD `Serial.print` debug pipeline. Set breakpoints in your `.ts` source;
this extension syncs them to `.cuttlefish/breakpoints.json`, which the
`@typecad/cuttlefish` transpiler reads (when run with `--debug`) to inject
`Serial.println` instrumentation that reports variable values and lets you
step through execution.

This is the producer half of a two-part system. The consumer half lives in
[`@typecad/cuttlefish`](../../packages/cuttlefish/src/debug/) and is the
authoritative source for the on-disk schema and matching behavior described
below.

## Install

This package is `private: true` and is **not** published to the npm registry
or the VS Code Marketplace. Build the VSIX locally:

```sh
cd packages/vscode-typecad-debug
npm install
npm run compile
npm run package        # produces vscode-typecad-debug-0.2.0.vsix
code --install-extension vscode-typecad-debug-0.2.0.vsix
```

## Usage

1. Open the Command Palette (`Ctrl/Cmd+Shift+P`).
2. Run **TypeCAD: Debug with Breakpoints** — or set red-dot breakpoints in the
   gutter and run `cuttlefish build --debug` in a terminal.
3. Breakpoints (including conditional breakpoints and logpoints) are written
   to `.cuttlefish/breakpoints.json` on every breakpoint change and on every
   `.ts` save.
4. Upload the instrumented firmware and open a serial monitor (`--monitor`).
   At each breakpoint the firmware prints the location, the original source
   line, and the variables in scope, then halts. Two keys are available:
   - **ENTER** — continue (the breakpoint will halt here again the next time
     execution reaches it).
   - **`s`** — skip this breakpoint for the rest of the run: it won't halt
     here again until the device reboots. Other breakpoints are unaffected.

### Commands

| Command | Title |
|---|---|
| `typecad-debug.toggleBreakpoint` | TypeCAD: Toggle Breakpoint (bound to `F9` in `.ts` files) |
| `typecad-debug.clearAllBreakpoints` | TypeCAD: Clear All Breakpoints |
| `typecad-debug.debugWithBreakpoints` | TypeCAD: Debug with Breakpoints |
| `typecad-debug.syncBreakpoints` | TypeCAD: Sync Breakpoints from VS Code |
| `typecad-debug.generateDeclaration` | TypeCAD: Generate Declaration from C++ |

### Enabling instrumentation

Breakpoints are only injected when cuttlefish is run with `--debug`:

```sh
cuttlefish build --debug                                    # uses cuttlefish.config.ts entry
cuttlefish src/index.ts --debug --framework @typecad/framework-arduino --compile --upload --port COM4
```

See `cuttlefish --help` for the full `--debug` description.

## `.cuttlefish/breakpoints.json` schema

The file lives at the project root (or any ancestor of the entry file's
directory). Each entry uses **the basename** of the source file as `file`
(this is the only path form that matches reliably on both Windows and POSIX
under cuttlefish's basename-matching loader):

```jsonc
{
  "breakpoints": [
    { "file": "index.ts", "line": 12 },
    { "file": "index.ts", "line": 27, "condition": "counter > 5" },
    { "file": "sensor.ts", "line": 8, "logMessage": "reading = {value}" }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | string | yes | Source file **basename** (e.g. `index.ts`). |
| `line` | number | yes | 1-indexed line number. `0` is dropped. |
| `condition` | string | no | Conditional expression; `===`/`!==` are auto-normalized to `==`/`!=` for C++. |
| `logMessage` | string | no | Logpoint with `{variable}` interpolation. When present, the breakpoint logs instead of halting. |

Two source files sharing the same basename in one project will share
breakpoints — acceptable for typical single-sketch Arduino projects.

## Native debugging on ESP32-S3

For ESP32-S3, this extension's printf instrumentation is superseded by a
native GDB path. `cuttlefish build --debug` on `esp32s3` emits `#line`
directives in the generated C++ and writes `.vscode/launch.json` +
`tasks.json` (at the git/workspace root, where VS Code reads them) plus
`openocd.cfg` + `sdkconfig.defaults.debug` next to the build output. Press
**F5** in VS Code and the generated config attaches GDB to the chip's
built-in USB-Serial-JTAG — one USB cable, no external probe.

`launch.json` ships a single **`gdbtarget`** configuration, provided by the
ESP-IDF VS Code extension. The extension's gdbtarget adapter manages OpenOCD
itself (via its OpenOCD Manager, reading `idf.openOcdConfigs` from settings).
The `preLaunchTask` is just `build + flash` — no competing OpenOCD process.
Install the ESP-IDF extension (which bundles OpenOCD + the xtensa GDB, and
requires ESP-IDF itself configured), set the board's serial port in
`cuttlefish.config.ts` (`console.port`) or pass `--port`. See
`demos/demo/README.md` for the full F5 flow.

The printf instrumentation documented below remains the path for targets that
don't yet support native debugging (Arduino, other ESP32 variants).

## Limitations

- This is a `Serial.print`-based instrumentation shim, not a DAP debug
  adapter. There is no native step/step-in/step-out — each breakpoint halts
  until ENTER (continue) or `s` (skip this breakpoint for the run) is received
  over serial. **On ESP32-S3, use the native GDB path above instead** — it
  provides full stepping, call stacks, and TS-named variable inspection.
- The scope analyzer captures module-scope identifiers plus locals and
  parameters in the enclosing function. Member access and arbitrary
  expressions are not resolved; `{ value }` in a logpoint emits the literal
  `"{value}"` if `value` is not in scope.
- Baud rate is hardcoded to `9600` in the injected `Serial.begin` regardless
  of the CLI `--baud` value.
- **Target-specific output:** on Arduino/AVR the injected code uses `Serial.*`
  and blocks on `Serial.available()`. On ESP-IDF (`@typecad/framework-esp32`)
  it routes through native `printf` and blocks on `getchar()` with the task
  watchdog fed — so an ESP32 debug build must have `idf.py monitor` (or
  equivalent) attached, or it will hang at the first breakpoint until power
  is cycled. This is the ESP-IDF equivalent of "no IDE attached to a
  breakpoint."
