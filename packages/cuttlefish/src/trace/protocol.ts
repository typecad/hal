// ---------------------------------------------------------------------------
// Trace wire protocol — [TR: line parsing
//
// The device heartbeat prints, per interval:
//   [TR:CFG:<version>:<intervalMs>]        once at boot (a REPEAT = reboot)
//   [TR:HB:<seq>:<tMs>:<sysExecCycles>]    heartbeat header
//   [TR:UI:<seq>:<frames>:<avgMsX10>:<maxMs>]  UI frame stats (UI programs)
//   [TR:TH:<seq>:<name>:<execCycles>:<stackUnused|-1>:<stackSize>]  x threads
//   [TR:ALARM:<seq>:<code>:<detail>]       threshold breach (zephyr.trace.alarms)
//
// User code (Trace.mark / Trace.event) prints, at call time:
//   [TR:EV:<tMs>:<name>[:<value>]]         timeline marker / value sample
//
// Lines arrive on the shared console, possibly interleaved with user prints.
// The seq on every line groups thread lines under their heartbeat; a thread
// line whose heartbeat was never seen (capture attached mid-interval) is
// dropped, and a heartbeat is only closed by the NEXT heartbeat — the parser
// stays tolerant of partial trailing groups at capture start/stop.
//
// Sessions: the device clock resets on reboot, so a capture that spans a
// power cycle would silently chain two timelines. Two independent signals
// mark the break — a repeated CFG line (the sampler announces itself again
// at boot) and uptime going backwards — and samples after a break carry an
// incremented `session` index.
// ---------------------------------------------------------------------------

import type { TraceAlarm, TraceEvent, TraceSample, TraceThreadSample } from './types.js';

export const TRACE_PREFIX = '[TR:';

/** Incremental parser state (feed lines as they arrive). */
export class TraceLineParser {
  private current: TraceSample | null = null;
  private currentThreadLines = 0;
  private readonly samples: TraceSample[] = [];
  private readonly events: TraceEvent[] = [];
  private readonly alarms: TraceAlarm[] = [];
  /** Session index (0-based) — incremented on a repeated CFG or on uptime
   *  going backwards (device rebooted mid-capture). */
  private session = 0;
  private lastTMs: number | null = null;
  private sawCfg = false;
  /** Last [TR:CFG:<version>:<intervalMs>] seen (null until one arrives). */
  meta: { version: number; intervalMs: number } | null = null;
  /** Lines that started with [TR: but did not parse — a firmware/parse
   *  mismatch indicator for capture diagnostics. */
  malformed = 0;

  /** Feed one console line (any content; non-[TR: lines are ignored). */
  feed(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith(TRACE_PREFIX)) return;
    const body = trimmed.slice(TRACE_PREFIX.length);
    // Trailing ']' is optional on the wire (printf lines end with \n, not ']')
    // — strip it when present, then split fields.
    const fields = (body.endsWith(']') ? body.slice(0, -1) : body).split(':');
    const kind = fields[0];

    if (kind === 'CFG') {
      const version = Number(fields[1]);
      const intervalMs = Number(fields[2]);
      if (Number.isFinite(version) && Number.isFinite(intervalMs)) {
        // A second CFG mid-capture is the sampler announcing itself again —
        // the device rebooted. (The very first one just starts the capture.)
        // The uptime anchor drops too: the clock restarted with the boot, and
        // the next heartbeat's backwards uptime must not count the SAME break
        // twice.
        if (this.sawCfg) {
          this.session++;
          this.lastTMs = null;
        }
        this.sawCfg = true;
        this.meta = { version, intervalMs };
        return;
      }
      this.malformed++;
      return;
    }

    if (kind === 'ALARM') {
      // [TR:ALARM:<seq>:<code>:<detail...>] — grouped under its heartbeat
      // like TH/UI lines; detail may itself contain colons (rejoined).
      const seq = Number(fields[1]);
      const code = fields[2] ?? '';
      const detail = fields.slice(3).join(':');
      if (this.current === null || seq !== this.current.seq || code.length === 0) {
        this.malformed++;
        return;
      }
      this.alarms.push({ seq, tMs: this.current.tMs, code, detail });
      return;
    }

    if (kind === 'EV') {
      // Trace.mark/event — no seq (timestamps order them on the timeline).
      // The value may be absent (mark) or non-numeric if a name smuggled a
      // colon through; both degrade, neither corrupts the stream.
      const tMs = Number(fields[1]);
      const name = fields[2] ?? '';
      const valueRaw = Number(fields[3]);
      if (!Number.isFinite(tMs) || name.length === 0) {
        this.malformed++;
        return;
      }
      this.events.push({
        tMs,
        name,
        ...(Number.isFinite(valueRaw) ? { value: valueRaw } : {}),
      });
      return;
    }

    if (kind === 'UI') {
      const seq = Number(fields[1]);
      const frames = Number(fields[2]);
      const avgX10 = Number(fields[3]);
      const maxMs = Number(fields[4]);
      if (this.current === null || seq !== this.current.seq
          || !Number.isFinite(frames) || !Number.isFinite(avgX10) || !Number.isFinite(maxMs)) {
        this.malformed++;
        return;
      }
      this.current.ui = { frameCount: frames, avgFrameMsX10: avgX10, maxFrameMs: maxMs };
      return;
    }

    if (kind === 'UP') {
      // Per-phase ui_tick microseconds: [bindings, transitions, draw,
      // scroll, flush]. Merges into the matching heartbeat's ui stats.
      const seq = Number(fields[1]);
      const phases = fields.slice(2, 7).map(Number);
      if (this.current === null || seq !== this.current.seq
          || phases.length !== 5 || phases.some((v) => !Number.isFinite(v))) {
        this.malformed++;
        return;
      }
      if (this.current.ui === undefined) {
        this.current.ui = { frameCount: 0, avgFrameMsX10: 0, maxFrameMs: 0 };
      }
      this.current.ui.phasesUs = phases as [number, number, number, number, number];
      return;
    }

    if (kind === 'HB') {
      // A new heartbeat closes the previous group (only complete groups
      // become samples: a heartbeat with zero thread lines still counts —
      // an all-idle system or a THREAD_MONITOR-less read both surface here
      // rather than vanishing).
      this.closeCurrent();
      const seq = Number(fields[1]);
      const tMs = Number(fields[2]);
      const sysExec = Number(fields[3]);
      if (!Number.isFinite(seq) || !Number.isFinite(tMs) || !Number.isFinite(sysExec)) {
        this.malformed++;
        return;
      }
      // Uptime running backwards = device rebooted (k_uptime resets) —
      // everything after belongs to a new session.
      if (this.lastTMs !== null && tMs < this.lastTMs) this.session++;
      this.lastTMs = tMs;
      this.current = {
        seq, tMs, sysExecCycles: sysExec, threads: [],
        ...(this.session > 0 ? { session: this.session } : {}),
      };
      this.currentThreadLines = 0;
      return;
    }

    if (kind === 'TH') {
      const seq = Number(fields[1]);
      const name = fields[2] ?? '';
      const exec = Number(fields[3]);
      const stackUnusedRaw = Number(fields[4]);
      const stackSize = Number(fields[5]);
      if (
        this.current === null || seq !== this.current.seq
        || !Number.isFinite(exec) || !Number.isFinite(stackSize)
      ) {
        if (Number.isFinite(exec) && Number.isFinite(stackSize) && name.length > 0) {
          this.malformed++;
        }
        return;
      }
      const thread: TraceThreadSample = {
        name: name.length > 0 ? name : 'unnamed',
        execCycles: exec,
        stackUnusedBytes: Number.isFinite(stackUnusedRaw) && stackUnusedRaw >= 0 ? stackUnusedRaw : null,
        stackSizeBytes: stackSize > 0 ? stackSize : 0,
      };
      this.current.threads.push(thread);
      this.currentThreadLines++;
      return;
    }

    this.malformed++;
  }

  private closeCurrent(): void {
    if (this.current !== null) {
      this.samples.push(this.current);
      this.current = null;
      this.currentThreadLines = 0;
    }
  }

  /** Parsed samples so far (the in-flight group is excluded until closed). */
  get sampleCount(): number {
    return this.samples.length;
  }

  /** Heartbeat groups OPENED so far (closed + the in-flight one) — the
   *  in-DSL trace-assertion window keys on openings: a sample belongs to a
   *  test when its heartbeat arrived inside it, not when the next one
   *  closed it. */
  get openedCount(): number {
    return this.samples.length + (this.current !== null ? 1 : 0);
  }

  get lastThreadLineCount(): number {
    return this.currentThreadLines;
  }

  /** The most recently closed sample (null before the second heartbeat). */
  peekLastSample(): TraceSample | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
  }

  /** Finish the capture: close any open group and return everything. */
  finish(): TraceSample[] {
    this.closeCurrent();
    return this.samples;
  }

  /** Non-destructive view of the CLOSED samples so far. The live-write path
   *  uses this — calling finish() mid-capture would close the in-flight
   *  heartbeat group, and its UI/UP/TH lines would then arrive with no open
   *  group (every line after the first heartbeat went malformed that way).
   *  The in-flight group is excluded: the live artifact only ever contains
   *  complete heartbeats. */
  snapshot(): TraceSample[] {
    return [...this.samples];
  }

  /** Trace.mark / Trace.event timeline events parsed so far. */
  get eventList(): readonly TraceEvent[] {
    return this.events;
  }

  /** On-device threshold alarms parsed so far (arrival order). */
  get alarmList(): readonly TraceAlarm[] {
    return this.alarms;
  }
}
