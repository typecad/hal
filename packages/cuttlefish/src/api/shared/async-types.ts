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
   * Whether the platform supports timer-based setTimeout/setInterval
   * (as opposed to cooperative polling).
   */
  hasTimers: boolean;

  /**
   * Names of C++ headers required by the async runtime.
   * e.g. ["<functional>", "<vector>", "<utility>", "<string>"]
   */
  requiredIncludes: string[];
}