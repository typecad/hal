// ---------------------------------------------------------------------------
// Static (heap-free) async runtime C++ code generator
//
// For memory-constrained targets that lack <vector>, <string>, and a heap
// (e.g. AVR: ATmega328P with 2 KB SRAM), the full Promise<T> runtime in
// promise-runtime.ts cannot be emitted. This generator produces a drop-in
// replacement that defines the SAME global symbols the HAL `Async` singleton
// lowers to:
//
//   __cuttlefish_async_sleep(ms)
//   __cuttlefish_async_yield()
//   __cuttlefish_async_sleep_until(pollMs)
//   __cuttlefish_async_current_task()
//   cuttlefish_pump_microtasks()
//
// with zero dynamic allocation: fixed-size arrays of timer slots and one-shot
// task slots, function-pointer + void* context (no std::function), and plain
// C strings (no std::string).
//
// Scope: this covers the HAL `Async` API contract (fire-and-forget scheduling
// and task introspection). It does NOT implement Promise<T>/.then/.catch
// chaining — AVR cannot host that without heap + type erasure. The separate
// async-state-machine.ts path already handles `async function` + `await`
// heap-free on AVR and is not touched here.
// ---------------------------------------------------------------------------

/**
 * Generate a heap-free static async runtime for C++ targets without <vector>.
 *
 * @param capacity Fixed number of timer/task slots. Keep small on constrained
 *   targets (e.g. 8 on AVR). Caps the number of simultaneously pending
 *   Async.sleep / sleepUntil / yield operations.
 * @param waitForPinEdge How `__cuttlefish_wait_pin_edge` (the HAL gpio
 *   waitForRising/waitForFalling lowering target) is implemented:
 *   - "polling" (default): a busy-wait loop using digitalRead/delay/__tc_now_ms +
 *     the RISING/FALLING/HIGH/LOW symbols. For Arduino-style targets where
 *     those are part of the core API.
 *   - "stub": resolve immediately, emitting NO Arduino symbols in the body.
 *     Also defines RISING/FALLING (guarded) so the call site
 *     `__cuttlefish_wait_pin_edge(pin, RISING, t)` compiles on targets that
 *     don't define them (e.g. Zephyr). For testing/debug or targets where edge
 *     waits are not yet wired.
 *   - "interrupt": omit entirely — the strategy/ISR layer provides the symbol.
 */
export function generateStaticAsyncRuntime(
  capacity: number,
  waitForPinEdge: "interrupt" | "polling" | "stub" = "polling",
  strategy?: import("./platform-strategy.js").PlatformStrategy,
): string {
  // The current-time expression (__tc_now_ms() — the runtime clock contract
  // every strategy provides). Falling back to the contract symbol keeps the
  // behavior when no strategy is supplied.
  const now = strategy?.currentTimeMillis?.() ?? "__tc_now_ms()";
  return `
// TypeCAD static (heap-free) async runtime — for targets without <vector>.
namespace typecad_async_static {

// A one-shot callback with an opaque context. The callback returns true while
// it wants to keep running, false once complete. Function pointer + void* only
// (no std::function) so no allocation occurs.
typedef bool (*AsyncCallback)(void*);

struct AsyncTask {
  bool active;
  AsyncCallback fn;
  void* ctx;
};

struct AsyncTimer {
  bool active;
  bool repeat;          // false = one-shot (Async.sleep), true = periodic (Async.sleepUntil)
  unsigned long deadline;
  unsigned long periodMs;
};

class StaticAsyncRuntime {
public:
  static StaticAsyncRuntime& instance() {
    static StaticAsyncRuntime r;
    return r;
  }

  // Arm a one-shot timer that elapses after 'ms' milliseconds. Used by
  // Async.sleep(ms). Returns false if no slot is free.
  bool armTimeout(unsigned long ms) {
    for (int i = 0; i < CAP; ++i) {
      if (!_timers[i].active) {
        _timers[i].active = true;
        _timers[i].repeat = false;
        _timers[i].deadline = ${now} + ms;
        _timers[i].periodMs = 0;
        return true;
      }
    }
    return false;
  }

  // Arm a periodic timer that re-arms every 'ms' milliseconds. Used by
  // Async.sleepUntil(pollMs) — the condition re-check happens caller-side, so
  // the timer simply fires on a fixed cadence. Returns false if no slot free.
  bool armInterval(unsigned long ms) {
    for (int i = 0; i < CAP; ++i) {
      if (!_timers[i].active) {
        _timers[i].active = true;
        _timers[i].repeat = true;
        _timers[i].deadline = ${now} + ms;
        _timers[i].periodMs = ms;
        return true;
      }
    }
    return false;
  }

  // Enqueue a one-shot task that runs on the next pump cycle. Used by
  // Async.yield(). Returns false if the task table is full.
  bool enqueue(AsyncCallback fn, void* ctx) {
    if (!fn) return false;
    for (int i = 0; i < CAP; ++i) {
      if (!_tasks[i].active) {
        _tasks[i].active = true;
        _tasks[i].fn = fn;
        _tasks[i].ctx = ctx;
        return true;
      }
    }
    return false;
  }

  // Advance the runtime: expire due timers and run ready tasks. Called from
  // cuttlefish_pump_microtasks(), which the transpiler injects into loop().
  void pump() {
    const unsigned long now = ${now};
    // Timers: one-shot slots deactivate on expiry; periodic slots re-arm.
    for (int i = 0; i < CAP; ++i) {
      if (_timers[i].active) {
        // (now - deadline) handles the millis() 32-bit wrap correctly
        if (static_cast<long>(now - _timers[i].deadline) >= 0) {
          if (_timers[i].repeat) {
            _timers[i].deadline = now + _timers[i].periodMs;
          } else {
            _timers[i].active = false;
          }
        }
      }
    }
    // One-shot tasks: run once, then deactivate regardless of return value
    // (yield is a single deferred step).
    for (int i = 0; i < CAP; ++i) {
      if (_tasks[i].active) {
        AsyncTask t = _tasks[i];
        _tasks[i].active = false;
        if (t.fn) t.fn(t.ctx);
      }
    }
  }

private:
  static const int CAP = ${capacity};
  AsyncTimer _timers[CAP];
  AsyncTask _tasks[CAP];
};

// Trivial no-op callback for Async.yield(): it only needs to occupy a slot for
// one pump cycle so that awaiting code observes a deferred step.
static bool __yieldNoop(void*) { return false; }

} // namespace typecad_async_static

// ── Global-scope HAL symbols (the names the HAL Async module emits) ──

// Async.sleep(ms) — arm a one-shot timer. No value is returned; on heap-free
// targets the HAL method's result is fire-and-forget scheduling.
inline void __cuttlefish_async_sleep(unsigned long ms) {
  typecad_async_static::StaticAsyncRuntime::instance().armTimeout(ms);
}

// Async.yield() — defer one pump cycle.
inline void __cuttlefish_async_yield() {
  typecad_async_static::StaticAsyncRuntime::instance().enqueue(
    typecad_async_static::__yieldNoop, 0);
}

// Async.sleepUntil(pollMs) — arm a periodic timer at the poll cadence. The
// caller's condition is re-evaluated each time the timer elapses.
inline void __cuttlefish_async_sleep_until(unsigned long pollMs) {
  typecad_async_static::StaticAsyncRuntime::instance().armInterval(pollMs);
}

// Async.currentTask() — name of the currently executing task.
inline const char* __cuttlefish_async_current_task() {
  return "main";
}

// Pump entry called from the transpiler-generated loop(). Advances timers and
// drains one-shot tasks. Same name as the heap-based runtime so the emitter's
// loop injection is identical across targets.
inline void cuttlefish_pump_microtasks() {
  typecad_async_static::StaticAsyncRuntime::instance().pump();
}

// HAL-level wait for pin edge. The body depends on the strategy's
// waitForPinEdge mode — see generateStaticAsyncRuntime()'s doc comment.
${waitPinEdgeForMode(waitForPinEdge, strategy, now)}
`;
}

/** Emit `__cuttlefish_wait_pin_edge` per the strategy's waitForPinEdge mode. */
function waitPinEdgeForMode(mode: "interrupt" | "polling" | "stub", strategy?: import("./platform-strategy.js").PlatformStrategy, now: string = "__tc_now_ms()"): string {
  if (mode === "interrupt") {
    // The strategy/ISR layer provides the symbol; emit nothing here.
    return "// __cuttlefish_wait_pin_edge is provided by the strategy (interrupt mode).";
  }
  if (mode === "stub") {
    // Resolve immediately. Define RISING/FALLING (guarded) so the call site
    // `__cuttlefish_wait_pin_edge(pin, RISING, t)` compiles on targets that
    // don't define them (Zephyr). No digitalRead/delay/millis in the body.
    return [
      "#ifndef RISING",
      "#define RISING 1",
      "#endif",
      "#ifndef FALLING",
      "#define FALLING 2",
      "#endif",
      "// Stub: edge waits resolve immediately (waitForPinEdge=\"stub\").",
      "inline void __cuttlefish_wait_pin_edge(int /*pin*/, int /*mode*/, long /*timeout*/) {",
      "}",
    ].join("\n");
  }
  // polling: busy-wait using Arduino-style digitalRead/delay/millis + RISING/
  // FALLING/HIGH/LOW. For targets whose core API defines those (Arduino).
  return [
    "// HAL-level wait for pin edge — polling-based implementation for static",
    "// (heap-free) targets. Blocks the current task until the pin edge is detected",
    "// or the timeout elapses. An edge is a transition: for RISING, the pin must",
    "// first be LOW then go HIGH; for FALLING, first HIGH then go LOW.",
    "inline void __cuttlefish_wait_pin_edge(int pin, int mode, long timeout) {",
    "  int targetState = (mode == RISING) ? HIGH : LOW;",
    "  int idleState = (mode == RISING) ? LOW : HIGH;",
    `  unsigned long start = ${now};`,
    "  // Phase 1: wait for the pin to be in the idle state (the \"before\" level)",
    `  while (${strategy?.readDigitalPin?.("pin") ?? "digitalRead(pin)"} != idleState) {`,
    `    if (timeout >= 0 && (${now} - start >= static_cast<unsigned long>(timeout))) return;`,
    `    ${strategy?.delayMs?.("1") ?? "delay(1)"};`,
    "  }",
    "  // Phase 2: wait for the transition to the target state (the actual edge)",
    `  while (${strategy?.readDigitalPin?.("pin") ?? "digitalRead(pin)"} != targetState) {`,
    `    if (timeout >= 0 && (${now} - start >= static_cast<unsigned long>(timeout))) return;`,
    `    ${strategy?.delayMs?.("1") ?? "delay(1)"};`,
    "  }",
    "}",
  ].join("\n");
}
