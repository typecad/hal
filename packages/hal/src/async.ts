// ---------------------------------------------------------------------------
// Async — Top-level cooperative async / scheduling abstraction for TypeHAL
//
// Provides a platform-independent API for:
//   - sleep(ms)      — non-blocking delay via Promise + microtask
//   - yield()        — cooperative yield to other tasks
//   - sleepUntil(condition) — await a condition (promise-based)
//   - currentTask()  — return a description of the currently executing task
//
// Framework packages (Arduino, Native, etc.) provide the C++ runtime behind
// the rawCpp() markers; the transpiler resolves these to the correct platform
// implementation at compile time.
// ---------------------------------------------------------------------------

import { rawCpp } from './emit';

export class AsyncClass {
  static readonly __instance_name = "Async";

  /**
   * Non-blocking sleep for `ms` milliseconds.
   * Returns a Promise<void> that resolves after the given delay.
   * The underlying C++ implementation uses the platform's timer/microtask
   * mechanism (e.g. millis-based polling on Arduino, std::this_thread::sleep_for
   * on native, or a FreeRTOS vTaskDelay in the future).
   */
  sleep(ms: number): Promise<void> {
    rawCpp(`__typehal_async_sleep(${ms})`);
    return undefined as any;
  }

  /**
   * Cooperative yield — suspend the current task and allow other tasks
   * (microtasks, timers) to run. Resumes on the next microtask pump cycle.
   */
  yield(): Promise<void> {
    rawCpp(`__typehal_async_yield()`);
    return undefined as any;
  }

  /**
   * Await a polling condition.
   * Repeatedly checks `condition()` every `pollIntervalMs` milliseconds
   * until it returns true, then resolves.
   * The underlying implementation uses the platform's timer mechanism.
   */
  sleepUntil(condition: () => boolean, pollIntervalMs: number = 10): Promise<void> {
    rawCpp(`__typehal_async_sleep_until(${pollIntervalMs})`);
    return undefined as any;
  }

  /**
   * Return a human-readable description of the currently executing async task.
   * Useful for debugging / logging in cooperative multitasking environments.
   */
  currentTask(): string {
    rawCpp(`return __typehal_async_current_task()`);
    return "";
  }
}

/** Singleton instance — consumers use `Async.sleep(...)` directly. */
export const Async = new AsyncClass();
