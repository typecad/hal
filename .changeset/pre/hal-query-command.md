---
"@typecad/cuttlefish": minor
---

feat: `typecad-hal query` — agent-friendly, read-only inspection of a firmware project, ported from the PCB repo's `typecad-pcb query`. `typecad-hal query <summary|pins|peripherals|tasks|memory|modules|diagnostics> [entry] [--json] [--board <id>] [--framework <pkg>]` answers design questions without grepping source: GPIO assignments with inferred modes, peripheral allocations (UART/I2C/SPI/ADC/PWM/USB with devicetree labels), async tasks and ISR handlers, static-RAM estimate with deepest call paths, the import graph, and transpiler diagnostics. Every subject emits both a pretty view and a stable JSON payload; the entry defaults to typecad-hal.config.ts.

The analysis mirrors transpile's setup and IR stages (graph walk, cross-module class registry, per-file ProgramIR, board-constant scan) but stops before emit, type-checking, and lint — nothing is written to disk, and `build` remains the correctness gate. `loadPlatformStrategy` is now exported so the query pass resolves strategies exactly like a build.

Fix uncovered by exercising query against a full-featured project: the I2C register verbs (`writeReg`/`readReg`/`updateReg`) resolved their `reg`/`value`/`mask` arguments strictly as compile-time numerics, so any runtime expression (a variable or ternary like `cond ? 1 : 0`) made the whole `i2c.*` op resolve null — the call silently fell back to raw, unlowered C++ (`therm.writeReg(1, (cond ? 1 : 0));`, uncompilable against the thin HAL) and disappeared from peripheral usage in both `--diagnostics` and query. They now use the existing literal-or-expression resolver, matching the `gpio.write`/`preferences.put_int` pattern; the Zephyr lowering interpolates the expression inside `static_cast<uint8_t>(...)` as valid C++.
