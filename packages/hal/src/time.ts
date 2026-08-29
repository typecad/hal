// ---------------------------------------------------------------------------
// Time — the TS-flavored timing surface
//
// The Arduino-named forms (delay/millis/micros/delayMicroseconds, module
// functions and the Timing class) are deprecated for new code but keep
// lowering — framework-arduino is frozen on them. Time is the replacement:
// plain-number milliseconds like the rest of the JS ecosystem (Date.now() is
// ms), microseconds explicit in the name, and the honest Zephyr verbs —
// k_msleep (yielding sleep), k_uptime_get (ms clock), k_busy_wait (spin).
// ---------------------------------------------------------------------------

import { timeSleep, timeNow, timeNowUs, timeBusyWaitUs, getFreeHeap } from './emit.js';

export class TimeClass {
  static readonly __instance_name = 'Time';

  /** Yielding sleep in milliseconds (k_msleep). On the generated
   *  single-threaded main this blocks the caller — the same semantics
   *  delay() had, JS-spelled. Inside an async function, `await`-ed it
   *  becomes cooperative: the async state machine arms a deadline and
   *  yields (other tasks and timers run) until it passes — the same
   *  machinery `await delay()` rides. */
  sleep(ms: number): Promise<void> {
    timeSleep(ms);
    return Promise.resolve();
  }

  /** Milliseconds since boot as a double (k_uptime_get) — Date.now()-shaped:
   *  milliseconds, monotonic, no uint32 wrap. */
  now(): number {
    return timeNow();
  }

  /** Microseconds since boot as a double
   *  (k_cyc_to_us_floor64(k_cycle_get_64())). */
  nowUs(): number {
    return timeNowUs();
  }

  /** Spin-wait the given microseconds (k_busy_wait) — no yield; for sub-ms
   *  protocol timing where a schedule point would break the waveform. */
  busyWaitUs(us: number): void {
    timeBusyWaitUs(us);
  }

  /** Free heap bytes. 0 on targets without a portable query (see the
   *  timing.free_heap lowering). */
  freeHeap(): number {
    return getFreeHeap();
  }
}

export const Time = new TimeClass();

// ── JS-named timers (k_timer + k_work polyfill underneath) ──────────────────
// These keep their plain-JS names deliberately; they were the one part of the
// old timing surface that predates Arduino and maps cleanly everywhere.

import { rawCpp } from './emit.js';
import { callback } from './callback.js';

export function setInterval(handler: () => void, timeout: number): number {
  rawCpp(`return __tc_setInterval(${callback(handler)}, ${timeout});`);
  return 0;
}

export function setTimeout(handler: () => void, timeout: number): number {
  rawCpp(`return __tc_setTimeout(${callback(handler)}, ${timeout});`);
  return 0;
}

export function clearInterval(id: number): void {
  rawCpp(`__tc_clearInterval(${id});`);
}

export function clearTimeout(id: number): void {
  rawCpp(`__tc_clearTimeout(${id});`);
}
