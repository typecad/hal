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
  m.set('CONFIG_PRINTK', 'y');
  m.set('CONFIG_PRINTK_SYNC', 'y');
  m.set('CONFIG_CONSOLE', 'y');

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
    // NOT CONFIG_NET_CONFIG_SETTINGS: that runs net_config_init() at boot which
    // BLOCKS up to NET_CONFIG_INIT_TIMEOUT (default 30s) waiting for the iface
    // to come up — but our shim brings the iface up itself in setup() (connect),
    // so net_config waits the full 30s, then the dual management of the same
    // iface crashes the driver. Our shim owns connectivity (net_mgmt connect/
    // disconnect + conn_mgr monitor for L4), exactly like the standalone Zephyr
    // WiFi samples that omit NET_CONFIG_SETTINGS.
    m.set('CONFIG_NET_MGMT', 'y');
    m.set('CONFIG_NET_MGMT_EVENT', 'y');        // required for the net_mgmt callbacks
    m.set('CONFIG_NET_CONNECTION_MANAGER', 'y'); // conn_mgr — the connect portability layer
    // Networking stack sizes. The defaults are tiny (NET_MGMT_EVENT_STACK_SIZE
    // is 768 on non-x86) and the WiFi connect result/event handlers run on that
    // stack — overflowing it freezes the chip mid-connect (silent hard fault,
    // no panic dump). The official Zephyr WiFi samples (samples/net/wifi/*)
    // bump exactly these; mirror them. MAIN_STACK 4096→5200 because esp_wifi
    // device init is stack-hungry and 4096 is marginal on the ESP32-S3.
    m.set('CONFIG_NET_MGMT_EVENT_STACK_SIZE', '4096');
    m.set('CONFIG_NET_TX_STACK_SIZE', '2048');
    m.set('CONFIG_NET_RX_STACK_SIZE', '2048');
    m.set('CONFIG_MAIN_STACK_SIZE', '5200');
    // NOTE: wifi.set_tx_power needs no Kconfig symbol. esp_wifi_set_max_tx_power
    // programs the radio at runtime; its ceiling is baked into the prebuilt
    // libphy.a / PHY init data, not a prj.conf knob. The ESP-IDF symbol
    // ESP_PHY_MAX_WIFI_TX_POWER lives in components/esp_phy/Kconfig, which the
    // Zephyr module integration does NOT source — assigning it here would abort
    // the build ("undefined symbol").
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

  // Main thread stack. WiFi already bumps this to 5200 (esp_wifi device init
  // is stack-hungry); don't overwrite that with the default 4096 here.
  if (!usage.usesWifi) {
    m.set('CONFIG_MAIN_STACK_SIZE', '4096');
  }

  if (debug) {
    m.set('CONFIG_DEBUG', 'y');
    m.set('CONFIG_DEBUG_OPTIMIZATIONS', 'y');
  }

  return m;
}
