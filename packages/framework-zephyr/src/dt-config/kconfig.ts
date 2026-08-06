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
  usesHttp?: boolean;
  usesMqtt?: boolean;
  usesPreferences?: boolean;
  usesRandom?: boolean;
  /** Touch controller referenced (UI touch adapter emits DT_NODELABEL(ft6336u)). */
  usesTouch?: boolean;
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
  if (usage.usesDisplay) {
    m.set('CONFIG_DISPLAY', 'y');
    m.set('CONFIG_SPI', 'y');
    m.set('CONFIG_MIPI_DBI', 'y');
    // Enable GDMA so the ESP32 SPI driver uses DMA for panel transfers instead
    // of PIO through the 64-byte hardware FIFO. Without DMA a full 480x320 fill
    // takes ~110ms (effectively ~4MHz); with DMA the same transfer runs at the
    // configured SPI clock (~80MHz) and drops into the low tens of ms. The
    // display overlay pairs this with dma-enabled + dmas on the spi2 node.
    m.set('CONFIG_DMA', 'y');
    // Disable the MIPI DBI SPI bridge + ST7796S drivers. The display adapter
    // drives the panel directly via spi_write. Binding these drivers would
    // allocate a tearing-effect GPIO interrupt that conflicts with the SPI/I2C
    // driver interrupts — the VECDESC_FL_SHARED assertion crashes on touch.
    m.set('CONFIG_MIPI_DBI_SPI', 'n');
    m.set('CONFIG_ST7796S', 'n');
  }
  if (usage.usesTouch) {
    m.set('CONFIG_I2C', 'y');           // FT6336U touch on I2C
  }
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
  if (usage.usesHttp) {
    // HTTP/S rides on the networking stack. The shim does its own
    // socket/getaddrinfo/connect, so it needs the BSD socket layer + POSIX
    // DNS surface + the http client lib, plus the TLS sockopt layer (which
    // selects mbedTLS) and the DNS resolver. HTTP needs the same IP base as
    // WiFi, so this emits the networking primitives even when usesWifi is
    // false — an http-only program still has to reach the internet. Map.set
    // is idempotent, so overlaps with the wifi block are harmless.
    m.set('CONFIG_NETWORKING', 'y');
    m.set('CONFIG_NET_IPV4', 'y');
    m.set('CONFIG_NET_DHCPV4', 'y');
    m.set('CONFIG_NET_TCP', 'y');            // http_client_req needs a TCP socket
    // NET_MAX_CONTEXTS caps the network 5-tuple (socket) pool — the default 6 is
    // exhausted after a handful of sequential HTTP requests even when each is
    // closed (closed TCP contexts linger in TIME_WAIT), and socket() then returns
    // -EPERM. The hardware CRUD harness makes ~17 sequential requests, so raise
    // this well above the default.
    m.set('CONFIG_NET_MAX_CONTEXTS', '16');
    // NET_MAX_CONN is the connection-registry pool (default 8 with v4+v6), a
    // *separate* limit from NET_MAX_CONTEXTS. Closed TCP entries linger briefly
    // in the registry, so rapid sequential HTTP requests exhaust the default and
    // connect() then returns -EPERM. Pair it with NET_MAX_CONTEXTS so both the
    // socket (5-tuple) and connection-registry pools have headroom.
    m.set('CONFIG_NET_MAX_CONN', '16');
    // ZVFS_OPEN_MAX must be set above 0 or socket() returns -EPERM (errno 1): the
    // fd table is allocated to exactly ZVFS_OPEN_MAX entries, and the default 0
    // (even with the ZVFS_OPEN_ADD_SIZE_* "min" contributors) yields zero usable
    // descriptors. HTTP tests open/close a socket per request; give headroom over
    // the per-subsystem contributors (NET=6, POSIX=3).
    m.set('CONFIG_ZVFS_OPEN_MAX', '16');
    // NET_SOCKETS is the user-facing switch for the BSD socket API + ZVFS. The
    // shim uses bare POSIX names (connect/socket/close/getaddrinfo/freeaddrinfo)
    // rather than the zsock_ forms; those bare names resolve under CONFIG_POSIX_API
    // (the official samples/net/sockets/http_client sample sets exactly this).
    // Without it, <zephyr/posix/unistd.h> gates `int close(int)` behind
    // #ifdef CONFIG_POSIX_API and the build fails with "'close' was not declared".
    m.set('CONFIG_NET_SOCKETS', 'y');
    m.set('CONFIG_POSIX_API', 'y');
    m.set('CONFIG_DNS_RESOLVER', 'y');       // getaddrinfo for hostnames
    m.set('CONFIG_DNS_SERVER_IP_ADDRESSES', 'y');
    m.set('CONFIG_HTTP_CLIENT', 'y');        // <zephyr/net/http/client.h> + http_client_req
    // HTTPS via Zephyr socket TLS (IPPROTO_TLS_1_2 + SOL_TLS sockopts, driven by
    // the shim's __tc_http_open_socket https branch). NET_SOCKETS_SOCKOPT_TLS
    // selects mbedTLS, but its ssl layer (mbedtls_ssl_*) needs the rest of this
    // matrix to actually link + a working TLS 1.2 protocol + key exchange.
    m.set('CONFIG_NET_SOCKETS_SOCKOPT_TLS', 'y');
    m.set('CONFIG_TLS_CREDENTIALS', 'y');    // tls_credential_add for caCert()
    m.set('CONFIG_MBEDTLS', 'y');
    m.set('CONFIG_MBEDTLS_BUILTIN', 'y');
    // Enable TLS 1.2 via a single ciphersuite rather than the broad
    // SSL_PROTO_TLS1_2 + KEY_EXCHANGE_ALL_ENABLED (the latter selects KEXes whose
    // PSA_WANT_* deps are unsatisfied → Kconfig abort) or a bare
    // SSL_PROTO_TLS1_2 (no key exchange → check_config.h "no key exchange
    // methods defined"). A ciphersuite is the proven path the in-tree HTTPS
    // samples use (samples/net/prometheus): it transitively selects
    // MBEDTLS_SSL_PROTO_TLS1_2 + its one key exchange + every PSA_WANT_* key/alg
    // that key exchange needs, with no dangling deps. ECDHE_RSA matches the test
    // server's RSA cert (rsa:2048) and is widely offered; add more ciphersuites
    // here to broaden server compatibility.
    m.set('CONFIG_MBEDTLS_CIPHERSUITE_TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256', 'y');
    // Handshake/protocol buffers allocate from the mbedTLS heap; MBEDTLS_HEAP_SIZE
    // must hold ~2x MBEDTLS_SSL_MAX_CONTENT_LEN plus working state. 65000 fits on
    // the ESP32; mbedTLS requires the full libc and PEM (not DER) cert format.
    m.set('CONFIG_MBEDTLS_ENABLE_HEAP', 'y');
    m.set('CONFIG_MBEDTLS_HEAP_SIZE', '65000');
    m.set('CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN', '16384');
    m.set('CONFIG_MBEDTLS_PEM_CERTIFICATE_FORMAT', 'y');
    m.set('CONFIG_PSA_CRYPTO', 'y');
    m.set('CONFIG_REQUIRES_FULL_LIBC', 'y');
    // The http client + TLS handshake are stack-hungry; mirror the wifi bumps
    // (NET_*_STACK_SIZE) and keep the larger main-stack value (TLS handshake
    // overflows the default main stack).
    m.set('CONFIG_NET_MGMT_EVENT_STACK_SIZE', '4096');
    m.set('CONFIG_NET_TX_STACK_SIZE', '2048');
    m.set('CONFIG_NET_RX_STACK_SIZE', '2048');
    if (!usage.usesWifi) m.set('CONFIG_MAIN_STACK_SIZE', '5200');
  }
  if (usage.usesMqtt) {
    // MQTT rides on the networking stack. CONFIG_MQTT_LIB selects NET_SOCKETS;
    // the shim getaddrinfo-resolves the broker and runs its own poll k_thread.
    // CONFIG_MQTT_LIB_TLS enables MQTT_TRANSPORT_SECURE + mqtt_sec_config; the
    // mbedTLS matrix is the same one HTTP uses (it's idempotent via Map.set).
    m.set('CONFIG_NETWORKING', 'y');
    m.set('CONFIG_NET_IPV4', 'y');
    m.set('CONFIG_NET_DHCPV4', 'y');
    m.set('CONFIG_NET_TCP', 'y');
    m.set('CONFIG_NET_SOCKETS', 'y');
    m.set('CONFIG_MQTT_LIB', 'y');
    m.set('CONFIG_MQTT_LIB_TLS', 'y');
    // NET_MAX_CONTEXTS / NET_MAX_CONN: same exhaustion risk as HTTP — sequential
    // connections linger after close. Give the broker session + headroom.
    m.set('CONFIG_NET_MAX_CONTEXTS', '16');
    m.set('CONFIG_NET_MAX_CONN', '16');
    m.set('CONFIG_ZVFS_OPEN_MAX', '16');
    // mbedTLS matrix for mqtts:// (mirrors the HTTP block; overlaps are harmless).
    m.set('CONFIG_NET_SOCKETS_SOCKOPT_TLS', 'y');
    m.set('CONFIG_TLS_CREDENTIALS', 'y');
    m.set('CONFIG_MBEDTLS', 'y');
    m.set('CONFIG_MBEDTLS_BUILTIN', 'y');
    m.set('CONFIG_MBEDTLS_CIPHERSUITE_TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256', 'y');
    m.set('CONFIG_MBEDTLS_ENABLE_HEAP', 'y');
    m.set('CONFIG_MBEDTLS_HEAP_SIZE', '65000');
    m.set('CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN', '16384');
    m.set('CONFIG_MBEDTLS_PEM_CERTIFICATE_FORMAT', 'y');
    m.set('CONFIG_PSA_CRYPTO', 'y');
    m.set('CONFIG_REQUIRES_FULL_LIBC', 'y');
    m.set('CONFIG_NET_TX_STACK_SIZE', '2048');
    m.set('CONFIG_NET_RX_STACK_SIZE', '2048');
    if (!usage.usesWifi && !usage.usesHttp) m.set('CONFIG_MAIN_STACK_SIZE', '5200');
  }
  if (usage.usesBle) {
    m.set('CONFIG_BT', 'y');
    m.set('CONFIG_BT_PERIPHERAL', 'y');
    m.set('CONFIG_BT_GATT_DYNAMIC_DB', 'y');
  }
  // Preferences: ZMS-backed settings. CONFIG_SETTINGS_ZMS depends on ZMS +
  // FLASH_MAP (it does NOT select them), so all three must be set explicitly.
  // The backend locates the storage_partition fixed-partition automatically
  // (or the /chosen zephyr,settings-partition — see dt-config/overlay.ts); no
  // partition macro is needed in the shim. ZMS is preferred over NVS per the
  // Zephyr docs ("as of 4.1 the recommended backend is NVS or ZMS").
  if (usage.usesPreferences) {
    m.set('CONFIG_FLASH', 'y');
    m.set('CONFIG_FLASH_MAP', 'y');
    m.set('CONFIG_ZMS', 'y');
    m.set('CONFIG_SETTINGS', 'y');
    m.set('CONFIG_SETTINGS_ZMS', 'y');
  }
  // usesUart: the board enables the console UART by default; the overlay (not
  // Kconfig) is where a UART node would be enabled, so no symbol here.
  // Random: <zephyr/random/random.h> sys_rand_get is backed by the random
  // generator subsystem. CONFIG_RANDOM_GENERATOR is the umbrella that selects a
  // working backend for the board (nRF52840 → hardware RNG via the entropy
  // driver; QEMU/host → the test generator). CONFIG_ENTROPY_GENERATOR is its
  // hard dependency on hardware targets. Both default on for most boards, but
  // setting them explicitly keeps the symbol set honest and survives a board
  // whose defconfig leaves them off.
  if (usage.usesRandom) {
    m.set('CONFIG_ENTROPY_GENERATOR', 'y');
    m.set('CONFIG_RANDOM_GENERATOR', 'y');
  }

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
  // is stack-hungry); HTTP/MQTT + TLS also bump it (the mbedTLS handshake is
  // stack-hungry). The UI runtime (ui_tick) renders a large node tree with AA
  // text + canvas compositing per frame, so 4096 is marginal headroom and we
  // bump to 8192 for displays. NOTE: a Zephyr panic dump that prints
  // `EXCCAUSE 63` is NOT necessarily a stack overflow — on the Zephyr Xtensa
  // port EXCCAUSE 63 is the reserved software-exception used for k_oops/abort,
  // and the ESP32 port reaches it via abort() in intc_esp32.c (the
  // esp_intr_noniram_disable/enable unbalanced-flag guards). Resolve the dump's
  // PC against the .elf (xtensa_arch_except → abort) before treating it as a
  // stack overflow; 8192 is kept here because deep ui_tick call nesting still
  // wants the headroom.
  if (!usage.usesWifi && !usage.usesHttp && !usage.usesMqtt) {
    m.set('CONFIG_MAIN_STACK_SIZE', usage.usesDisplay ? '8192' : '4096');
  }

  if (debug) {
    m.set('CONFIG_DEBUG', 'y');
    m.set('CONFIG_DEBUG_OPTIMIZATIONS', 'y');
  }

  return m;
}
