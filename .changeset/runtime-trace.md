---
'@typecad/cuttlefish': minor
'@typecad/ui': minor
'@typecad/framework-zephyr': minor
'@typecad/hal': minor
---

Runtime tracing — `typecad-hal trace` turns a run into evidence

Opt-in, sampling-based profiling in the Tracealyzer spirit: a heartbeat
sampler on the device, a host-side capture/report/view trio, and gates that
turn captures into CI verdicts. One config record drives both halves so they
cannot drift apart: `zephyr.trace: { enabled: true, intervalMs: 1000 }` in
typecad-hal.config.ts.

- **Device sampler** (framework-zephyr): a `k_work_delayable` on the system
  work queue samples per-thread execution cycles
  (`k_thread_runtime_stats_get`) and stack unused/size every interval,
  printing `[TR:` lines on the same printf/STDOUT channel the test-runner
  protocol uses. Emitted into the entry TU only — a second copy in a
  split-file TU would register the `SYS_INIT` twice and double every
  heartbeat. The scaffold contributes exactly the Kconfig the sampler calls
  (THREAD_RUNTIME_STATS, THREAD_MONITOR, THREAD_NAME, INIT_STACKS,
  THREAD_STACK_INFO); the shim `#ifdef`s on THREAD_MONITOR +
  THREAD_RUNTIME_STATS so a user override compiles the sampler out instead
  of failing the link. `Thread.start` lowers a `k_thread_name_set` so user
  threads carry labels (ENOSYS-safe without THREAD_NAME).
- **Host** (cuttlefish `src/trace/`): `trace capture` reads the port, groups
  thread lines under heartbeats by seq (interleaved user prints are noise),
  and rewrites `trace.json` after every closed heartbeat (schema
  `typecad-hal/trace@1` — the audit sidecar pattern) so `trace view` can
  poll it live. `trace report` computes per-thread CPU% host-side as
  `delta(execCycles)/delta(sysExecCycles)` — no cycle/Hz units cross the
  wire, idle appears as its own row, the column sums to ~100% — plus stack
  high-water marks (checked against `query memory`'s static estimate) and
  UI frame stats. `trace view` serves a dependency-free canvas timeline:
  CPU lanes, the UI frame line, event markers.
- **User events** (hal): `Trace.mark("name")` / `Trace.event("name", value)`
  lower to unconditional `__tc_trace_mark`/`__tc_trace_event` helpers — one
  `[TR:EV:` line per call, call sites never depend on the trace config.
  Human-rate events (transitions, requests, faults), never per-frame;
  aggregate on the device first. Names are C string literals without colons.
- **UI frame + phase stats** (ui): for UI-mounted programs the emitter calls
  the strategy's `uiFrameTimingLines` seam after `ui_tick`, feeding
  `__tc_trace_ui_frame(delta)` — a block emitted for EVERY UI program
  (call-site safety) that compiles away unless the traced entry block
  defined `CUTTLEFISH_TRACE_UI`. The heartbeat reports frame count / avg /
  max per interval as `[TR:UI:...]`, plus per-phase ui_tick microseconds as
  `[TR:UP:...]` from cycle captures at emitTick's five slice seams
  (bindings/transitions/draw/scroll/flush) — stripping the injected chunks
  reproduces the plain slice concatenation byte-for-byte (the parity test).
- **CI gates**: `trace report --gate <metric><=|>=><limit>` (repeatable)
  turns a capture into a regression gate — `cpu-avg:main<=50`,
  `cpu-max:idle>=95`, `frame-max<=20`, `stack-min:main>=256` — exiting 1 on
  violation or on absent data (a gate cannot pass on a metric the capture
  lacks).
- **Continual monitoring**: `trace capture --baseline` compares the fresh
  capture against the `trace-report.json` stamped beside every GREEN run
  (the ratchet — a regressed run never moves the goalposts), exiting 1 on
  drift beyond `--drift` (default 10% of baseline; CPU metrics floor at 3pp
  so idle noise cannot fail a run). `zephyr.trace.alarms: { stackMinBytes,
  frameMaxMs }` moves DETECTION onto the device — `[TR:ALARM:` lines the
  moment a threshold breaches, riding the viewer's events axis as red ticks
  and aggregating in the report. Reboots mid-capture split sessions
  (repeated CFG or uptime regression); the viewer fetches only the visible
  slice (`?from=&to=`) so hour-scale captures cost the same as minutes.
- **In-DSL trace assertions**: a test chain can end in `.trace(gate,
  dwellMs?)` — the same gate grammar — evaluated HOST-side over the
  heartbeats that closed inside that `it()` (the dwell keeps the window
  populated; the test firmware inherits `zephyr.trace` from the project
  config). Performance budgets become first-class test verdicts:
  `describe().it().trace('cpu-avg:main<=30', 2500)`. Failure modes are
  assertions with remedies, never crashes — an untraced test firmware, a
  too-short dwell, or a malformed gate each fail with the fix in the
  message.
- **The agent loop** (one command, verifiable verdict): `typecad-hal trace
  capture --flash --duration 10 --gates-file trace-gates.json` — rebuild +
  reflash, preflight the last build for the sampler (exit 2 with the remedy
  when untraced, never a silent empty capture), auto-pick the lone serial
  port, record, and evaluate the committed gates (exit 0/1). Progress goes
  to stderr; `--quiet` makes stdout a single JSON summary line so captures
  pipe cleanly into agent/CI tooling. `trace report --worst 5` answers
  "which interval spiked, and in which phase". `typecad-hal create` stamps
  this loop into every new project's AGENTS.md.
- **All boards equal by construction**: the sampler uses only kernel APIs
  every Zephyr board has, gates on config not board facts, and degrades at
  runtime (stack fields print `-1` where the arch cannot inspect a stack —
  ARC's NO_UNUSED_STACK_INSPECTION). Compile/link-proven end to end on
  xiao_ble + esp32s3_devkitc with `--autosar=strict` — the round also fixed
  the pre-existing strict blockers it surfaced (C-style casts in the print
  shim, `reinterpret_cast` categories in the UI canvas shims) — and
  hardware-validated on esp32s3: `cpu-avg:idle>=50` passed over live
  heartbeats; a deliberately failing `cpu-avg:main>=90` reported the
  section's real values. demo-timing and demo-mono-rig are the traced
  demos; demo-mono-sim carries the Linux CI gate.
