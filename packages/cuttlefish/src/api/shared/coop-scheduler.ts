// ---------------------------------------------------------------------------
// Shared cooperative scheduler C++ code generator (no-STL)
//
// Generates a priority-ordered, time-budget-bounded cooperative scheduler that
// drives the per-frame async pumps (async task .run(), microtask pump, timer
// pump) in loop()/main(). It is deliberately STL-free: function-pointer +
// void* trampolines over a statically-allocated fixed slot table. This lets it
// compile on targets whose minimal libc lacks std::function/std::vector (e.g.
// Zephyr), giving those targets full cooperative-scheduling parity with the
// std::function-based MicrotaskQueue used on Arduino/ESP32/native.
//
// The scheduler is emitted as a polyfill (id: 'coop_scheduler') only when a
// strategy opts in via AsyncRuntimeConfig.enablePriority/enableTimeBudget.
// Per-framework asyncLoopInjection() builds the work-unit registrations and
// the single CoopSched::run() call (see buildCoopSchedInjection()).
// ---------------------------------------------------------------------------

/** A per-frame work unit to be driven by CoopSched. */
export interface CoopWorkUnit {
  /**
   * Stable identifier for the trampoline (used to form the C++ trampoline and
   * registration function names). Must be a valid C++ identifier suffix.
   */
  name: string;
  /** C++ statement to execute when this unit runs, e.g. `fooTask.run();`. */
  body: string;
  /** Dispatch priority (higher runs first). Default 0. */
  priority?: number;
}

export interface CoopSchedOptions {
  /** Maximum number of registered work units. Default 8. */
  capacity?: number;
  /** Number of distinct priority levels. Default 2. */
  priorities?: number;
  /** Whether to break mid-batch once timeBudgetMs elapses. Default false. */
  enableTimeBudget?: boolean;
  /** Per-frame wall-clock budget in ms. Only consulted when budgeting. Default 5. */
  timeBudgetMs?: number;
  /**
   * C++ expression yielding the current monotonic time in ms, used for the
   * budget check (`__tc_now_ms()`). Required only when
   * enableTimeBudget is true.
   */
  currentTimeExpr?: string;
}

/**
 * Generate the CoopSched C++ runtime (a self-contained namespace + global
 * `CoopSched::run()` alias). The scheduler is independent of which work units
 * are registered; units are registered per-program via buildCoopSchedInjection().
 *
 * AUTOSAR C++14 notes:
 *  - Uses int32_t/uint32_t/int8_t (no bare int).
 *  - No STL: function-pointer + void* trampolines, static fixed-size arrays.
 *  - `final` on the scheduler class (nothing inherits it).
 *  - static_cast for all primitive conversions; reinterpret_cast for the
 *    void* <-> trampoline boundary is unnecessary (we pass ctx through verbatim).
 */
export function generateCoopScheduler(options: CoopSchedOptions = {}): string {
  const capacity = options.capacity ?? 8;
  const priorities = options.priorities ?? 2;
  const enableTimeBudget = options.enableTimeBudget ?? false;
  const timeBudgetMs = options.timeBudgetMs ?? 5;
  const currentTimeExpr = options.currentTimeExpr ?? "__tc_now_ms()";

  // Budget check snippet, only included when time-budgeting is enabled.
  const budgetCheck = enableTimeBudget
    ? `      if ((${currentTimeExpr} - _start) >= static_cast<uint32_t>(${timeBudgetMs})) { break; }`
    : `      (void)_start;`;

  return `// ── Cooperative scheduler (no-STL: priority-ordered, budget-bounded) ──────
// Drives the per-frame async pumps. Emitted only when a strategy opts in via
// AsyncRuntimeConfig.enablePriority / enableTimeBudget. STL-free so it links
// on minimal-libc targets (Zephyr). See coop-scheduler.ts.
namespace typecad_coop {
  using WorkFn = void (*)(void*);

  struct WorkUnit final {
    int8_t priority;   // higher runs first
    WorkFn fn;
    void* ctx;
  };

  class CoopSched final {
   public:
    static CoopSched& instance() {
      static CoopSched s;
      return s;
    }

    // Register a work unit. Called once per unit (idempotent registration is
    // driven by begin()/runFirst() below). Returns false if the slot table is
    // full.
    bool registerUnit(int8_t priority, WorkFn fn, void* ctx) {
      if (_count >= static_cast<int32_t>(${capacity})) { return false; }
      _slots[_count].priority = priority;
      _slots[_count].fn = fn;
      _slots[_count].ctx = ctx;
      ++_count;
      return true;
    }

    bool isRegistered() const { return _registered; }
    void markRegistered() { _registered = true; }

    // Dispatch one frame. Runs registered units in descending-priority order.
    // Newly-registered units during dispatch are NOT run this frame (the count
    // is snapshotted at entry) — mirroring the microtask pump's anti-recursion
    // semantics. When time-budgeting is enabled, dispatch breaks early once
    // the per-frame budget elapses; remaining units run next frame.
    void run() {
      const int32_t total = _count;
      const uint32_t _start = ${currentTimeExpr};
      for (int8_t level = static_cast<int8_t>(${priorities - 1}); level >= 0; --level) {
        for (int32_t i = 0; i < total; ++i) {
          if (_slots[i].priority == level && _slots[i].fn != nullptr) {
            _slots[i].fn(_slots[i].ctx);
${budgetCheck}
          }
        }
      }
    }

   private:
    CoopSched() : _count(0), _registered(false) {
      for (int32_t i = 0; i < static_cast<int32_t>(${capacity}); ++i) {
        _slots[i].priority = 0;
        _slots[i].fn = nullptr;
        _slots[i].ctx = nullptr;
      }
    }

    WorkUnit _slots[${capacity}];
    int32_t _count;
    bool _registered;
  };

  inline void run() { CoopSched::instance().run(); }
}  // namespace typecad_coop

// Global-scope alias so HAL/loop() emit resolves.
inline void CoopSched_run() { typecad_coop::run(); }
`;
}

/**
 * Build the loop()/main() injection lines that register the given work units
 * into CoopSched (once, guarded) and dispatch one frame. The returned lines
 * are meant to be emitted verbatim by a strategy's asyncLoopInjection().
 *
 * Each work unit gets a static trampoline `__tc_coop_<name>(void*)` that runs
 * its body; registration is idempotent (guarded by CoopSched::isRegistered())
 * so the same loop() body can safely contain it every frame at zero cost
 * after the first.
 *
 * Trampoline definitions are returned as the first element of the tuple so the
 * caller can place them in the file's shim/declarations region (they must
 * appear before the loop body). The per-frame injection lines are the second
 * element.
 */
export function buildCoopSchedInjection(
  units: CoopWorkUnit[],
): { trampolines: string[]; injection: string[] } {
  const trampolines: string[] = [];
  const injection: string[] = [];

  for (const unit of units) {
    const prio = unit.priority ?? 0;
    const trampName = `__tc_coop_${unit.name}`;
    // Trampoline definition (file scope, before loop()).
    trampolines.push(`static void ${trampName}(void* /*ctx*/) { ${unit.body} }`);
  }

  // Idempotent registration guarded by isRegistered(); then one dispatch.
  // Emitted into the loop body.
  injection.push(`  if (!typecad_coop::CoopSched::instance().isRegistered()) {`);
  for (const unit of units) {
    const prio = unit.priority ?? 0;
    const trampName = `__tc_coop_${unit.name}`;
    injection.push(
      `    typecad_coop::CoopSched::instance().registerUnit(static_cast<int8_t>(${prio}), ${trampName}, nullptr);`,
    );
  }
  injection.push(`    typecad_coop::CoopSched::instance().markRegistered();`);
  injection.push(`  }`);
  injection.push(`  CoopSched_run();`);

  return { trampolines, injection };
}
