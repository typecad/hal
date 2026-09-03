// ---------------------------------------------------------------------------
// Shared async runtime configuration types
//
// Defines the PlatformAsyncStrategy sub-interface that framework packages
// implement to provide platform-specific async/scheduling behavior.
// The Async HAL module uses these to emit the correct C++ runtime code.
// ---------------------------------------------------------------------------

/**
 * Configuration for the async runtime on a given platform.
 * Framework packages (Arduino, Native, etc.) return this from their
 * PlatformAsyncStrategy implementation.
 *
 * `scheduler` controls how cooperative microtasks are dispatched:
 *   - "microtask"  — simple FIFO queue pumped in loop()/main() (current default)
 *   - "freertos"   — FreeRTOS task notifications / queue (future)
 *   - "thread"     — std::async background thread (native hosted)
 *
 * `waitForPinEdge` controls how GPIO edge-waiting is implemented:
 *   - "interrupt"  — attachInterrupt-based (real ISR, preferred)
 *   - "polling"    — busy-wait loop polling digitalRead (fallback)
 *   - "stub"       — resolve immediately (testing/debug only)
 */
export interface AsyncRuntimeConfig {
  /** Queue capacity for the microtask ring buffer (default: 256). */
  queueCapacity: number;

  /**
   * The co-operative scheduling strategy.
   */
  scheduler: "microtask" | "freertos" | "thread";

  /**
   * How waitForRising/waitForFalling resolve.
   */
  waitForPinEdge: "interrupt" | "polling" | "stub";

  /**
   * Whether to include the std::vector / std::function based Promise runtime.
   * Targets without stdlib support (e.g. AVR) set this to false.
   */
  hasPromiseRuntime: boolean;

  /**
   * Whether the platform provides native timer callbacks for async sleeps
   * (as opposed to cooperative polling). Zephyr sets this false: periodic
   * work is a Thread (k_thread) or a Counter, never a timer queue.
   */
  hasTimers: boolean;

  /**
   * Names of C++ headers required by the async runtime.
   * e.g. ["<functional>", "<vector>", "<utility>", "<string>"]
   */
  requiredIncludes: string[];

  // ── Cooperative scheduler tuning (Phase 0: priority + time-budget) ───────
  //
  // These fields govern the no-STL CoopSched emitted alongside the per-frame
  // pump in asyncLoopInjection(). They are OPTIONAL and default off, so all
  // existing strategies continue to emit the legacy flat pump sequence and
  // observe zero behavioral change.
  //
  // When `enablePriority` / `enableTimeBudget` are true, the per-frame work
  // units (async task .run(), microtask pump, timer pump) are registered into
  // CoopSched once at startup and dispatched by a single CoopSched::run()
  // call each frame, in descending priority order, breaking mid-batch once
  // `timeBudgetMs` of wall-clock time has elapsed.
  //
  // CoopSched is deliberately no-STL (function-pointer + void* trampolines,
  // statically-allocated fixed slots): it compiles on Zephyr's minimal libc
  // where std::function/std::vector are unavailable, giving Zephyr full
  // cooperative-scheduling parity without touching the std::function-based
  // MicrotaskQueue / Promise<T> runtime.

  /**
   * Enable priority-ordered dispatch of per-frame work units.
   * Default false → legacy flat pump sequence. When true, higher-priority
   * units drain before lower-priority ones each frame.
   */
  enablePriority?: boolean;

  /**
   * Enable mid-batch yielding when the per-frame time budget is exceeded.
   * Default false. When true, CoopSched::run() breaks out of its dispatch
   * loop once `timeBudgetMs` has elapsed, leaving remaining units for the
   * next frame. This bounds worst-case latency for background RTOS work and
   * prevents a single greedy unit from starving others.
   */
  enableTimeBudget?: boolean;

  /**
   * Per-frame wall-clock budget in milliseconds. Only consulted when
   * `enableTimeBudget` is true. Default 5.
   */
  timeBudgetMs?: number;

  /**
   * Number of distinct priority levels CoopSched should model. Default 2
   * (high/low). Only consulted when `enablePriority` is true.
   */
  schedulerPriorities?: number;
}