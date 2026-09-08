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

export class AsyncClass {
  static readonly __instance_name = "Async";

  /**
   * Non-blocking sleep for `ms` milliseconds.
   * Returns a Promise<void> that resolves after the given delay. The async
   * runtime resolves it cooperatively (the static state machine on
   * heap-less targets polls the clock in the scheduler loop).
   */
  sleep(ms: number): Promise<void> {
    rawCpp(`__cuttlefish_async_sleep(${ms});`);
    return Promise.resolve();
  }

  /**
   * Cooperative yield — suspend the current task and allow other tasks
   * (microtasks, timers) to run. Resumes on the next microtask pump cycle.
   */
  yield(): Promise<void> {
    rawCpp(`__cuttlefish_async_yield();`);
    return Promise.resolve();
  }

  /**
   * Return a human-readable description of the currently executing async task.
   * Useful for debugging / logging in cooperative multitasking environments.
   */
  currentTask(): string {
    rawCpp(`return __cuttlefish_async_current_task();`);
    return "";
  }
}

/** Singleton instance — consumers use `Async.sleep(...)` directly. */
export const Async = new AsyncClass();
