---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/hal': minor
---

Remove the printf/Serial.print breakpoint debugging feature entirely. `--debug` is now the native source-level (GDB) flow only: it builds with debug-oriented flags and the VS Code F5 artifacts for boards whose probe facts carry a debug-capable method (openocd/jlink — 74% of the board catalog), and fails with an explicit `debug-unsupported-target` diagnostic on bootloader-only boards instead of silently building an un-debuggable binary.

- The breakpoint instrumentation pipeline is gone: `.typecad-hal/breakpoints.json` (loader, preprocessor, per-type variable dumps, conditional breakpoints, logpoints, the `__tc_debug_wait_for_continue` halt shim and its ENTER/s serial protocol) no longer exists in the engine or the Zephyr framework, and `PlatformDebugStrategy.debugMode()` now answers `'gdb' | 'none'`.
- The VS Code extension loses the breakpoint-sync commands (`toggleBreakpoint`/`clearAllBreakpoints`/`debugWithBreakpoints`/`syncBreakpoints`, the F9 keybinding, and the editor context menu). C++ → `.d.ts` declaration generation stays (`typecad-debug.generateDeclaration` keeps its historical id), and F5/GDB debugging is unchanged (launch.json/tasks written by the engine).
- Print-state debugging via the serial console (`USB0.writeLine(...)` / `UART0.writeLine(...)` from the board module) works on every board and is the recommended replacement for quick value reporting.
