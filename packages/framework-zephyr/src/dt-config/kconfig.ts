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
  usesWifi?: boolean;
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
  if (usage.usesWifi) {
    // Master networking switch — every CONFIG_NET_* symbol depends on NETWORKING
    // (without it, Kconfig silently forces them all to n).
    m.set('CONFIG_NETWORKING', 'y');
    m.set('CONFIG_WIFI', 'y');
    m.set('CONFIG_WIFI_ESP32', 'y');            // ESP32-specific driver (sole WiFi target)
    m.set('CONFIG_NET_L2_ETHERNET', 'y');
    m.set('CONFIG_NET_IPV4', 'y');
    m.set('CONFIG_NET_UDP', 'y');               // transitive dep of NET_DHCPV4
    m.set('CONFIG_NET_DHCPV4', 'y');
    m.set('CONFIG_NET_CONFIG_SETTINGS', 'y');   // the real symbol (CONFIG_NET_CONFIG is undefined)
    m.set('CONFIG_NET_MGMT', 'y');
    m.set('CONFIG_NET_MGMT_EVENT', 'y');        // required for the net_mgmt callbacks
    m.set('CONFIG_NET_CONNECTION_MANAGER', 'y'); // conn_mgr — the connect portability layer
  }
  if (usage.usesBle) {
    m.set('CONFIG_BT', 'y');
    m.set('CONFIG_BT_PERIPHERAL', 'y');
    m.set('CONFIG_BT_GATT_DYNAMIC_DB', 'y');
  }
  // usesUart: the board enables the console UART by default; the overlay (not
  // Kconfig) is where a UART node would be enabled, so no symbol here.

  // System workqueue — bumped for worker-offload AND timer callbacks. The
  // workqueue itself is unconditionally built (no CONFIG_SYSTEM_WORKQUEUE symbol
  // exists in Zephyr — that was a phantom that broke real builds); only the
  // stack size is a real Kconfig knob.
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
