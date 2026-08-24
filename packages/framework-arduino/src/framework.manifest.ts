import { defineFrameworkManifest } from '@typecad/cuttlefish/api/shared';

// Canonical framework manifest. Generated HAL coverage reflects the actual
// resolveHALOperation / resolveDisplayOp behavior probed at manifest-creation
// time. 'probe-inconclusive' marks ops the minimal probe can't verify because
// the resolver requires a valid pin/config payload — the framework intends
// support, but the manifest validator cannot prove it without richer probes.

export default defineFrameworkManifest({
  schemaVersion: 1,
  frameworkId: 'arduino',
  packageName: '@typecad/framework-arduino',
  canonical: true,
  displayName: 'Arduino',
  description: 'Canonical Arduino framework. Targets AVR, ESP, RP2040, RP2350, SAMD, megaAVR via arduino-cli.',
  implementationMode: 'from-scratch',

  entrypoint: {
    entrypointFunctionName: 'setup',
    requiresLoopFunction: true,
    sourceExtension: 'ino',
    generateHeaderFile: false,
  },

  profile: {
    targets: ['arduino:avr:uno', 'arduino:avr:mega', 'arduino:esp32:*', 'arduino:mbed_rp2040:*'],
    forcedIncludes: ['<Arduino.h>'],
    symbolAliases: {},
  },

  hal: {
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
    pwm: {
      supported: true,
      partialCoverage: false,
      ops: {
        'pwm.write': 'supported',
        'pwm.get_frequency': 'supported',
        'pwm.get_resolution': 'supported',
      },
    },
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
      supported: true,
      partialCoverage: false,
      ops: {
        'dac.write': 'supported',
      },
    },
    interrupts: {
      supported: true,
      partialCoverage: false,
      ops: {
        'interrupt.attach': 'supported',
        'interrupt.detach': 'supported',
      },
    },
    tone: {
      supported: true,
      partialCoverage: false,
      ops: {
        'tone.play': 'supported',
        'tone.stop': 'supported',
      },
    },
    timing: {
      supported: true,
      partialCoverage: true,
      ops: {
        'timing.delay': 'supported',
        'timing.delay_microseconds': 'supported',
        'timing.millis': 'supported',
        'timing.micros': 'supported',
        'timing.free_heap': 'supported',
        'timing.set_interval': 'polyfill',
        'timing.set_timeout': 'polyfill',
        'timing.clear_interval': 'polyfill',
        'timing.clear_timeout': 'polyfill',
      },
    },
    power: {
      supported: true,
      partialCoverage: false,
      ops: {
        'power.deep_sleep': 'supported',
        'power.deep_sleep_pin': 'unsupported',
        'power.light_sleep': 'supported',
        'power.set_cpu_frequency': 'supported',
      },
    },
    i2c: {
      supported: true,
      partialCoverage: true,
      ops: {
        'i2c.begin': 'supported',
        'i2c.end': 'supported',
        'i2c.set_clock': 'supported',
        'i2c.begin_transmission': 'supported',
        'i2c.write': 'supported',
        'i2c.write_bytes': 'supported',
        'i2c.write_buffer': 'supported',
        'i2c.read_buffer': 'supported',
        'i2c.end_transmission': 'supported',
        'i2c.request_from': 'supported',
        'i2c.available': 'supported',
        'i2c.read': 'supported',
        'i2c.recover': 'unsupported',
      },
    },
    spi: {
      supported: true,
      partialCoverage: false,
      ops: {
        'spi.begin': 'supported',
        'spi.end': 'supported',
        'spi.transfer': 'supported',
        'spi.begin_transaction': 'supported',
        'spi.end_transaction': 'supported',
        'spi.set_mode': 'supported',
        'spi.set_bit_order': 'supported',
        'spi.cs_low': 'supported',
        'spi.cs_high': 'supported',
        'spi.read_buffer': 'supported',
      },
    },
    uart: {
      supported: true,
      partialCoverage: true,
      ops: {
        'uart.begin': 'supported',
        'uart.end': 'supported',
        'uart.print': 'supported',
        'uart.println': 'supported',
        'uart.printf': 'supported',
        'uart.write': 'supported',
        'uart.read': 'supported',
        'uart.peek': 'supported',
        'uart.available': 'supported',
        'uart.flush': 'supported',
      },
    },
    pulse: {
      supported: true,
      partialCoverage: false,
      ops: {
        'pulse.in': 'supported',
        'pulse.in_long': 'supported',
      },
    },
    shift: {
      supported: true,
      partialCoverage: false,
      ops: {
        'shift.out': 'supported',
        'shift.in': 'supported',
      },
    },
    board: {
      supported: true,
      partialCoverage: false,
      ops: {
        'board.resolve': 'probe-inconclusive',
      },
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
    wifi: {
      supported: false,
      unsupportedReason: 'Arduino core has no WiFi HAL. On ESP32 targets, @typecad/hal lowers WiFi natively via ESP-IDF (esp_wifi), independent of this framework.',
      partialCoverage: false,
      ops: {
        'wifi.connect': 'unsupported',
        'wifi.connect_start': 'unsupported',
        'wifi.disconnect': 'unsupported',
        'wifi.status': 'unsupported',
        'wifi.is_connected': 'unsupported',
        'wifi.local_ip': 'unsupported',
        'wifi.rssi': 'unsupported',
        'wifi.mac': 'unsupported',
        'wifi.set_hostname': 'unsupported',
        'wifi.set_static_ip': 'unsupported',
        'wifi.set_auto_reconnect': 'unsupported',
        'wifi.set_power_save': 'unsupported',
        'wifi.set_tx_power': 'unsupported',
        'wifi.on_event': 'unsupported',
        'wifi.ap_start': 'unsupported',
        'wifi.ap_stop': 'unsupported',
        'wifi.ap_client_count': 'unsupported',
        'wifi.ap_ip': 'unsupported',
        'wifi.ap_set_channel': 'unsupported',
        'wifi.ap_set_hidden': 'unsupported',
        'wifi.ap_set_max_clients': 'unsupported',
        'wifi.scan': 'unsupported',
        'wifi.scan_start': 'unsupported',
        'wifi.scan_done': 'unsupported',
        'wifi.scan_count': 'unsupported',
        'wifi.scan_ssid': 'unsupported',
        'wifi.scan_rssi': 'unsupported',
        'wifi.scan_encryption': 'unsupported',
        'wifi.scan_channel': 'unsupported',
        'wifi.save_credentials': 'unsupported',
        'wifi.connect_saved': 'unsupported',
        'wifi.clear_credentials': 'unsupported',
        'wifi.wait_connected': 'unsupported',
        'wifi.wait_disconnected': 'unsupported',
      },
    },
    http: {
      supported: false,
      unsupportedReason: 'Arduino core has no HTTP client HAL. On ESP32 targets, @typecad/hal lowers HTTP over its native WiFi stack, independent of this framework.',
      partialCoverage: false,
      ops: {
        'http.begin': 'unsupported',
        'http.reset': 'unsupported',
        'http.set_header': 'unsupported',
        'http.set_timeout': 'unsupported',
        'http.set_max_body': 'unsupported',
        'http.set_body': 'unsupported',
        'http.set_insecure': 'unsupported',
        'http.set_ca_cert': 'unsupported',
        'http.send': 'unsupported',
        'http.send_start': 'unsupported',
        'http.done': 'unsupported',
        'http.status': 'unsupported',
        'http.ok': 'unsupported',
        'http.body': 'unsupported',
        'http.content_length': 'unsupported',
        'http.response_header': 'unsupported',
      },
    },
    display: {
      supported: true,
      drivers: ['ili9341', 'st7796', 'ssd1680', 'ssd1309'],
      colorFormat: 'rgb565',
      partialCoverage: true,
      ops: {
        'display.init': 'supported',
        'display.fill_rect': 'probe-inconclusive',
        'display.draw_text': 'probe-inconclusive',
        'display.draw_rect': 'probe-inconclusive',
        'display.flush': 'probe-inconclusive',
      },
    },
    random: {
      // Arduino core random()/randomSeed(). Lowered via ArduinoStrategy.
      // ESP32 overrides to the hardware RNG (esp_random()).
      supported: true,
      partialCoverage: false,
      ops: {
        'random.int': 'supported',
        'random.range': 'supported',
        'random.seed': 'supported',
      },
    },
    // ESP32-silicon-specific peripherals. The Arduino core does not provide
    // these on AVR/SAMD/megaAVR targets; they are ESP-IDF-only. Declared
    // unsupported here so the coverage matrix is uniform across frameworks.
    // (native ESP32 lowerings are owned by @typecad/hal.)
    i2s: {
      supported: false,
      unsupportedReason: 'I2S / digital audio is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'i2s.init': 'unsupported', 'i2s.write': 'unsupported', 'i2s.read': 'unsupported' },
    },
    twai: {
      supported: false,
      unsupportedReason: 'CAN / TWAI is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'twai.init': 'unsupported', 'twai.send': 'unsupported', 'twai.receive': 'unsupported' },
    },
    usb: {
      supported: false,
      unsupportedReason: 'USB CDC-ACM needs a USB device stack; the Arduino core on AVR/SAMD has none (native-USB boards expose it as the Serial object instead).',
      partialCoverage: false,
      ops: { 'usb.begin': 'unsupported', 'usb.end': 'unsupported', 'usb.print': 'unsupported', 'usb.println': 'unsupported', 'usb.printf': 'unsupported', 'usb.write': 'unsupported', 'usb.read': 'unsupported', 'usb.available': 'unsupported', 'usb.flush': 'unsupported', 'usb.connected': 'unsupported' },
    },
    eth: {
      supported: false,
      unsupportedReason: 'Ethernet MAC is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'eth.init': 'unsupported', 'eth.start': 'unsupported', 'eth.is_linked': 'unsupported' },
    },
    espnow: {
      supported: false,
      unsupportedReason: 'ESP-NOW is an ESP-exclusive wireless protocol, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'espnow.init': 'unsupported', 'espnow.add_peer': 'unsupported', 'espnow.send': 'unsupported', 'espnow.on_receive': 'unsupported' },
    },
    crypto: {
      supported: false,
      unsupportedReason: 'Hardware crypto acceleration (AES/SHA/HMAC/RSA/ECC) is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'crypto.aes_encrypt': 'unsupported', 'crypto.sha256': 'unsupported', 'crypto.hmac': 'unsupported' },
    },
    pcnt: {
      supported: false,
      unsupportedReason: 'Pulse counter (PCNT) is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'pcnt.init': 'unsupported', 'pcnt.count': 'unsupported', 'pcnt.clear': 'unsupported' },
    },
    mcpwm: {
      supported: false,
      unsupportedReason: 'Motor control PWM (MCPWM) is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'mcpwm.init': 'unsupported', 'mcpwm.set_duty': 'unsupported', 'mcpwm.start': 'unsupported' },
    },
    // ── Remaining extended categories ────────────────────────────────────────
    // These have op-kinds in HAL_OPERATION_KINDS. fs/preferences/hwtimer/
    // snprintf are supported via the Arduino core (FS.h, Preferences, STM32
    // HardwareTimer, snprintf). The rest are genuinely unsupported on the
    // Arduino core (networking/ESP32-silicon/RTOS categories — @typecad/hal
    // owns the native lowerings). Declaring them all keeps the coverage matrix
    // uniform and satisfies the completeness check.
    fs: {
      // Arduino-core FS.h / SD.h filesystem (STM32/samd cores). ESP32 overrides
      // to esp_vfs_fat_sdmmc_mount + POSIX helpers.
      supported: true,
      partialCoverage: false,
      ops: {
        'fs.begin': 'supported', 'fs.read_text': 'supported', 'fs.write_text': 'supported',
        'fs.exists': 'supported', 'fs.remove': 'supported',
      },
    },
    mdns: {
      supported: false,
      unsupportedReason: 'No mDNS lowering in the Arduino core (requires networking stack).',
      partialCoverage: false,
      ops: { 'mdns.start': 'unsupported', 'mdns.set_hostname': 'unsupported', 'mdns.add_service': 'unsupported', 'mdns.announce': 'unsupported', 'mdns.stop': 'unsupported' },
    },
    mqtt: {
      supported: false,
      unsupportedReason: 'No MQTT lowering in the Arduino core (requires networking stack).',
      partialCoverage: false,
      ops: { 'mqtt.connect': 'unsupported', 'mqtt.on_message': 'unsupported', 'mqtt.subscribe': 'unsupported', 'mqtt.publish': 'unsupported', 'mqtt.connected': 'unsupported', 'mqtt.disconnect': 'unsupported' },
    },
    ota: {
      supported: false,
      unsupportedReason: 'No OTA lowering in the Arduino core.',
      partialCoverage: false,
      ops: { 'ota.from_url': 'unsupported', 'ota.begin': 'unsupported', 'ota.write': 'unsupported', 'ota.apply': 'unsupported' },
    },
    preferences: {
      // Arduino-core Preferences (NVS on esp32, EEPROM-backed AVR shim elsewhere).
      supported: true,
      partialCoverage: false,
      ops: {
        'preferences.begin': 'supported', 'preferences.end': 'supported', 'preferences.clear': 'supported', 'preferences.remove': 'supported',
        'preferences.put_int': 'supported', 'preferences.get_int': 'supported',
        'preferences.put_uint': 'supported', 'preferences.get_uint': 'supported',
        'preferences.put_bool': 'supported', 'preferences.get_bool': 'supported',
        'preferences.put_float': 'supported', 'preferences.get_float': 'supported',
        'preferences.put_string': 'supported', 'preferences.get_string': 'supported',
      },
    },
    worker: {
      supported: false,
      unsupportedReason: 'No worker-offload lowering in the Arduino core (single-threaded loop model).',
      partialCoverage: false,
      ops: { 'worker.submit': 'unsupported', 'worker.done': 'unsupported' },
    },
    temp: {
      supported: false,
      unsupportedReason: 'No on-chip temperature lowering in the Arduino core.',
      partialCoverage: false,
      ops: { 'temp.read': 'unsupported' },
    },
    hwtimer: {
      // STM32-Arduino HardwareTimer singletons (Timer0/1/2). ESP32 overrides to
      // the GPTimer driver.
      supported: true,
      partialCoverage: false,
      ops: {
        'hwtimer.set_frequency': 'supported', 'hwtimer.on_overflow': 'supported',
        'hwtimer.start': 'supported', 'hwtimer.stop': 'supported',
      },
    },
    capacitive: {
      supported: false,
      unsupportedReason: 'No capacitive-touch lowering in the Arduino core (no such peripheral on AVR/SAMD).',
      partialCoverage: false,
      ops: { 'capacitive.read': 'unsupported' },
    },
    rmt: {
      supported: false,
      unsupportedReason: 'RMT is an ESP32 peripheral, not part of the Arduino core on AVR/SAMD.',
      partialCoverage: false,
      ops: { 'rmt.tx_init': 'unsupported', 'rmt.tx_write_bytes': 'unsupported', 'rmt.tx_write_symbols': 'unsupported', 'rmt.tx_wait_done': 'unsupported', 'rmt.tx_deinit': 'unsupported', 'rmt.rx_init': 'unsupported', 'rmt.rx_on_received': 'unsupported', 'rmt.rx_start': 'unsupported', 'rmt.rx_stop': 'unsupported', 'rmt.rx_read': 'unsupported', 'rmt.rx_deinit': 'unsupported' },
    },
    ble: {
      supported: false,
      unsupportedReason: 'No BLE lowering as Arduino-core HAL (BLE is library-level on esp32/nRF52 cores, not core HAL).',
      partialCoverage: false,
      ops: {
        'ble.server_begin': 'unsupported', 'ble.advertise_start': 'unsupported', 'ble.advertise_stop': 'unsupported',
        'ble.add_service': 'unsupported', 'ble.add_char': 'unsupported',
        'ble.on_read': 'unsupported', 'ble.on_write': 'unsupported', 'ble.on_connect': 'unsupported',
        'ble.on_disconnect': 'unsupported', 'ble.notify': 'unsupported',
        'ble.is_connected': 'unsupported', 'ble.client_count': 'unsupported', 'ble.set_name': 'unsupported',
        'ble.until_connected': 'unsupported', 'ble.until_connected_start': 'unsupported',
        'ble.set_tx_power': 'unsupported', 'ble.status': 'unsupported',
      },
    },
    snprintf: {
      // snprintf.emit lowers to a real snprintf() call, but the minimal probe
      // (just { operation }) can't exercise it — it needs bufferName/format/
      // args, and op.args.join() throws without them. probe-inconclusive is the
      // honest status: the renderer flags it for manual review rather than the
      // validator false-negativing a real lowering.
      supported: true,
      partialCoverage: false,
      ops: { 'snprintf.emit': 'probe-inconclusive' },
    },
    raw: { supported: true },
  },

  polyfills: {
    emitted: [
      { id: 'string_methods', domain: 'standard' },
      { id: 'cuttlefish_halt', domain: 'standard' },
      { id: 'timer_methods', domain: 'standard' },
      { id: 'static_array', domain: 'standard' },
    ],
    suppressed: [],
  },

  toolchain: {
    backend: 'arduino-cli',
    operations: { prepare: true, compile: true, upload: true, monitor: true },
  },

  libraryResolution: {
    isFrameworkLibraryImport: true,
    getFrameworkLibraryHeaderName: true,
    buildClassNameMap: true,
    tryGenerateLibDecl: true,
  },

  typeEmission: {
    normalizeCppType: true,
    mathHeader: '<math.h>',
    needsStdString: false,
    needsStdVector: false,
    needsIostream: false,
    needsStdFunction: false,
    stdlibSupport: {
      hasVector: true,
      hasString: true,
      hasIostream: true,
      hasExceptions: true,
      hasRTTI: true,
      recommendedArrayImpl: 'std_vector',
      recommendedStringImpl: 'std_string',
    },
  },

  // Owned/Shared/Mutable are emitted centrally by generateVirtualTypeDeclaration
  // (config-loader.ts) for every framework, so they are not framework-specific
  // ambient types and are intentionally omitted here.
  ambientTypes: ['Timing', 'EEPROM', 'WDT', 'Preferences'],

  conformance: {
    hardwareTestGroups: [
      '01-basics', '02-arithmetic', '03-comparison', '04-control-flow', '05-scoping',
      '06-loops', '07-classes', '08-enums', '09-strings', '10-expressions',
      '11-arrays', '12-modules-types', '13-functions-collections', '14-string-methods',
      '15-math-functions', '16-bit-operations', '17-buffer-operations', '18-volatile-variables',
      '19-type-aliases-structs', '20-abstract-classes', '21-interfaces', '22-namespaces',
      '23-set-map', '24-error-handling', '25-generics', '26-instanceof', '27-nested-functions',
      '28-callback-types', '29-accessors-foreach-typeof', '30-timing', '31-eeprom', '32-wdt',
      '33-preferences', '34-num-fluent', '35-string-buffer', '36-destructuring', '37-enum',
      '99-board-dynamic',
    ],
    halResolutionTests: [],
  },

  // Optional subcommands owned by this framework. framework-arduino ships both
  // presenters (doctor checks arduino-cli + board core; licenses scans Arduino
  // library SPDX). Cuttlefish dispatches `cuttlefish doctor` / `cuttlefish
  // licenses` to the framework's runtime exports when these are available.
  doctor: { available: true },
  licenses: { available: true },
});
