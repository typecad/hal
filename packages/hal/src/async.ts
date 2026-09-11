// ---------------------------------------------------------------------------
// Async — Top-level cooperative async / scheduling abstraction for TypeCAD
//
// Provides a platform-independent API for:
//   - sleep(ms)      — non-blocking delay via Promise + microtask
//   - yield()        — cooperative yield to other tasks
//   - currentTask()  — return a description of the currently executing task
//
// Framework packages (Arduino, Native, etc.) provide the C++ runtime behind
// the rawCpp() markers; the transpiler resolves these to the correct platform
// implementation at compile time.
// ---------------------------------------------------------------------------

import { rawCpp } from './emit.js';

/** Cooperative scheduling helpers, for use inside async functions:
 *  `await Async.sleep(ms)` pauses the current task while others keep
 *  running, `await Async.yield()` lets other tasks run once, and
 *  `Async.currentTask()` names the running task for debug logging. */
export class AsyncClass {
  static readonly __instance_name = "Async";

  /** Pause for `ms` milliseconds without blocking other tasks — await it
   *  inside an async function. Other tasks and timers keep running until
   *  the pause elapses. */
  sleep(ms: number): Promise<void> {
    rawCpp(`__cuttlefish_async_sleep(${ms});`);
    return Promise.resolve();
  }

  /** Let other tasks run once, then continue — resumes on the next
   *  scheduler pass. */
  yield(): Promise<void> {
    rawCpp(`__cuttlefish_async_yield();`);
    return Promise.resolve();
  }

  /** A short description of the currently running task — handy for
   *  debug logging. */
  currentTask(): string {
    rawCpp(`return __cuttlefish_async_current_task();`);
    return "";
  }
}

/** Singleton instance — consumers use `Async.sleep(...)` directly. */
export const Async = new AsyncClass();
