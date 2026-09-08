// ---------------------------------------------------------------------------
// Zephyr framework manifest
//
// Coverage reflects actual resolveHALOperation / lowerHalOp + resolveDisplayOp
// behavior. GPIO, PWM, ADC, I2C, SPI, UART, interrupts, pulse,
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
    // Zephyr is a main()-based RTOS: top-level statements lower straight into
    // main() (no setup()/loop() pair, no bridge shim). Event-driven programs
    // get their scheduler loop appended inside main() by the driver machinery.
    entrypointFunctionName: 'main',
    requiresLoopFunction: false,
    sourceExtension: 'cpp',
    overrideBaseName: 'main',
    outputSubdirectory: 'src',
    generateHeaderFile: true,
  },

  profile: {
    // Informational list of supported board targets. The manifest validator
    // never iterates this. Every board in the catalog resolves the same way
    // (resolveChipFromBoard over the generated manifest) — there is no
    // curated target list.
    targets: [],
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
        // Thin GPIO (hal/gpio-pin.ts): construction flags as tokens, applied
        // once per pin ahead of first use.
        'gpio.configure': 'supported',
        'gpio.read_cfg': 'supported',   // fused guarded configure + read
        'gpio.shift_out': 'supported',
        'gpio.shift_in': 'supported',
      },
    },

    // ── Supported: Timing (delay/millis/delay_us/micros; timers via polyfill) ─
    timing: {
      supported: true,
      partialCoverage: false,
      ops: {
        // Timer ops are POLYFILL_BACKED_OPS → timer_methods. The validator skips
        // the resolver probe (these legitimately return polyfill-helper calls,
        // not direct lowering) and requires the polyfill be in polyfills.emitted.
        // Time.* — the TS-flavored surface (hal/time.ts), preferred over the
        // Arduino-named forms above for new code.
        'timing.sleep': 'supported',             // → k_msleep(ms) — Time.sleep
        'timing.now': 'supported',               // → k_uptime_get() — Time.now
        'timing.now_us': 'supported',            // → k_cyc_to_us_floor64 — Time.nowUs
        'timing.busy_wait_us': 'supported',      // → k_busy_wait(us) — Time.busyWaitUs
      },
    },

    // ── Supported: PWM (pwm_dt_spec via pwm-led0) ──────────────────────────
    pwm: {
      supported: true,
      partialCoverage: false,
      ops: {
        // Thin PWM (hal/pwm-pin.ts): ns-true verbs; construction period
        // applies once, setDuty is 0.0–1.0 sugar over one set_pulse call.
        'pwm.set_pulse': 'supported',
        'pwm.set_duty': 'supported',
        'pwm.set_period': 'supported',
      },
    },

    // ── Supported: ADC (SAADC via adc_read + channel setup) ────────────────
    adc: {
      supported: true,
      partialCoverage: false,
      ops: {
        // Thin ADC (hal/adc-pin.ts): construction gain/reference tokens,
        // lazy inline channel setup.
        'adc.read_raw': 'supported',
        'adc.read_mv': 'supported',
      },
    },
    dac: {
      // ESP32 DAC (2× 8-bit channels on GPIO25/26) via the Zephyr DAC driver
      // (dac_channel_setup + dac_write_value). nRF52840 / ESP32-S3 have no DAC;
      // usage there lowers to a comment and profileDiagnostics flags it
      // (zephyr-dac-pin-unavailable).
      supported: true,
      partialCoverage: true,
      ops: {
        // Thin DAC (hal/dac-pin.ts): raw code, construction resolution.
        'dac.write_value': 'supported',
      },
    },
    interrupts: {
      supported: true,
      partialCoverage: true,
      unsupportedReason: undefined,
      ops: {
        'interrupt.detach': 'supported',
        // Thin GPIO interrupts (hal/gpio-pin.ts onInterrupt): INT_* tokens,
        // covering the level modes the legacy mode strings could not express.
        'interrupt.attach_flags': 'supported',
      },
    },
    i2c: {
      supported: true,
      partialCoverage: false,
      ops: {
        // Thin I2C device (hal/i2c-target.ts): Zephyr register verbs.
        'i2c.reg_write': 'supported',
        'i2c.reg_read': 'supported',
        'i2c.reg_update': 'supported',
        'i2c.dev_write': 'supported',
      },
    },
    spi: {
      supported: true,
      partialCoverage: false,
      ops: {
        // Thin SPI device (hal/spi-target.ts): spi_dt_spec against the DT
        // child node the overlay emits per constructed target.
        'spi.transceive': 'supported',
        'spi.dev_write': 'supported',
        'spi.reg_read': 'supported',
      },
    },
    uart: {
      supported: true,
      partialCoverage: true,
      ops: {
        // Thin UART (hal/uart-port.ts): poll API with construction baud.
        'uart.poll_write': 'supported',
        // Interrupt-drained RX ring (hal/uart-port.ts).
        'uart.rx_arm': 'supported',
        'uart.rx_available': 'supported',
        'uart.rx_peek': 'supported',
        'uart.rx_read': 'supported',
      },
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
        'wdt.disable': 'supported',
        // Thin Watchdog (hal/watchdog.ts): construction timeout in ms.
        'wdt.setup': 'supported',
        'wdt.feed': 'supported',
      },
    },
    // Thin Counter (hal/counter.ts) — Zephyr's counter driver with Zephyr's
    // verbs, over the same per-instance state as hwtimer.*. Chips without a
    // declared free counter lower to a comment + profileDiagnostics flag.
    counter: {
      supported: true,
      partialCoverage: true,
      ops: {
        'counter.on_alarm': 'supported',
        'counter.start': 'supported',
        'counter.stop': 'supported',
      },
    },
    // Thin Thread (hal/thread.ts) — kernel threads. start(fn) is
    // k_thread_create (K_NO_WAIT) over a per-slot stack sized by the
    // construction stackKb; join is k_thread_join (K_FOREVER).
    thread: {
      supported: true,
      partialCoverage: false,
      ops: {
        'thread.start': 'supported',
        'thread.join': 'supported',
      },
    },
    // ── Partial: WiFi (STA connect + scan + config via conn_mgr/net_mgmt) ────
    // ESP32 family only (esp32, esp32s3, esp32c3, esp32c6) — profileDiagnostics
    // flags wifi usage on radioless chips (nRF52840, RP2040/RP2350).
    // AP mode, credential persistence, static IP, and event callbacks deferred.
    wifi: {
      supported: true,
      partialCoverage: true,
      // Unsupported surface: AP client enumeration/IP/per-station-config have no
      // driver hook; credentials need a custom settings-subsystem layer; static IP
      // / auto-reconnect / tx-power aren't wifi-shaped or aren't exposed by the
      // esp32 Zephyr driver. See per-op reasons.
      unsupportedReason: 'Per-station AP enumeration and credential persistence have no Zephyr lowering (no driver/Kconfig hook).',
      ops: {
        // Station (8) — join carries the construction facts (credentials,
        // security, band/channel, timeout, static IPv4, power-save);
        // net_mgmt connect/disconnect + L4 connectivity state underneath.
        'wifi.join': 'supported', 'wifi.connect_start': 'supported',
        'wifi.disconnect': 'supported', 'wifi.is_connected': 'supported',
        'wifi.local_ip': 'supported', 'wifi.rssi': 'supported',
        'wifi.mac': 'supported',
        // Scan (8) — net_mgmt NET_REQUEST_WIFI_SCAN + result pool.
        // scan_start is the async split of scan (kick + poll scan_done);
        // emitted synthetically by the async tier, no TS-facing method.
        'wifi.scan': 'supported',
        'wifi.scan_start': 'supported',
        'wifi.scan_done': 'supported', 'wifi.scan_count': 'supported',
        'wifi.scan_ssid': 'supported', 'wifi.scan_rssi': 'supported',
        'wifi.scan_encryption': 'supported', 'wifi.scan_channel': 'supported',
        // AP mode (2) — esp32 driver wires ap_enable/ap_disable. Only
        // ssid/psk/channel are honored (the thin WiFiAP facts carry exactly those).
        'wifi.ap_start': 'supported', 'wifi.ap_stop': 'supported',
        // on_event: 'disconnect' (NET_EVENT_L4_DISCONNECTED) + 'connect'
        // (NET_EVENT_IPV4_ADDR_ADD) are lowered.
        'wifi.on_event': 'supported',
        // ── Genuinely unsupported (no driver hook) ─────────────────────────
        // ap_client_count: no API to enumerate connected AP stations.
        'wifi.ap_client_count': 'unsupported',
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
        'http.begin': 'supported',
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
      partialCoverage: true,
      // Partial: mono profiles (ssd1306-zephyr) drive display.* ops via the
      // direct GFX runtime only — no CuttlefishGFX UI rendering path. The
      // ILI9341 UI adapter shares the ST7796S direct-drive transport with a
      // per-controller init table (16-bit RGB565 wire format); hardware-tuned
      // on ST7796S only. E-ink panels are out of scope at this time.
      unsupportedReason: 'Mono panels (ssd1306) are direct-op only (no UI rendering); ili9341 UI path is ported but not yet hardware-verified; e-ink is out of scope at this time.',
      drivers: ['ili9341-zephyr', 'st7796-zephyr', 'ssd1306-zephyr'],
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

    // ── Honestly unsupported extended categories ─────────────────────────────
    // These have op-kinds in HAL_OPERATION_KINDS but no Zephyr lowering. Each
    // is declared unsupported (with a reason) so the coverage matrix is uniform
    // and the resolver's `return undefined` for these prefixes is honest. The
    // catchall schema (HalCoverageSchema) validates any declared extended
    // category; declaring them keeps the manifest a complete coverage record.

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
        'preferences.clear': 'supported', 'preferences.remove': 'supported',
        'preferences.put_int': 'supported', 'preferences.get_int': 'supported',
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
      // littlefs on the board's storage_partition, via <zephyr/fs/fs.h>. The
      // shim mounts at /lfs lazily (formats on first use) and the HAL paths are
      // treated as paths within the filesystem. Requires CONFIG_FILE_SYSTEM +
      // CONFIG_FILE_SYSTEM_LITTLEFS (emitted by the scaffold when fs.* is used)
      // and the storage_partition node.
      supported: true,
      partialCoverage: false,
      ops: {
        'fs.read_text': 'supported', 'fs.write_text': 'supported',
        'fs.exists': 'supported', 'fs.remove': 'supported',
      },
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
    sensor: {
      // DT-bound sensor parts — the generic catalog (hal/sensor.ts +
      // sensor-catalog.generated.ts). fetch → sensor_sample_fetch,
      // get → sensor_channel_get on a per-sensor device handle; the overlay
      // generator emits the DT child node, and the driver's own Kconfig
      // `default y` lights it up (only CONFIG_SENSOR is set, usage-gated).
      supported: true,
      partialCoverage: false,
      ops: {
        'sensor.fetch': 'supported',
        'sensor.get': 'supported',
      },
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
      // CDC-ACM serial over the board's USB connector. BOARD-GATED: the
      // lowering only fires when the board's manifest carries zephyr.usb.*
      // (boardgen emits it from the board's own DTS) — the manifest probe
      // runs with no board, so the honest declaration is unsupported here.
      supported: false,
      unsupportedReason: 'Board-gated: USB lowers only on boards whose DTS enables the USB device controller (boardgen emits zephyr.usb.* from the catalog).',
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
      { id: 'wiring_compat', domain: 'standard', notes: 'HIGH/LOW/digitalRead/etc. macros routing Wiring tokens (referenced unconditionally by the UI runtime header) to the __tc_gpio_* helpers' },
      { id: 'string_methods', domain: 'embedded', notes: 'STL-free __tc_* string helpers (const char*, inline ASCII case conv, <cstring> only)' },
      { id: 'static_array', domain: 'embedded', notes: 'STL-free __tc_StaticArray<T,N> wrapper for no-<vector> mutated/struct array literals' },
      { id: 'async_runtime', domain: 'embedded', notes: 'Heap-free static Promise/microtask runtime (generateStaticAsyncRuntime), pumped in loop()' },
    ],
    suppressed: [],
  },

  toolchain: {
    backend: 'west',
    operations: { prepare: true, compile: true, upload: true, monitor: true, debug: true },
  },

  libraryResolution: {
    isFrameworkLibraryImport: false,
    getFrameworkLibraryHeaderName: false,
    buildClassNameMap: false,
    tryGenerateLibDecl: false,
  },

  typeEmission: {
    normalizeCppType: true,
    mathHeader: '<cmath>',
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
    // Hardware-test groups moved to the shared HAL suite
    // (packages/hal/tests — common/ + board/ via board test-pins.json), which
    // runs on Zephyr targets through the hal board configs. The
    // hal-resolution snapshots below stay.
    hardwareTestGroups: [],
    // Per-op HAL-resolution suite — one tests/packages/framework-zephyr/
    // hal-resolution/<cat>.test.ts per category, snapshotting the exact C++
    // each op lowers to. Mirrors the framework-esp32 convention. These are
    // pure string-snapshot tests (no hardware); they are the safety net that
    // catches regressions like silent pull-resistor / interrupt no-ops.
    halResolutionTests: [
      'adc', 'ble', 'board', 'dac', 'fs', 'gpio', 'http', 'hwtimer', 'i2c',
      'interrupts', 'mqtt', 'preferences', 'pwm', 'random',
      'spi', 'thin-buses', 'thin-classes', 'thread', 'timing',
      'uart', 'usb', 'wdt', 'wifi',
    ],
  },

  // Declared compatibility range for the installed Zephyr RTOS. The framework's
  // build-time version check (toolchain/compat.ts) reads this and fails fast
  // with a clear message when the user's Zephyr is outside the range, instead
  // of letting west/CMake surface a cryptic board-target error (the class of
  // breakage behind the HWMv2 qualifier requirement in Zephyr 4.3+).
  compat: {
    zephyr: '>=4.3 <5.0',
  },

  // `typecad-hal doctor` prints the detected Zephyr version + compat result and
  // previews how the configured board target resolves for that version.
  doctor: { available: true },

  // `typecad-hal licenses` enumerates the Zephyr kernel + west manifest projects
  // and resolves each one's SPDX license (mirrors framework-arduino).
  licenses: { available: true },
});
