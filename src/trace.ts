// ---------------------------------------------------------------------------
// Trace — user event markers on the runtime trace timeline
//
// Pairs with `zephyr.trace: { enabled: true }` in typecad-hal.config.ts: the
// heartbeat sampler records per-thread CPU load and stack high-water marks,
// and these markers put YOUR program's moments on the same timeline — state
// transitions, loop iterations, sensor reads — without printf debugging over
// the same wire the trace already owns.
//
// Both verbs print one [TR:EV: console line per call: timestamps come from
// the kernel uptime clock, values format through the same integer-only
// formatter as the test-runner protocol. They are for HUMAN-rate events
// (a transition, a request, a fault) — do not call them per pixel or per
// frame; aggregate on the device first, then Trace.event the aggregate.
// ---------------------------------------------------------------------------

import { traceMark, traceEvent } from './emit.js';

/**
 * The tracing surface: `Trace.mark("connected")` drops a named marker on
 * the trace timeline; `Trace.event("errors", n)` records a timestamped
 * value the capture's viewer plots.
 */
class TraceClass {
  static readonly __instance_name = 'Trace';

  /** A named point-in-time marker — appears as a tick on the timeline.
   *  The name must be a string literal (it lowers into the firmware as a
   *  C string) without colons. */
  mark(name: string): void {
    traceMark(name);
  }

  /** A named timestamped value sample — the viewer plots value series per
   *  name. The name must be a string literal without colons; `value` may
   *  be any numeric expression. */
  event(name: string, value: number): void {
    traceEvent(name, value);
  }
}

export const Trace = new TraceClass();
