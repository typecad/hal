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

export class Thread {
  private readonly _index: number;
  private readonly _stackBytes: number;
  private readonly _priority: number;

  /** Construct a thread handle. `stackKb` defaults to 2 (generous for
   *  generated code); `priority` defaults to 5 — preemptive, below main. */
  constructor(index: number, opts?: { stackKb?: number; priority?: number }) {
    this._index = index;
    this._stackBytes = (opts?.stackKb ?? 2) * 1024;
    this._priority = opts?.priority ?? 5;
  }

  /** Create the thread and schedule it immediately (k_thread_create with
   *  K_NO_WAIT). The entry function runs concurrently with main from here. */
  start(fn: () => void): void {
    threadStart(this._index, this._stackBytes, this._priority, callback(fn));
  }

  /** Block until the thread exits (k_thread_join with K_FOREVER). Requires
   *  a prior start() on the same index — an unstarted slot is a build
   *  error naming the slot's symbol. */
  join(): void {
    threadJoin(this._index);
  }
}
