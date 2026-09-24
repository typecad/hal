// ---------------------------------------------------------------------------
// Trace types — the `typecad-hal/trace@1` capture artifact
//
// The record `typecad-hal trace capture` writes and `trace report` consumes.
// Device-side semantics: every sample is one heartbeat; per-thread CPU% is
// computed HOST-side from consecutive samples as
//   delta(thread.execCycles) / delta(sysExecCycles)
// so the wire never needs cycle/Hz units and idle appears as its own thread.
// ---------------------------------------------------------------------------

/** One live thread as seen by one heartbeat. */
export interface TraceThreadSample {
  /** Sanitized device thread name ("main", "idle", "tc_thread_0", ...). */
  name: string;
  /** Cumulative execution cycles (as float64 — 2^53 cycles is ~3 years at
   *  100 MHz, far beyond any capture). */
  execCycles: number;
  /** Unused stack bytes at this sample; null when the platform cannot
   *  inspect that thread (device sent -1). */
  stackUnusedBytes: number | null;
  /** Total stack bytes; 0 when CONFIG_THREAD_STACK_INFO was off. */
  stackSizeBytes: number;
}

/** One heartbeat: the system aggregate + the per-thread lines that followed. */
export interface TraceSample {
  seq: number;
  /** Device uptime at sample time (ms). */
  tMs: number;
  /** System-wide execution cycles (idle + non-idle) — the CPU denominator. */
  sysExecCycles: number;
  threads: TraceThreadSample[];
  /** UI frame stats for the interval (UI-mounted programs only). */
  ui?: TraceUiStats;
  /** Session index (0-based) when the capture saw the device reboot (a
   *  repeated CFG line or uptime going backwards); absent in single-session
   *  captures. */
  session?: number;
}

/** Per-heartbeat UI frame timing (device reports 0.1 ms fixed-point avg). */
export interface TraceUiStats {
  frameCount: number;
  avgFrameMsX10: number;
  maxFrameMs: number;
  /** Per-phase ui_tick microseconds [bindings, transitions, draw, scroll,
   *  flush] — present when the build carried the phase-span instrumentation. */
  phasesUs?: [number, number, number, number, number];
}

/** A Trace.mark / Trace.event timeline event. */
export interface TraceEvent {
  tMs: number;
  name: string;
  /** Present for Trace.event (valued samples); absent for Trace.mark. */
  value?: number;
}

/** An on-device threshold breach printed by the sampler
 *  ([TR:ALARM:<seq>:<code>:<detail>]) — stack headroom under the configured
 *  floor or a UI frame over the configured ceiling. */
export interface TraceAlarm {
  seq: number;
  tMs: number;
  /** 'stack' | 'frame' (the sampler's vocabulary). */
  code: string;
  /** Human detail, e.g. "main:123" (stack bytes remaining). */
  detail: string;
}

/** The capture artifact (schema `typecad-hal/trace@1`). */
export interface TraceCapture {
  schema: 'typecad-hal/trace@1';
  /** ISO timestamp of capture start. */
  capturedAt: string;
  /** Serial port the capture read from. */
  port: string;
  baudRate: number;
  /** Sampling interval the device was configured for (zephyr.trace.intervalMs
   *  — informational; samples carry their own timestamps). */
  intervalMs: number | null;
  samples: TraceSample[];
  /** Trace.mark / Trace.event timeline events (may be absent in captures
   *  from before events existed — the schema stays @1 with this optional). */
  events?: TraceEvent[];
  /** On-device threshold alarms (zephyr.trace.alarms) in arrival order. */
  alarms?: TraceAlarm[];
}
