import type { ProgramIR } from "../api/index.js";
import type { RuntimePolyfillIR } from "../api/shared/index.js";
import { generateCoopScheduler } from "../api/shared/index.js";
import type { AsyncRuntimeConfig } from "../api/shared/index.js";

/**
 * Build a RuntimePolyfillIR for the no-STL cooperative scheduler, when the
 * program has async/timer work AND the strategy has opted into priority/time-
 * budget scheduling via AsyncRuntimeConfig.
 *
 * The polyfill carries only the scheduler namespace + CoopSched_run() alias.
 * Per-program work-unit registration + dispatch lines are emitted separately
 * by each strategy's asyncLoopInjection() via buildCoopSchedInjection().
 *
 * Why a polyfill and not shimLines(): polyfills are dead-code-eliminated
 * (filterPolyfillHelpers) and feature-gated centrally, matching how
 * async_runtime / timer_methods are handled. The scheduler is STL-free, so it
 * links on minimal-libc targets (Zephyr) where the std::function Promise
 * runtime does not.
 */
export function buildCoopSchedulerPolyfill(
  _program: ProgramIR,
  config: AsyncRuntimeConfig,
  currentTimeExpr: string = "__tc_now_ms()",
): RuntimePolyfillIR | null {
  if (!config.enablePriority && !config.enableTimeBudget) return null;

  return {
    kind: "polyfill",
    id: "coop_scheduler",
    domain: "embedded",
    // STL-free: only needs a 32-bit unsigned time source (__tc_now_ms() /
    // k_uptime_get_32()) and fixed-width types, both available everywhere.
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [
      generateCoopScheduler({
        capacity: 8,
        priorities: config.schedulerPriorities ?? 2,
        enableTimeBudget: config.enableTimeBudget ?? false,
        timeBudgetMs: config.timeBudgetMs ?? 5,
        currentTimeExpr,
      }),
    ],
    helperFunctions: [],
    shimMacros: [],
    dependencies: [],
  };
}
