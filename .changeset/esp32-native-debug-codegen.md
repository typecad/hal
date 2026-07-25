---
"@typecad/framework-esp32": minor
---

## ESP32: native ESP-IDF debug codegen (`cuttlefish build --debug`)

`Esp32Strategy` now overrides the three `generateDebug*` methods so breakpoint
instrumentation emits native ESP-IDF code instead of inheriting Arduino's
`Serial.println`-based output (which cannot compile on ESP-IDF — there is no
`<HardwareSerial.h>` and no `Serial` object).

- **Init**: emits a `printf` banner (`🔧 TypeCAD Debug Mode Active`). ESP-IDF's
  console is auto-initialized by app startup, so there is no `Serial.begin`
  equivalent.
- **Breakpoints**: route every line through `printf("...\n")` (matching the
  `transformConsoleCall` log/info idiom) and halt via a new
  `__tc_debug_wait_for_enter()` helper — a `getchar()` loop that feeds the task
  watchdog (`esp_task_wdt_reset`) so an unattended breakpoint doesn't reboot
  the chip. Press ENTER in `idf.py monitor` to continue.
- **Logpoints**: same `printf` routing, no halt.
- **Headers**: `esp_task_wdt.h` is now unconditionally included on ESP32 (the
  halt helper is always emitted as `static inline`, dead-stripped when
  `--debug` is not used).

This brings the debug path to the same framework-pluggable abstraction level
that `@typecad/expect` already operates at (`PlatformDebugStrategy`). The
Arduino, AVR, and native frameworks are unchanged.

**Note:** because the halt blocks on console input, a debug build flashed
without `idf.py monitor` (or equivalent) attached will hang at the first
breakpoint. This matches the semantics of a desktop debugger hitting a
breakpoint with no IDE attached.
