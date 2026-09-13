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

import { timeSleep, timeNow, timeNowUs, timeBusyWaitUs } from './emit.js';

/**
 * The timing surface: `Time.sleep()` pauses in milliseconds, `Time.now()` /
 * `Time.nowUs()` report time since boot, and `Time.busyWaitUs()` spins for
 * sub-millisecond protocol timing.
 */
class TimeClass {
  static readonly __instance_name = 'Time';

  /** Pause for `ms` milliseconds. In a plain (non-async) function this
   *  blocks the whole program. Inside an async function, `await
   *  Time.sleep(ms)` yields cooperatively — other tasks and timers keep
   *  running until the pause elapses. */
  sleep(ms: number): Promise<void> {
    timeSleep(ms);
    return Promise.resolve();
  }

  /** Milliseconds since boot. Monotonic — the value never wraps or jumps
   *  backwards, so differences and deadlines stay correct over long runs. */
  now(): number {
    return timeNow();
  }

  /** Microseconds since boot. Monotonic like `now()`, but the resolution
   *  is one millisecond — for sub-millisecond deterministic timing use a
   *  hardware `Counter`. */
  nowUs(): number {
    return timeNowUs();
  }

  /** Busy-wait (spin) for `us` microseconds without yielding — for
   *  sub-millisecond protocol timing where letting other code run would
   *  break the waveform. Nothing else executes while spinning, so keep
   *  these waits short. */
  busyWaitUs(us: number): void {
    timeBusyWaitUs(us);
  }
}

export const Time = new TimeClass();
