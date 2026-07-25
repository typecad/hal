---
"@typecad/cuttlefish": minor
"@typecad/framework-esp32": minor
"@typecad/framework-arduino": minor
---

## Debug: skip-key to disable individual breakpoints at runtime

When stopped at a breakpoint, press **`s`** to disable that one breakpoint
for the rest of the run (it won't halt there again until the device reboots).
**ENTER** keeps its existing meaning (continue; halt here again next time).
Other breakpoints are unaffected.

### How it works
- The preprocessor now assigns each halting breakpoint a stable per-file
  integer ID (logpoints don't get one — they never halt).
- Each framework's debug shim declares a small disable registry
  (`static bool __tc_bp_disabled[256]`) plus two helpers:
  `__tc_bp_is_disabled(id)` and `__tc_debug_wait_for_continue(id)`. The
  registry lives in the shim (raw C++) rather than in the transpiled source
  so the emitter passes it through verbatim.
- Each breakpoint block is wrapped in `if (!__tc_bp_is_disabled(<id>))` and
  calls `__tc_debug_wait_for_continue(<id>)`, which reads one byte and sets
  `__tc_bp_disabled[<id>] = true` on `s`/`S`.

The registry is `static`, so a skipped breakpoint stays skipped across
`loop()` iterations within one boot and resets on reboot — matching the
"disable for the run" semantics.

Implemented in both `framework-esp32` (native ESP-IDF `printf`/`getchar`) and
`framework-arduino` (`Serial.*`), sharing the breakpoint-ID plumbing in the
cuttlefish preprocessor.
