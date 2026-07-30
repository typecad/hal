// ---------------------------------------------------------------------------
// Power lowering — Zephyr power management
//
// Zephyr enters low-power states from the idle thread per policy. The app-facing
// controls are pm_state_force (override policy to force a state on next idle)
// and k_sleep (block the calling thread, allowing the system to idle into a
// low-power state). "Deep sleep" maps to k_sleep (the SoC picks its deepest
// allowed state); "light sleep" best-effort forces SUSPEND_TO_IDLE.
//
// CPU frequency and pin-wake config are SoC-specific (nRF clock + GPIO sense)
// and deferred — recorded as comments so the ops still lower.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Resolve a HAL power.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerPower(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;

  switch (op.operation) {
    case 'power.deep_sleep':
      // Block for the requested duration; the idle thread + PM policy will enter
      // the deepest state the SoC allows during the sleep.
      return { code: `k_sleep(K_MSEC(${o.ms}));` };
    case 'power.light_sleep':
      // Best-effort: force a shallow suspend on the next idle. pm_state_force
      // requires a pm_state_info; SUSPEND_TO_IDLE is a common shallow state.
      return { code: `pm_state_force(0, &(const struct pm_state_info){ .state = PM_STATE_SUSPEND_TO_IDLE, .substate_id = 0 });` };
    case 'power.set_cpu_frequency':
      // nRF clock frequency config (clock_start) is SoC-specific; deferred.
      return { code: `/* power.set_cpu_frequency(${o.mhz}): nRF clock API — deferred */` };
    case 'power.deep_sleep_pin':
      // GPIO wake-source (GPIOTE DETECT + SENSE) config is deferred.
      return { code: `/* power.deep_sleep_pin(${o.pin}, ${o.level}): GPIOTE sense — deferred */` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
