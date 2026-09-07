---
'@typecad/framework-zephyr': patch
---

debug: launch.json no longer bakes the generating machine's checkout path into GDB commands. `set directories <absolute workspace path>` became `set directories .` and the gdb frame-filter `source` line became app-relative — cortex-debug spawns GDB with cwd from the config's `cwd` field (`${workspaceFolder}`), so relative paths resolve to the same directory the absolute form named, on every machine and every checkout location. (A `${workspaceFolder}` literal in these command strings was not an option: cortex-debug does no variable expansion in postAttachCommands, and on Windows the expansion would carry backslashes GDB reads as escape sequences.) Tool paths (gdbPath/serverpath) stay absolute on purpose — they are machine-local SDK facts, rewritten by the first `--debug` build on each machine.
