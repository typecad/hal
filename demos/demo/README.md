# ESP32-S3 debug demo

A small blink sketch (`src/main.ts`) that exercises TypeCAD's two debug paths
on an ESP32-S3, and serves as the canonical walkthrough for **native GDB
debugging** over the chip's built-in USB-Serial-JTAG.

- **Target:** ESP32-S3 (built-in USB-Serial-JTAG — one USB cable, no external probe)
- **Framework:** `@typecad/framework-esp32` → native ESP-IDF (`idf.py`)
- **Sketch:** toggles the LED every 250 ms, exposes module-scope state
  (`toggles`, `lastReport`) and a function with locals (`toggleLed` → `now`),
  and marks interesting breakpoints with `// ← breakpoint` / `// ← logpoint`.

## Debugging

### Native GDB debugging (ESP32-S3, recommended)

`cuttlefish build --debug` on `esp32s3` takes the GDB path: it emits `#line`
directives in the generated C++ (so GDB maps execution back to the `.ts`
source) and writes the VS Code + OpenOCD configs. VS Code only reads
`.vscode/` from the workspace root, so the config lands at the git root
(the folder you open in VS Code), with paths expressed relative to it:

```
<repo-root>/.vscode/launch.json              ← VS Code reads this for F5
<repo-root>/.vscode/tasks.json               ← preLaunchTask: build+flash+openocd
demos/demo/src/out-esp32s3/.cuttlefish/openocd.cfg     ← board/esp32s3-builtin.cfg
demos/demo/src/out-esp32s3/sdkconfig.defaults.debug    ← -Og, asserts, LTO off
demos/demo/src/out-esp32s3/.cuttlefish/.cuttlefish-gdb.py  ← _isr_N frame filter (if any)
```

**To debug:**

1. Install **one** of these VS Code extensions (either works — `launch.json`
   ships both configs and you pick whichever in the Run and Debug dropdown):
   - **ESP-IDF extension** (`espressif.esp-idf-extension`) — provides the
     `gdbtarget` debug type. Bundles OpenOCD + the xtensa GDB, but requires
     ESP-IDF itself to be configured in the extension's settings.
   - **cortex-debug** (`marus25.cortex-debug`) — provides the `cortex-debug`
     debug type and self-manages OpenOCD. Lighter weight; you'll need OpenOCD
     and the xtensa GDB on PATH (an ESP-IDF install puts them there).
2. Set the board's serial port in `cuttlefish.config.ts` (`console.port` —
   e.g. `'COM10'` on Windows, `'/dev/ttyACM0'` on Linux), or pass `--port`.
3. Open the **repository root** in VS Code (not the `demos/demo` subfolder —
   that's the most common reason F5 falls back to the Node.js picker and the
   debug controls flash on then off). Run `npm run upload` once from
   `demos/demo/` so the configs get written, then press **F5**.

What happens on F5:

- The `preLaunchTask` (`cuttlefish: debug prep`) runs two tasks in parallel:
  build + flash (`cuttlefish build --compile --upload --debug --port ...`),
  and start OpenOCD (which binds the JTAG port on 3333).
- Once both succeed, the `gdbtarget` adapter attaches GDB to OpenOCD.
- Breakpoints you set as red dots in `main.ts` stop on the chip. Step, step-in,
  step-out, call stack, and watch all work. Variables show their **TypeScript
  names** — the transpiler doesn't mangle them.
- Hoisted `_isr_N` frames (from anonymous lambdas passed as arguments) are
  relabeled to `<lambda> @ file:line` by the generated `.cuttlefish-gdb.py`.

**OS notes:**
- **Linux:** copy OpenOCD's udev rules into `/etc/udev/rules.d/` first.
- **Windows:** the ESP32-S3 USB-Serial-JTAG composite device may need its
  driver installed (most devkits work with the inbox driver).

### Printf instrumentation (fallback, other targets)

On targets without native GDB support (Arduino, other ESP32 variants),
`--debug` instead injects `printf`/`Serial` instrumentation at the
`// ← breakpoint` / `// ← logpoint` lines:

```bash
npm run upload    # cuttlefish build --compile --upload --port <port> --monitor --debug
```

Keep the monitor attached and press ENTER to continue past each breakpoint, or
`S` to skip it for the rest of the run. See
`packages/vscode-typecad-debug/README.md` for the breakpoint/logpoint schema.

## Other scripts

```bash
npm run build       # transpile TS -> C++ only
npm run compile     # transpile + compile with idf.py
npm run lint        # ESLint with the cuttlefish transpiler-rules plugin
```
