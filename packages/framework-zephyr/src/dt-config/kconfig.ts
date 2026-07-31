// ---------------------------------------------------------------------------
// Kconfig fragment resolver — extracts the prj.conf symbol logic
//
// Previously inline in scaffold.ts as token-scanning of the emitted source.
// Formalized here as a typed, unit-testable function keyed off a usage-analysis
// object (the same ctx.analysis.usesX flags the strategy uses). scaffold.ts
// calls this instead of inlining the scan, keeping prj.conf generation honest
// and testable.
// ---------------------------------------------------------------------------

export interface KconfigUsage {
  usesAdc?: boolean;
  usesPwm?: boolean;
  usesI2c?: boolean;
  usesSpi?: boolean;
  usesUart?: boolean;
  usesWdt?: boolean;
  usesBle?: boolean;
  usesDisplay?: boolean;
  usesPower?: boolean;
}

/**
 * Resolve the Kconfig symbol→value map for a prj.conf. Returns a Map preserving
 * insertion order (callers join with '\n'). Core GPIO + C++ + workqueue symbols
 * are always present; driver symbols are usage-gated.
 */
export function resolveKconfigFragments(
  usage: KconfigUsage,
  debug: boolean,
): Map<string, string> {
  const m = new Map<string, string>();

  // Core driver + console.
  m.set('CONFIG_GPIO', 'y');

  if (usage.usesAdc) m.set('CONFIG_ADC', 'y');
  if (usage.usesPwm) m.set('CONFIG_PWM', 'y');
  if (usage.usesI2c) m.set('CONFIG_I2C', 'y');
  if (usage.usesSpi) m.set('CONFIG_SPI', 'y');
  if (usage.usesWdt) m.set('CONFIG_WATCHDOG', 'y');
  if (usage.usesDisplay) m.set('CONFIG_DISPLAY', 'y');
  // deep_sleep_pin wake needs PM + PM_DEVICE.
  if (usage.usesPower) {
    m.set('CONFIG_PM', 'y');
    m.set('CONFIG_PM_DEVICE', 'y');
  }
  if (usage.usesBle) {
    m.set('CONFIG_BT', 'y');
    m.set('CONFIG_BT_PERIPHERAL', 'y');
    m.set('CONFIG_BT_GATT_DYNAMIC_DB', 'y');
  }
  // usesUart: the board enables the console UART by default; the overlay (not
  // Kconfig) is where a UART node would be enabled, so no symbol here.

  // System workqueue — bumped for worker-offload AND timer callbacks.
  m.set('CONFIG_SYSTEM_WORKQUEUE', 'y');
  m.set('CONFIG_SYSTEM_WORKQUEUE_STACK_SIZE', '8192');

  // C++ support.
  m.set('CONFIG_CPP', 'y');
  m.set('CONFIG_NEWLIB_LIBC', 'y');
  m.set('CONFIG_REQUIRES_FULL_LIBCPP', 'y');
  m.set('CONFIG_STD_CPP14', 'y');

  // Main thread stack.
  m.set('CONFIG_MAIN_STACK_SIZE', '4096');

  if (debug) {
    m.set('CONFIG_DEBUG', 'y');
    m.set('CONFIG_DEBUG_OPTIMIZATIONS', 'y');
  }

  return m;
}
