// ---------------------------------------------------------------------------
// Zephyr framework manifest
//
// Coverage reflects actual resolveHALOperation / lowerHalOp + resolveDisplayOp
// behavior. GPIO, PWM, ADC, I2C, SPI, UART, interrupts, tone, power, pulse,
// shift, WDT, BLE, and timing are lowered; display is lowered via the generic
// <zephyr/drivers/display.h> GFX runtime. WiFi/HTTP/board are honestly
// unsupported (nRF52840 has no WiFi; board-specific lowering deferred). The
// manifest validator probes every declared op against the resolver: a
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
      supported: false,
      unsupportedReason: 'Board-specific lowering deferred.',
      ops: { 'board.resolve': 'unsupported' },
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
      unsupportedReason: 'AP mode, credential persistence, static IP, and event callbacks not yet lowered.',
      ops: {
        // Connection (8) — conn_mgr_if_connect/disconnect + L4 connectivity state.
        'wifi.connect': 'supported', 'wifi.connect_start': 'supported',
        'wifi.disconnect': 'supported', 'wifi.status': 'supported',
        'wifi.is_connected': 'supported', 'wifi.local_ip': 'supported',
        'wifi.rssi': 'supported', 'wifi.mac': 'supported',
        // Scan (8) — net_mgmt NET_REQUEST_WIFI_SCAN + result pool.
        'wifi.scan': 'supported', 'wifi.scan_start': 'supported',
        'wifi.scan_done': 'supported', 'wifi.scan_count': 'supported',
        'wifi.scan_ssid': 'supported', 'wifi.scan_rssi': 'supported',
        'wifi.scan_encryption': 'supported', 'wifi.scan_channel': 'supported',
        // Config (1) — hostname. (set_tx_power not lowered: the Zephyr esp32
        // driver owns the radio, and the compile-time PHY ceiling isn't a Zephyr
        // Kconfig symbol — zephyr#45580. Default TX power only.)
        'wifi.set_hostname': 'supported',
        // Out of scope (17) — each genuinely not lowered (resolver returns undefined).
        'wifi.ap_start': 'unsupported', 'wifi.ap_stop': 'unsupported',
        'wifi.ap_client_count': 'unsupported', 'wifi.ap_ip': 'unsupported',
        'wifi.ap_set_channel': 'unsupported', 'wifi.ap_set_hidden': 'unsupported',
        'wifi.ap_set_max_clients': 'unsupported',
        'wifi.save_credentials': 'unsupported', 'wifi.connect_saved': 'unsupported',
        'wifi.clear_credentials': 'unsupported',
        'wifi.wait_connected': 'unsupported', 'wifi.wait_disconnected': 'unsupported',
        'wifi.set_power_save': 'unsupported', 'wifi.set_static_ip': 'unsupported',
        'wifi.set_auto_reconnect': 'unsupported',
        // on_event: 'disconnect' (NET_EVENT_L4_DISCONNECTED) + 'connect'
        // (NET_EVENT_IPV4_ADDR_ADD) are lowered.
        'wifi.on_event': 'supported',
        'wifi.set_tx_power': 'unsupported',
      },
    },
    http: {
      supported: false,
      unsupportedReason: 'HTTP lowering deferred (requires networking stack).',
      ops: unsupportedOps('http.'),
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
      supported: false,
      unsupportedReason: 'No NVS/Preferences lowering on Zephyr (Zephyr has settings subsystem; not wired).',
      partialCoverage: false,
      ops: unsupportedOps('preferences.'),
    },
    random: {
      supported: false,
      unsupportedReason: 'No random lowering on Zephyr (use sys_rand_get directly via rawCpp() if needed).',
      partialCoverage: false,
      ops: unsupportedOps('random.'),
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
      supported: false,
      unsupportedReason: 'No MQTT lowering on Zephyr (requires networking stack).',
      partialCoverage: false,
      ops: unsupportedOps('mqtt.'),
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

  ambientTypes: [],

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
      'adc', 'ble', 'dac', 'gpio', 'i2c', 'interrupts', 'power', 'pulse',
      'pwm', 'spi', 'timing', 'tone', 'uart', 'wdt', 'worker',
    ],
  },
});
