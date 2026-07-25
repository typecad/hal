// ---------------------------------------------------------------------------
// main.ts — ESP32-S3 debug demo
//
// A small blink sketch that exercises TypeCAD's debug paths.
//
// ── Real debugging (GDB over USB-Serial-JTAG) ─────────────────────────────
// ESP32-S3 has built-in USB-Serial-JTAG: one USB cable, no external probe.
// `cuttlefish build --debug` on esp32s3 emits #line directives in the
// generated C++ and writes .vscode/launch.json + tasks.json + openocd.cfg
// under src/out-esp32s3/. To debug:
//
//   1. Install the ESP-IDF VS Code extension (bundles OpenOCD + xtensa GDB +
//      the gdbtarget debug adapter — nothing extra to install).
//   2. Set this project's port in cuttlefish.config.ts (console.port), or
//      pass --port. The generated tasks.json threads it into flash.
//   3. Open this folder in VS Code and press F5. The preLaunchTask builds +
//      flashes and starts OpenOCD; gdbtarget attaches; breakpoints you set
//      in this .ts file stop on the chip. Variables show their TS names
//      (the transpiler doesn't mangle them). Hoisted _isr_N frames, if any,
//      are relabeled by the generated .cuttlefish-gdb.py.
//
// On Linux, copy OpenOCD's udev rules to /etc/udev/rules.d first. On Windows
// the ESP32-S3 USB-Serial-JTAG driver may need installing depending on the
// board. See packages/vscode-typecad-debug/README.md for more.
//
// ── Printf instrumentation (other targets) ────────────────────────────────
// On targets without native GDB support (Arduino, other ESP32 variants),
// `--debug` falls back to printf/Serial instrumentation: set red-dot
// breakpoints or logpoints on the lines marked `// ← breakpoint` /
// `// ← logpoint`, run `cuttlefish build --debug`, and keep `idf.py monitor`
// (or Serial Monitor) attached — press ENTER to step past each breakpoint.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

import { LED } from '@typecad/board-esp32s3';
import { delay, millis } from '@typecad/hal';

// Module-scope state — visible in every breakpoint's variable dump.
const led = LED.asOutput();
let toggles = 0;          // ← breakpoint: watch the counter accumulate
let lastReport = 0;       // millis() of the last status logpoint

/** Toggle the LED and return the new state. A breakpoint here also captures
 *  the `on` parameter and the `now` local. */
function toggleLed(on: boolean): boolean {
  led.write(on);
  const now = millis();           // ← breakpoint: function-scope locals
  return !on;
}

// Main loop. The breakpoints below sit on the most interesting moments: the
// toggle decision, the boundary crossing, and the periodic status report.
while (true) {
  const on = (toggles % 2) === 0;
  toggleLed(on);                  // logpoint: "toggle #{toggles} on={on}"

  if (toggles > 0 && toggles % 10 === 0) {   // ← breakpoint: every 10th toggle
    // (conditional breakpoints are supported — set condition `toggles === 50`
    //  on the line above to halt only on the 50th.)
  }

  // Report once per second using a logpoint so the loop keeps running.
  const now = millis();
  if (now - lastReport >= 1000) {            // logpoint: "uptime {now}ms, toggles {toggles}"
    lastReport = now;
  }

  toggles = toggles + 1;
  delay(250);
}
