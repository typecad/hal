// ---------------------------------------------------------------------------
// Thread — the thin Zephyr-shaped thread
//
// k_thread_create / k_thread_join with Zephyr's own model: construction
// carries the thread's facts (stack size, priority); start(fn) creates and
// schedules it (K_NO_WAIT — running immediately); join() blocks until it
// exits (K_FOREVER). The entry function is a no-argument closure, trampolined
// through Zephyr's (void*, void*, void*) entry signature — the same
// callback machinery interrupts use.
//
// The `index` is the thread's identity (0, 1, 2, …) — the slot its stack and
// k_thread state occupy, like Counter's instance. Priorities: Zephyr's scale
// — 5 (the default) is preemptive, below main; negative would be cooperative.
// ----------------------------------------------------------------------------

import { threadStart, threadJoin } from './emit.js';
import { callback } from './callback.js';

/**
 * A separate thread of execution: `const t = new Thread(0, { stackKb: 2 });
 * t.start(() => { ... }); t.join();`. The entry function runs concurrently
 * with the main program from the moment `start()` is called; `join()`
 * blocks until it returns. The index (0, 1, 2…) is the thread's slot —
 * use each index at most once.
 */
export class Thread {
  private readonly _index: number;
  private readonly _stackBytes: number;
  private readonly _priority: number;

  /** Construct a thread handle. `stackKb` defaults to 2 (ample for typical
   *  code); `priority` defaults to 5 — a preemptible thread that yields to
   *  the main program. Smaller numbers mean higher priority; negative
   *  values create cooperative threads that cannot be preempted once
   *  running. */
  constructor(index: number, opts?: { stackKb?: number; priority?: number }) {
    this._index = index;
    this._stackBytes = (opts?.stackKb ?? 2) * 1024;
    this._priority = opts?.priority ?? 5;
  }

  /** Create the thread and start it immediately — the entry function runs
   *  concurrently with the main program from this call. */
  start(fn: () => void): void {
    threadStart(this._index, this._stackBytes, this._priority, callback(fn));
  }

  /** Block until the thread's entry function returns. Requires a prior
   * `start()` — joining an unstarted slot is a build error. */
  join(): void {
    threadJoin(this._index);
  }
}
