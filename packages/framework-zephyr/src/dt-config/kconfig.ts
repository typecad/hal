import { SENSOR_PART_INFO } from '@typecad/hal';

/** A sensor part's catalog facts, as the exceptions helper consumes them. */
interface SensorKconfigSource {
  kconfig: readonly string[];
}

/**
 * Apply the per-part Kconfig exceptions the generated catalog records, for
 * exactly the parts the program constructs. Lines are CONFIG_<SYM>=<value>
 * strings parsed into the map; a symbol the user set explicitly in
 * zephyr.kconfig is left alone (scaffold.ts already skips user overrides for
 * auto symbols, and Map.set idempotence covers the rest). The lookup is a
 * parameter so tests can drive it with a synthetic catalog.
 */
export function applySensorKconfigExceptions(
  m: Map<string, string>,
  parts: readonly { part: string }[] | undefined,
  lookup: Readonly<Record<string, SensorKconfigSource>> = SENSOR_PART_INFO,
): void {
  if (!parts) return;
  for (const sp of parts) {
    for (const line of lookup[sp.part]?.kconfig ?? []) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      m.set(line.slice(0, eq), line.slice(eq + 1));
    }
  }
}

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
  usesDac?: boolean;
  usesFS?: boolean;
  usesHwtimer?: boolean;
  usesI2c?: boolean;
  usesSpi?: boolean;
  usesUart?: boolean;
  /** USB CDC-ACM serial used (usb.* ops). Selects the "next" USB device
   *  stack + CDC class; the class instances themselves are composed in the
   *  DT overlay and auto-default on once the node exists (assigning the
   *  class symbol keeps prj.conf explicit and survives DT-only probes). */
  usesUsb?: boolean;
  usesWdt?: boolean;
  usesBle?: boolean;
  usesDisplay?: boolean;
  usesWifi?: boolean;
  usesHttp?: boolean;
  usesMqtt?: boolean;
  usesPreferences?: boolean;
  usesRandom?: boolean;
  /** A printf-family format specifier with a float conversion (%f, %.2f, %e,
   *  …) appears in the emitted source — Zephyr's cbprintf only links float
   *  conversions with FP_SUPPORT (which itself needs the COMPLETE impl). */
  usesFloatFormat?: boolean;
  /** DT-bound sensor parts used (sensor.* ops — the generic catalog). The
   *  umbrella under which every driver sensor Kconfig lives (`if SENSOR`);
   *  the per-driver symbols default on from their DT node presence. */
  usesSensor?: boolean;
  /** Distinct constructed sensors — only the overlay generator consumes this
   *  (one DT child node per entry, on the given I2C controller index); prj.conf
   *  ignores it. Same adcReadPins/pwmUsedPins pattern. */
  sensorParts?: readonly { part: string; busIndex: number; port: number; busKind: 'i2c' | 'spi'; spiHz?: number; spiMode?: number; alertPin?: number }[];
  /** Distinct thin SPI targets (hal/spi-target.ts) — one DT child node per
   *  entry (no compatible — a raw spi_dt_spec peer), appended after sensor
   *  CS entries in the controller's merged cs-gpios. */
  spiTargets?: readonly { busIndex: number; cs: number; hz?: number; mode?: number }[];
  /** Touch controller referenced (UI touch adapter emits DT_NODELABEL(ft6336u)
   *  or DT_NODELABEL(xpt2046)). Selects the bus driver the node needs. */
  usesTouch?: boolean;
  /** Which touch controller the program uses — FT6336U rides I2C, XPT2046
   *  rides the display's SPI bus. Only meaningful with usesTouch. */
  touchController?: 'ft6336u' | 'xpt2046';
  /** The emitted shim carries the STM32F4 DBGMCU keep-SWD-alive init
   *  (__tc_stm32_dbgmcu token). Selects Zephyr's own "debugger attach in
   *  stop/sleep" init (sets DBG_STOP via the LL headers); the shim's raw
   *  register poke additionally covers DBG_SLEEP, which the Zephyr F4 path
   *  does not set. */
  usesStm32DebugSleep?: boolean;
  /** PSRAM type ('opi' | 'quad') when the target board has PSRAM. Emits the
   *  CONFIG_SPIRAM symbols so the ESP heap serves PSRAM for canvas allocations. */
  psram?: 'opi' | 'quad';
  /** HAL pin numbers the program reads with adc.* — scanned from the emitted
   *  `__tc_adc<N>_setup()` calls at compile time. Only the overlay generator
   *  consumes this (to rewrite the ADC node's pinctrl-0 to the used channels
   *  on SoCs that need pad muxing, e.g. STM32); prj.conf ignores it. */
  adcReadPins?: readonly number[];
  /** HAL pin numbers the program drives with dac.* — scanned from the
   *  emitted lazy-setup guards (__tc_dact<pin>_done) at compile time. Only
   *  the overlay generator consumes this (the DAC node's pinctrl-0 lists
   *  the used channels); prj.conf ignores it. */
  dacWritePins?: readonly number[];
  /** HAL pin numbers the program drives with pwm.* — scanned from the
   *  emitted `__tc_pwm_*` spec references at compile time. Only the overlay
   *  generator consumes this (synthesized pwm-leds consumers + aliases are
   *  emitted per used pin, so the DT carries no dead channels); prj.conf
   *  ignores it. */
  pwmUsedPins?: readonly number[];
  /** Controller indexes per bus the program actually drives — scanned from
   *  the emitted `__tc_<bus><N>_dev` state blocks at compile time. The
   *  overlay enables only those controllers (an enabled-but-unused
   *  controller claims its default pins — e.g. i2c0's GP4/GP5 on the Pico —
   *  which a program using the OTHER controller may want as GPIO). Absent
   *  (prepare-time overlays, driver-API-only users like the display
   *  adapter) → every declared controller is enabled, preserving the old
   *  behavior. prj.conf ignores these. */
  i2cUsedInstances?: readonly number[];
  spiUsedInstances?: readonly number[];
  uartUsedInstances?: readonly number[];
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
  // Sensors: only the umbrella — each in-tree driver is `default y` on its
  // DT_HAS_<COMPAT>_ENABLED, so the overlay's child node enables the driver.
  if (usage.usesSensor) m.set('CONFIG_SENSOR', 'y');
  // The rare driver that is NOT DT-default-on: the catalog records its
  // Kconfig lines (from the driver's own Kconfig) and they are applied for
  // exactly the parts the program constructs. Empty for every in-tree part
  // today — this path is insurance for the next exception.
  applySensorKconfigExceptions(m, usage.sensorParts);
  // Float formatting: cbprintf builds float conversions only under
  // FP_SUPPORT, which depends on the COMPLETE implementation — without these,
  // %f silently prints garbage instead of the value.
  if (usage.usesFloatFormat) {
    m.set('CONFIG_CBPRINTF_COMPLETE', 'y');
    m.set('CONFIG_CBPRINTF_FP_SUPPORT', 'y');
  }
  if (usage.usesPwm) m.set('CONFIG_PWM', 'y');
  if (usage.usesDac) m.set('CONFIG_DAC', 'y');
  if (usage.usesI2c) m.set('CONFIG_I2C', 'y');
  if (usage.usesSpi) m.set('CONFIG_SPI', 'y');
  // USB CDC-ACM serial: the "next" USB device stack + the CDC-ACM class.
  // Symbol names verified against Zephyr 4.3 (subsys/usb/device_next/Kconfig):
  //   - USB_DEVICE_STACK_NEXT is the new stack (selects UDC_DRIVER);
  //     USB_DEVICE_STACK is the LEGACY stack — deprecated in 4.3 (selects
  //     DEPRECATED) and its assignment is what trips the build.
  //   - USBD_CDC_ACM_CLASS is the class (note the USBD_ prefix — a bare
  //     CDC_ACM_CLASS is an undefined symbol). It depends on SERIAL +
  //     DT_HAS_ZEPHYR_CDC_ACM_UART_ENABLED (the overlay's cdc-acm-uart node)
  //     and selects UART_INTERRUPT_DRIVEN/RING_BUFFER itself; assigning it
  //     keeps prj.conf explicit.
  //   - UART_LINE_CTRL gates the driver's line_ctrl_get — usb.connected()
  //     polls DTR through it.
  if (usage.usesUsb) {
    m.set('CONFIG_USB_DEVICE_STACK_NEXT', 'y');
    m.set('CONFIG_USBD_CDC_ACM_CLASS', 'y');
    m.set('CONFIG_UART_LINE_CTRL', 'y');
    m.set('CONFIG_SERIAL', 'y');
    // The device presents a serial-number string descriptor sourced from
    // hwinfo (the SoC's unique ID). Without it Windows keys the CDC devnode
    // on the physical USB port: replugs reuse stale nodes and repeated flash
    // cycles wedge them into permanent "access denied" opens. A serial makes
    // the instance path identity-based — stable across ports, immune to the
    // port-keyed ghost pool.
    m.set('CONFIG_HWINFO', 'y');
  }
  if (usage.usesWdt) m.set('CONFIG_WATCHDOG', 'y');
  // STM32: keep the debugger attachable in sleep/stop (see the shim's
  // DBGMCU init — this covers the Zephyr-side DBG_STOP bit via LL headers).
  if (usage.usesStm32DebugSleep) m.set('CONFIG_STM32_ENABLE_DEBUG_SLEEP_STOP', 'y');
  // Hardware timers via the counter driver.
  if (usage.usesHwtimer) m.set('CONFIG_COUNTER', 'y');
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
    // Disable the MIPI DBI SPI bridge + in-tree panel drivers (ILI9341,
    // ST7796S). The display adapter drives the panel directly via spi_write.
    // Binding these drivers would allocate a tearing-effect GPIO interrupt
    // that conflicts with the SPI/I2C driver interrupts — the
    // VECDESC_FL_SHARED assertion crashes on touch. ILI9341 matters as much
    // as the bridge: the driver auto-defaults on from the overlay's
    // ilitek,ili9341 node and references the (disabled) mipi-dbi-spi
    // controller's device struct, failing at link time with
    // "undefined reference to __device_dts_ord_N". (Assign the prompted
    // ILI9341, not the hidden ILI9XXX — promptless symbols reject prj.conf
    // assignments.)
    m.set('CONFIG_MIPI_DBI_SPI', 'n');
    m.set('CONFIG_ILI9341', 'n');
    m.set('CONFIG_ST7796S', 'n');
  }
  if (usage.usesTouch) {
    // FT6336U touch is on I2C; the XPT2046 shares the display's SPI bus.
    // CONFIG_INPUT stays off either way: the adapters drive the controllers
    // directly, and enabling it would build the in-tree input drivers
    // (ft5336 / xpt2046) against nodes these adapters already own.
    if (usage.touchController === 'xpt2046') {
      m.set('CONFIG_SPI', 'y');
    } else {
      m.set('CONFIG_I2C', 'y');
    }
  }
  // PSRAM: enable the ESP SPIRAM driver + route malloc/heap to external RAM so
  // large canvas allocations (scroll viewports, lists) can use PSRAM instead of
  // failing in internal SRAM. Zephyr's ESP32 PSRAM support uses CONFIG_ESP_SPIRAM
  // (not CONFIG_SPIRAM — that's an ESP-IDF symbol). The mode choice selects the
  // PSRAM type: OCT for OPI (ESP32-S3), QUAD for quad-spi. CONFIG_ESP_SPIRAM
  // selects SHARED_MULTI_HEAP automatically, which routes heap_caps_malloc to
  // PSRAM. The SoC dtsi already carries the psram0 DT node.
  if (usage.psram) {
    m.set('CONFIG_ESP_SPIRAM', 'y');
    if (usage.psram === 'opi') {
      m.set('CONFIG_SPIRAM_MODE_OCT', 'y');
    } else {
      m.set('CONFIG_SPIRAM_MODE_QUAD', 'y');
    }
  }
  if (usage.usesWifi) {
    // Master networking switch — every CONFIG_NET_* symbol depends on NETWORKING
    // (without it, Kconfig silently forces them all to n).
    m.set('CONFIG_NETWORKING', 'y');
    m.set('CONFIG_WIFI', 'y');
    m.set('CONFIG_WIFI_ESP32', 'y');            // family-wide ESP32 driver (esp32/s3/c3/c6)
    m.set('CONFIG_NET_L2_ETHERNET', 'y');
    m.set('CONFIG_NET_IPV4', 'y');
    m.set('CONFIG_NET_UDP', 'y');               // transitive dep of NET_DHCPV4
    m.set('CONFIG_NET_DHCPV4', 'y');
    // NOT CONFIG_NET_CONFIG_SETTINGS: that runs net_config_init() at boot which
    // BLOCKS up to NET_CONFIG_INIT_TIMEOUT (default 30s) waiting for the iface
    // to come up — but our shim brings the iface up itself in main() (connect),
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
    // Ciphersuites only *depend on* X509_CRT_PARSE_C (they don't select it) —
    // without it sockets_tls.c compiles out mbedtls_x509_crt_parse and every
    // pinned-CA handshake fails with EPERM at connect (the insecure path
    // skips verification, so it works either way).
    m.set('CONFIG_MBEDTLS_X509_CRT_PARSE_C', 'y');
    // KNOWN LIMITATION on this Zephyr tree: pinned-CA (verified TLS) fails at
    // connect — the tf-psa-crypto mbedTLS needs a wider symbol matrix
    // (RSA public-key parse + PEM/DER glue) than the single-ciphersuite
    // select pulls in, and forcing the extra symbols regresses the insecure
    // path. insecure() HTTPS is fully verified; caCert() chain verification
    // stays open until the upstream matrix is mapped.
    // Handshake/protocol buffers allocate from the mbedTLS heap; MBEDTLS_HEAP_SIZE
    // must hold ~2x MBEDTLS_SSL_MAX_CONTENT_LEN plus working state. 65000 fits on
    // the ESP32; mbedTLS requires the full libc and PEM (not DER) cert format.
    m.set('CONFIG_MBEDTLS_ENABLE_HEAP', 'y');
    // 2x SSL_MAX_CONTENT_LEN record buffers + CA-chain parse state +
    // handshake working memory. 65000 fit insecure-mode handshakes but the
    // pinned-CA path (verification state) overflowed → EPERM at connect.
    m.set('CONFIG_MBEDTLS_HEAP_SIZE', '100000');
    m.set('CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN', '16384');
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
    // The shim getaddrinfo-resolves the broker host — without the DNS
    // resolver linked, getaddrinfo fails numeric AND hostname lookups with
    // EAI_FAIL even while plain HTTP (which selects DNS via its own block)
    // works.
    m.set('CONFIG_DNS_RESOLVER', 'y');
    m.set('CONFIG_DNS_SERVER_IP_ADDRESSES', 'y');
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
    // Ciphersuites only *depend on* X509_CRT_PARSE_C (they don't select it) —
    // without it sockets_tls.c compiles out mbedtls_x509_crt_parse and every
    // pinned-CA handshake fails with EPERM at connect (the insecure path
    // skips verification, so it works either way).
    m.set('CONFIG_MBEDTLS_X509_CRT_PARSE_C', 'y');
    // KNOWN LIMITATION on this Zephyr tree: pinned-CA (verified TLS) fails at
    // connect — the tf-psa-crypto mbedTLS needs a wider symbol matrix
    // (RSA public-key parse + PEM/DER glue) than the single-ciphersuite
    // select pulls in, and forcing the extra symbols regresses the insecure
    // path. insecure() HTTPS is fully verified; caCert() chain verification
    // stays open until the upstream matrix is mapped.
    m.set('CONFIG_MBEDTLS_ENABLE_HEAP', 'y');
    // 2x SSL_MAX_CONTENT_LEN record buffers + CA-chain parse state +
    // handshake working memory. 65000 fit insecure-mode handshakes but the
    // pinned-CA path (verification state) overflowed → EPERM at connect.
    m.set('CONFIG_MBEDTLS_HEAP_SIZE', '100000');
    m.set('CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN', '16384');
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
  // Filesystem: littlefs on the storage partition. CONFIG_FILE_SYSTEM_LITTLEFS
  // selects the littlefs backend but NOT FLASH/FLASH_MAP (the partition lookup
  // needs them), so all three are set explicitly — same shape as the
  // preferences/ZMS block. The overlay points the storage_partition at the FS
  // (see dt-config/overlay.ts). NOTE: a program using BOTH fs.* and
  // preferences.* shares the one storage_partition between littlefs and ZMS —
  // dedicate separate partitions if both are needed (the manifest flags this).
  if (usage.usesFS) {
    m.set('CONFIG_FLASH', 'y');
    m.set('CONFIG_FLASH_MAP', 'y');
    m.set('CONFIG_FILE_SYSTEM', 'y');
    m.set('CONFIG_FILE_SYSTEM_LITTLEFS', 'y');
    // fs_mkfs (the lazy first-use format in the shim) is gated behind this —
    // without it the mount path links fine but the format call is undefined.
    m.set('CONFIG_FILE_SYSTEM_MKFS', 'y');
  }
  // usesUart: the board enables the console UART by default; the overlay (not
  // Kconfig) is where a UART node would be enabled, so no symbol here.
  // Random: <zephyr/random/random.h> sys_rand_get is backed by the random
  // generator subsystem's RNG_GENERATOR_CHOICE. There is no umbrella symbol —
  // CONFIG_RANDOM_GENERATOR is a phantom in 4.x (assigning an undefined symbol
  // aborts the build). The choice defaults to the entropy-device generator
  // when the board has a driver (ENTROPY_HAS_DRIVER: nRF52840, ESP32, …);
  // RNG-less SoCs (STM32F411 has no hardware RNG) need
  // CONFIG_TEST_RANDOM_GENERATOR to unlock the timer-clock fallback, which
  // the choice then picks by default. Setting both keys gets the best
  // available source per board.
  if (usage.usesRandom) {
    m.set('CONFIG_ENTROPY_GENERATOR', 'y');
    m.set('CONFIG_TEST_RANDOM_GENERATOR', 'y');
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
