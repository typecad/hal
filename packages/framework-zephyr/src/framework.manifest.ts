// ---------------------------------------------------------------------------
// Zephyr framework manifest
//
// Coverage reflects actual resolveHALOperation / lowerHalOp + resolveDisplayOp
// behavior. GPIO, PWM, ADC, I2C, SPI, UART, interrupts, tone, power, pulse,
// shift, WDT, BLE, timing, WiFi, HTTP/S, MQTT, board constants, and random
// are lowered; display is lowered via the generic <zephyr/drivers/display.h>
// GFX runtime. WiFi/HTTP/MQTT require an ESP32 target (nRF52840 has no radio).
// The manifest validator probes every declared op against the resolver: a
// 'supported' op must lower, an 'unsupported' op must return undefined.
// ---------------------------------------------------------------------------

import { defineFrameworkManifest, HAL_OPERATION_KINDS } from '@typecad/cuttlefish/api/shared';

/**
 * Build an `{ opKind: 'unsupported' }` record for every op kind under a given
 * category prefix. Keeps unsupported categories honest without hand-listing
 * every op (the validator requires every op kind be declared, even as
 * unsupported). Mirrors the discipline esp32 applies by hand-listing.
 */
function unsupportedOps(prefix: string): Record<string, 'unsupported'> {
  const out: Record<string, 'unsupported'> = {};
  for (const kind of HAL_OPERATION_KINDS) {
    if (kind.startsWith(prefix)) out[kind] = 'unsupported';
  }
  return out;
}

export default defineFrameworkManifest({
  schemaVersion: 1,
  frameworkId: 'zephyr',
  packageName: '@typecad/framework-zephyr',
  canonical: false,
  displayName: 'Zephyr RTOS',
  description:
    'Native Zephyr framework targeting the Zephyr RTOS via west/CMake. ' +
    'GPIO is lowered through devicetree specs (gpio_pin_*_dt).',
  implementationMode: 'from-scratch',

  entrypoint: {
    entrypointFunctionName: 'setup',
    requiresLoopFunction: true,
    sourceExtension: 'cpp',
    overrideBaseName: 'main',
    outputSubdirectory: 'src',
    generateHeaderFile: true,
    customBridgeShim: 'main',
  },

  profile: {
    // Informational list of supported board targets. The manifest validator
    // never iterates this; chipForTarget (src/chips/index.ts) is the real
    // resolver. ESP32-S3 + plain ESP32 added alongside the nRF52840 MVP target.
    targets: ['xiao_ble', 'esp32s3_devkitc', 'esp32_devkitc'],
    forcedIncludes: ['<zephyr/kernel.h>', '<zephyr/drivers/gpio.h>', '<cstdint>'],
    symbolAliases: {},
  },

  hal: {
    // ── Supported: GPIO (devicetree-spec bridge) ──────────────────────────
    gpio: {
      supported: true,
      partialCoverage: false,
      ops: {
        'gpio.write': 'supported',
        'gpio.read': 'supported',
        'gpio.toggle': 'supported',
        'gpio.set_mode': 'supported',
      },
    },

    // ── Supported: Timing (delay/millis/delay_us/micros/free_heap; timers via polyfill) ─
    timing: {
      supported: true,
      partialCoverage: false,
      ops: {
        'timing.delay': 'supported',            // → k_msleep(ms)
        'timing.delay_microseconds': 'supported', // → k_busy_wait(us)
        'timing.millis': 'supported',           // → k_uptime_get_32()
        'timing.micros': 'supported',           // → k_cycle_get_32 + cycles/sec
        'timing.free_heap': 'supported',        // → 0 (no portable query; see lowering)
        // Timer ops are POLYFILL_BACKED_OPS → timer_methods. The validator skips
        // the resolver probe (these legitimately return polyfill-helper calls,
        // not direct lowering) and requires the polyfill be in polyfills.emitted.
        'timing.set_interval': 'polyfill',
        'timing.set_timeout': 'polyfill',
        'timing.clear_interval': 'polyfill',
        'timing.clear_timeout': 'polyfill',
      },
    },

    // ── Supported: PWM (pwm_dt_spec via pwm-led0) ──────────────────────────
    pwm: {
      supported: true,
      partialCoverage: false,
      ops: {
        'pwm.write': 'supported',
        'pwm.get_frequency': 'supported',
        'pwm.get_resolution': 'supported',
      },
    },

    // ── Supported: ADC (SAADC via adc_read + channel setup) ────────────────
    adc: {
      supported: true,
      partialCoverage: false,
      ops: {
        'adc.read': 'supported',
        'adc.get_resolution': 'supported',
        'adc.set_reference': 'supported',
        'adc.get_reference': 'supported',
        'adc.read_voltage': 'supported',
      },
    },
    dac: {
      supported: false,
      unsupportedReason: 'No DAC lowering implemented in the framework (not applicable on nRF52840; ESP32 variants with DAC not yet wired).',
      ops: { 'dac.write': 'unsupported' },
    },
    interrupts: {
      supported: true,
      partialCoverage: true,
      unsupportedReason: undefined,
      ops: {
        'interrupt.attach': 'supported',
        'interrupt.detach': 'supported',
      },
    },
    tone: {
      supported: true,
      partialCoverage: true,
      ops: {
        'tone.play': 'supported',   // PWM-based square wave (blocking for duration)
        'tone.stop': 'supported',
      },
    },
    power: {
      supported: true,
      partialCoverage: true,
      ops: {
        'power.deep_sleep': 'supported',   // k_sleep (deepest allowed state)
        'power.light_sleep': 'supported',  // pm_state_force SUSPEND_TO_IDLE
        'power.set_cpu_frequency': 'supported', // comment (nRF clock API deferred)
        'power.deep_sleep_pin': 'supported',   // GPIO-interrupt wake + k_sleep
      },
    },
    i2c: {
      supported: true,
      partialCoverage: false,
      ops: {
        'i2c.begin': 'supported', 'i2c.end': 'supported', 'i2c.set_clock': 'supported',
        'i2c.begin_transmission': 'supported', 'i2c.write': 'supported',
        'i2c.write_bytes': 'supported', 'i2c.write_buffer': 'supported',
        'i2c.read_buffer': 'supported', 'i2c.end_transmission': 'supported',
        'i2c.request_from': 'supported', 'i2c.available': 'supported', 'i2c.read': 'supported',
        'i2c.recover': 'supported',
      },
    },
    spi: {
      supported: true,
      partialCoverage: false,
      ops: {
        'spi.begin': 'supported', 'spi.end': 'supported', 'spi.transfer': 'supported',
        'spi.begin_transaction': 'supported', 'spi.end_transaction': 'supported',
        'spi.set_mode': 'supported', 'spi.set_bit_order': 'supported',
        'spi.cs_low': 'supported', 'spi.cs_high': 'supported', 'spi.read_buffer': 'supported',
      },
    },
    uart: {
      supported: true,
      partialCoverage: true,
      ops: {
        'uart.begin': 'supported', 'uart.end': 'supported', 'uart.print': 'supported',
        'uart.println': 'supported', 'uart.printf': 'supported', 'uart.write': 'supported',
        'uart.read': 'supported', 'uart.peek': 'supported', 'uart.available': 'supported',
        'uart.flush': 'supported',
      },
    },
    pulse: {
      supported: true,
      partialCoverage: true,
      ops: { 'pulse.in': 'supported', 'pulse.in_long': 'supported' },
    },
    shift: {
      supported: true,
      partialCoverage: false,
      ops: { 'shift.out': 'supported', 'shift.in': 'supported' },
    },
    board: {
      // Board constant resolution. Board.definition.<path> /
      // Pins.definition.<path> property accesses are folded by
      // ZephyrStrategy.renderBoardDefinitionAccess against the loaded
      // board/MCU constants — the same mechanism framework-arduino uses. The
      // lone HAL op (board.resolve) is constant-folded at IR-build time
      // (expression-to-ir.ts / hal-emitter.ts), so it only reaches the
      // resolver as a dead-letter; 'probe-inconclusive' reflects that the
      // minimal validator probe carries no path/board constants to resolve.
      supported: true,
      partialCoverage: false,
      ops: { 'board.resolve': 'probe-inconclusive' },
    },
    wdt: {
      supported: true,
      partialCoverage: false,
      ops: {
        'wdt.enable': 'supported',
        'wdt.reset': 'supported',
        'wdt.disable': 'supported',
      },
    },
    // ── Partial: WiFi (STA connect + scan + config via conn_mgr/net_mgmt) ────
    // ESP32-S3 only — profileDiagnostics flags wifi usage on radioless chips.
    // AP mode, credential persistence, static IP, and event callbacks deferred.
    wifi: {
      supported: true,
      partialCoverage: true,
      // Unsupported surface: AP client enumeration/IP/per-station-config have no
      // driver hook; credentials need a custom settings-subsystem layer; static IP
      // / auto-reconnect / tx-power aren't wifi-shaped or aren't exposed by the
      // esp32 Zephyr driver. See per-op reasons.
      unsupportedReason: 'AP client enumeration/IP/per-station config, credential persistence, static IP, auto-reconnect, and tx-power have no Zephyr lowering (no driver/Kconfig hook).',
      ops: {
        // Connection (8) — net_mgmt connect/disconnect + L4 connectivity state.
        'wifi.connect': 'supported', 'wifi.connect_start': 'supported',
        'wifi.disconnect': 'supported', 'wifi.status': 'supported',
        'wifi.is_connected': 'supported', 'wifi.local_ip': 'supported',
        'wifi.rssi': 'supported', 'wifi.mac': 'supported',
        // Waits (2) — block on the L4 connected flag (k_msleep poll).
        'wifi.wait_connected': 'supported', 'wifi.wait_disconnected': 'supported',
        // Scan (8) — net_mgmt NET_REQUEST_WIFI_SCAN + result pool.
        'wifi.scan': 'supported', 'wifi.scan_start': 'supported',
        'wifi.scan_done': 'supported', 'wifi.scan_count': 'supported',
        'wifi.scan_ssid': 'supported', 'wifi.scan_rssi': 'supported',
        'wifi.scan_encryption': 'supported', 'wifi.scan_channel': 'supported',
        // AP mode (2 of 7) — esp32 driver wires ap_enable/ap_disable. Only
        // ssid/password/channel are honored; the rest of the AP surface has no
        // driver hook (config_params isn't wired, max_clients hardcodes 5).
        'wifi.ap_start': 'supported', 'wifi.ap_stop': 'supported',
        // Config (2) — hostname (best-effort no-op) + power save (real net_mgmt).
        'wifi.set_hostname': 'supported', 'wifi.set_power_save': 'supported',
        // on_event: 'disconnect' (NET_EVENT_L4_DISCONNECTED) + 'connect'
        // (NET_EVENT_IPV4_ADDR_ADD) are lowered.
        'wifi.on_event': 'supported',
        // ── Genuinely unsupported (no Zephyr/driver hook) ───────────────────
        // ap_client_count: no API to enumerate connected AP stations.
        // ap_ip: set via net_if, not wifi net_mgmt.
        // ap_set_channel: channel set at ap_start; driver doesn't wire ap_config_params.
        // ap_set_hidden: esp32 ap_enable config has no ssid_hidden field.
        // ap_set_max_clients: driver hardcodes max_connection to 5; config_params unwired.
        // save_credentials/connect_saved/clear_credentials: no wifi-credentials API in
        //   Zephyr (would need a custom settings-subsystem layer).
        // set_static_ip: a net_if operation, not a wifi net_mgmt request.
        // set_auto_reconnect: esp32 driver doesn't expose esp_wifi_set_auto_connect.
        // set_tx_power: driver owns the radio; the PHY ceiling isn't a Zephyr Kconfig (zephyr#45580).
        'wifi.ap_client_count': 'unsupported',
        'wifi.ap_ip': 'unsupported',
        'wifi.ap_set_channel': 'unsupported',
        'wifi.ap_set_hidden': 'unsupported',
        'wifi.ap_set_max_clients': 'unsupported',
        'wifi.save_credentials': 'unsupported', 'wifi.connect_saved': 'unsupported',
        'wifi.clear_credentials': 'unsupported',
        'wifi.set_static_ip': 'unsupported',
        'wifi.set_auto_reconnect': 'unsupported',
        'wifi.set_tx_power': 'unsupported',
      },
    },
    http: {
      supported: true,
      partialCoverage: false,
      // HTTP/S client over Zephyr BSD sockets + http_client_req (TLS via
      // mbedTLS / NET_SOCKETS_SOCKOPT_TLS). The __tc_http shim owns url parse,
      // DNS (getaddrinfo), socket/TLS connect, and body accumulation. Requires
      // a networked target (ESP32 WiFi); profileDiagnostics flags usage on a
      // radioless chip as 'zephyr-http-unavailable-on-target'.
      ops: {
        'http.begin': 'supported', 'http.reset': 'supported',
        'http.set_header': 'supported', 'http.set_timeout': 'supported',
        'http.set_max_body': 'supported', 'http.set_body': 'supported',
        'http.set_insecure': 'supported', 'http.set_ca_cert': 'supported',
        'http.send': 'supported', 'http.send_start': 'supported',
        'http.done': 'supported', 'http.status': 'supported',
        'http.ok': 'supported', 'http.body': 'supported',
        'http.content_length': 'supported', 'http.response_header': 'supported',
      },
    },
    display: {
      supported: true,
      partialCoverage: false,
      unsupportedReason: undefined,
      drivers: ['ili9341-zephyr'],
      colorFormat: 'rgb565',
      ops: {
        'display.init': 'supported',
        'display.fill_rect': 'supported',
        'display.draw_text': 'supported',
        'display.draw_rect': 'supported',
        'display.flush': 'supported',
      },
    },
    // ── Supported: BLE (NimBLE GATT peripheral via runtime service register) ──
    ble: {
      supported: true,
      partialCoverage: true,
      ops: Object.fromEntries(
        HAL_OPERATION_KINDS.filter((k) => k.startsWith('ble.')).map((k) => [k, 'supported']),
      ),
    },

    // ── Supported: Worker offload (k_work system workqueue + k_sem) ──────────
    // worker.* is lowered via lowerWorkerOp against the shared __tc_worker
    // contract; the Zephyr backing (worker-backing.ts) supplies k_work + k_sem.
    worker: {
      supported: true,
      partialCoverage: false,
      ops: { 'worker.submit': 'supported', 'worker.done': 'supported' },
    },

    // ── Honestly unsupported extended categories ─────────────────────────────
    // These have op-kinds in HAL_OPERATION_KINDS but no Zephyr lowering. Each
    // is declared unsupported (with a reason) so the coverage matrix is uniform
    // and the resolver's `return undefined` for these prefixes is honest. The
    // catchall schema (HalCoverageSchema) validates any declared extended
    // category; declaring them keeps the manifest a complete coverage record.

    rmt: {
      supported: false,
      unsupportedReason: 'RMT (ESP32 infrared/transaction peripheral) has no Zephyr lowering.',
      partialCoverage: false,
      ops: unsupportedOps('rmt.'),
    },
    snprintf: {
      supported: false,
      unsupportedReason: 'snprintf.emit is a raw escape hatch; the Zephyr resolver returns undefined (use rawCpp()).',
      partialCoverage: false,
      ops: { 'snprintf.emit': 'unsupported' },
    },
    preferences: {
      // ZMS-backed Zephyr settings. The HAL ESP32-NVS session model (begin/end
      // + typed put/get) is modeled on top of Zephyr's flat settings key-space:
      // begin(ns) records a "tc/<ns>/" prefix; put/get operate on an in-RAM
      // cache populated once at boot by settings_load()'s h_set callback;
      // writes mirror to flash via settings_save_one/settings_delete. The ZMS
      // backend auto-locates the storage_partition fixed-partition (or the
      // /chosen zephyr,settings-partition node — see dt-config/overlay.ts).
      // begin/end are no-ops beyond prefix bookkeeping: Zephyr settings has no
      // session/namespace, but keeping the ops preserves portability with the
      // ESP32 NVS model and leaves a hook for a future session-needing backend.
      supported: true,
      partialCoverage: false,
      ops: {
        'preferences.begin': 'supported', 'preferences.end': 'supported',
        'preferences.clear': 'supported', 'preferences.remove': 'supported',
        'preferences.put_int': 'supported', 'preferences.get_int': 'supported',
        'preferences.put_uint': 'supported', 'preferences.get_uint': 'supported',
        'preferences.put_bool': 'supported', 'preferences.get_bool': 'supported',
        'preferences.put_float': 'supported', 'preferences.get_float': 'supported',
        'preferences.put_string': 'supported', 'preferences.get_string': 'supported',
      },
    },
    random: {
      // <zephyr/random/random.h> sys_rand_get seeds a userspace xorshift32
      // PRNG (__tc_rand_*); random.seed re-seeds it deterministically (matching
      // Arduino randomSeed). random.int → [0, 2^31-1], random.range → [min,max-1].
      supported: true,
      partialCoverage: false,
      ops: {
        'random.int': 'supported',
        'random.range': 'supported',
        'random.seed': 'supported',
      },
    },
    fs: {
      supported: false,
      unsupportedReason: 'No filesystem lowering on Zephyr (Zephyr has its own FS API; not wired).',
      partialCoverage: false,
      ops: unsupportedOps('fs.'),
    },
    mdns: {
      supported: false,
      unsupportedReason: 'No mDNS lowering on Zephyr (requires networking stack).',
      partialCoverage: false,
      ops: unsupportedOps('mdns.'),
    },
    mqtt: {
      supported: true,
      partialCoverage: false,
      // MQTT 3.1.1 client over Zephyr <zephyr/net/mqtt.h> (mqtts:// TLS via
      // MQTT_TRANSPORT_SECURE + the shared mbedTLS matrix, encryption only — the
      // HAL surface has no CA-pinning op, so peer verify is NONE). The __tc_mqtt
      // shim resolves the broker, runs the mqtt_input/mqtt_live poll loop on a
      // background k_thread, and dispatches incoming PUBLISHes to the user's
      // onMessage callback. Requires a networked target (ESP32 WiFi);
      // profileDiagnostics flags usage on a radioless chip.
      ops: {
        'mqtt.connect': 'supported', 'mqtt.on_message': 'supported',
        'mqtt.subscribe': 'supported', 'mqtt.publish': 'supported',
        'mqtt.connected': 'supported', 'mqtt.disconnect': 'supported',
      },
    },
    ota: {
      supported: false,
      unsupportedReason: 'No OTA lowering on Zephyr (Zephyr has MCUmgr; not wired).',
      partialCoverage: false,
      ops: unsupportedOps('ota.'),
    },
    temp: {
      supported: false,
      unsupportedReason: 'No on-chip temperature lowering on Zephyr (nRF52840 TEMP peripheral; not wired).',
      partialCoverage: false,
      ops: { 'temp.read': 'unsupported' },
    },
    hwtimer: {
      supported: false,
      unsupportedReason: 'No hardware-timer lowering on Zephyr (timers are handled via the k_timer polyfill, not hwtimer.*).',
      partialCoverage: false,
      ops: unsupportedOps('hwtimer.'),
    },
    capacitive: {
      supported: false,
      unsupportedReason: 'No capacitive-touch lowering on Zephyr (no such peripheral on nRF52840).',
      partialCoverage: false,
      ops: { 'capacitive.read': 'unsupported' },
    },
    i2s: {
      supported: false,
      unsupportedReason: 'No I2S / digital audio lowering on Zephyr.',
      partialCoverage: false,
      ops: unsupportedOps('i2s.'),
    },
    twai: {
      supported: false,
      unsupportedReason: 'No CAN / TWAI lowering on Zephyr (Zephyr CAN driver not wired).',
      partialCoverage: false,
      ops: unsupportedOps('twai.'),
    },
    usb: {
      supported: false,
      unsupportedReason: 'No USB OTG / USB-Serial lowering on Zephyr (Zephyr USB device stack not wired).',
      partialCoverage: false,
      ops: unsupportedOps('usb.'),
    },
    eth: {
      supported: false,
      unsupportedReason: 'No Ethernet MAC lowering on Zephyr.',
      partialCoverage: false,
      ops: unsupportedOps('eth.'),
    },
    espnow: {
      supported: false,
      unsupportedReason: 'ESP-NOW is an ESP-exclusive wireless protocol; no Zephyr lowering.',
      partialCoverage: false,
      ops: unsupportedOps('espnow.'),
    },
    crypto: {
      supported: false,
      unsupportedReason: 'No hardware crypto (AES/SHA/HMAC) lowering on Zephyr.',
      partialCoverage: false,
      ops: unsupportedOps('crypto.'),
    },
    pcnt: {
      supported: false,
      unsupportedReason: 'No pulse-counter (PCNT) lowering on Zephyr.',
      partialCoverage: false,
      ops: unsupportedOps('pcnt.'),
    },
    mcpwm: {
      supported: false,
      unsupportedReason: 'No motor-control PWM (MCPWM) lowering on Zephyr.',
      partialCoverage: false,
      ops: unsupportedOps('mcpwm.'),
    },
    raw: { supported: true },
  },

  polyfills: {
    emitted: [
      { id: 'cuttlefish_halt', domain: 'standard', notes: 'Mapped to a k_msleep halt loop (exceptions disabled)' },
      { id: 'timer_methods', domain: 'embedded', notes: 'k_timer + k_work pool (system workqueue); callbacks run in thread context' },
      { id: 'async_runtime', domain: 'embedded', notes: 'Heap-free static Promise/microtask runtime (generateStaticAsyncRuntime), pumped in loop()' },
    ],
    suppressed: [],
  },

  toolchain: {
    backend: 'west',
    operations: { prepare: true, compile: true, upload: true, monitor: true },
  },

  libraryResolution: {
    isFrameworkLibraryImport: false,
    getFrameworkLibraryHeaderName: false,
    buildClassNameMap: false,
    tryGenerateLibDecl: false,
  },

  typeEmission: {
    normalizeCppType: true,
    mathHeader: '<math.h>',
    needsStdString: false,
    needsStdVector: false,
    needsIostream: false,
    needsStdFunction: false,
    stdlibSupport: {
      hasVector: false,
      hasString: false,
      hasIostream: false,
      hasExceptions: false,
      hasRTTI: false,
      recommendedArrayImpl: 'static_array',
      recommendedStringImpl: 'static_string',
    },
  },

  ambientTypes: ['Preferences'],

  conformance: {
    // Hardware-test groups — each entry is backed by a tests/<group>.test.ts
    // file in this package (validated by the manifest validator). Mirrors the
    // framework-avr/framework-esp32 convention. These run on metal via
    // `npm run test:hw` (cuttlefish-test transpiles → west build → flash).
    hardwareTestGroups: [
      '01-basics',
      '30-timing',
      '40-gpio',
      '41-analog',
      '42-timers',
    ],
    // Per-op HAL-resolution suite — one tests/packages/framework-zephyr/
    // hal-resolution/<cat>.test.ts per category, snapshotting the exact C++
    // each op lowers to. Mirrors the framework-esp32 convention. These are
    // pure string-snapshot tests (no hardware); they are the safety net that
    // catches regressions like silent pull-resistor / interrupt no-ops.
    halResolutionTests: [
      'adc', 'ble', 'board', 'dac', 'gpio', 'http', 'i2c', 'interrupts', 'mqtt',
      'power', 'preferences', 'pulse', 'pwm', 'random', 'spi', 'timing', 'tone',
      'uart', 'wdt', 'worker',
    ],
  },
});
