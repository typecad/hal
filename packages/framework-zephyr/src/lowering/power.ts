// ---------------------------------------------------------------------------
// Power lowering — Zephyr power management
//
// Zephyr enters low-power states from the idle thread per policy. The app-facing
// controls are pm_state_force (override policy to force a state on next idle)
// and k_sleep (block the calling thread, allowing the system to idle into a
// low-power state). "Deep sleep" maps to k_sleep (the SoC picks its deepest
// allowed state); "light sleep" best-effort forces SUSPEND_TO_IDLE.
//
// deep_sleep_pin configures the wake GPIO as an interrupt source then k_sleeps
// (the interrupt wakes the SoC). CPU frequency is SoC-specific (nRF52 has a
// fixed 64 MHz HFXO with no portable dynamic scaling) and stays a documented
// no-op. deep_sleep_pin targets gpio0 (single-controller nRF52840 case);
// multi-controller SoC routing is a documented follow-on.
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
      // nRF52 has a fixed 64 MHz HFXO; no portable dynamic scaling from C++.
      // Documented no-op (best-effort), matching Arduino's approach.
      return { code: `/* power.set_cpu_frequency(${o.mhz}): nRF52 fixed 64 MHz HFXO — no portable scaling */` };
    case 'power.deep_sleep_pin': {
      // Configure the pin as a GPIO wake source (level interrupt), then k_sleep
      // until the interrupt fires. A static gpio_callback + a no-op handler (the
      // wake just needs the interrupt enabled; the handler does nothing). level:
      // 1=high, 0=low. Targets gpio0 (single-controller nRF52840); multi-
      // controller SoC routing is a documented follow-on.
      const pin = o.pin;
      const level = o.level;
      const flags = level ? 'GPIO_INT_LEVEL_HIGH' : 'GPIO_INT_LEVEL_LOW';
      return {
        code: [
          '{',
          `    static struct gpio_callback __tc_wake_cb;`,
          `    const struct device* __dev = DEVICE_DT_GET(DT_NODELABEL(gpio0));`,
          `    gpio_pin_configure(__dev, ${pin}, GPIO_INPUT);`,
          `    gpio_init_callback(&__tc_wake_cb, [](const struct device*, struct gpio_callback*, gpio_port_pins_t) { (void)0; }, BIT(${pin}));`,
          `    gpio_add_callback(__dev, &__tc_wake_cb);`,
          `    gpio_pin_interrupt_configure(__dev, ${pin}, ${flags});`,
          `    k_sleep(K_FOREVER);`,
          `    gpio_pin_interrupt_configure(__dev, ${pin}, GPIO_INT_DISABLE);`,
          `    gpio_remove_callback(__dev, &__tc_wake_cb);`,
          '}',
        ].join(' '),
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
