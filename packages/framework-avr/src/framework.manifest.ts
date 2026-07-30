import { defineFrameworkManifest } from '@typecad/cuttlefish/api/shared';

// AVR framework manifest. Coverage reflects actual resolveHALOperation behavior
// (NativeAVRStrategy inherits from ArduinoStrategy; differences are in the
// overridden methods). WiFi/HTTP are unsupported on AVR (no hardware).
//
// Display is supported for SSD1309 only (AVR's 2KB RAM excludes TFT/e-ink
// panels — see the display block below). Display HAL ops resolve through
// resolveDisplayAdapter (not resolveHALOperation), so per-op status is
// 'probe-inconclusive' by design.

export default defineFrameworkManifest({
  schemaVersion: 1,
  frameworkId: 'avr',
  packageName: '@typecad/framework-avr',
  canonical: false,
  displayName: 'AVR (bare-metal)',
  description: 'Bare-metal AVR framework. Native register access via ArduinoStrategy overrides.',
  basedOn: '@typecad/framework-arduino',
  implementationMode: 'extends-canonical',
  inheritsStrategyId: 'arduino',

  entrypoint: {
    entrypointFunctionName: 'setup',
    requiresLoopFunction: true,
    sourceExtension: 'ino',
    generateHeaderFile: false,
  },

  profile: {
    targets: ['atmega328p', 'atmega2560'],
    forcedIncludes: ['<avr/io.h>'],
    symbolAliases: {
      delay: '_native_delay_ms',
      delayMicroseconds: '_native_delay_us',
      map: '_native_map',
      constrain: '_native_constrain',
      noInterrupts: 'cli',
      interrupts: 'sei',
    },
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
        'i2c.recover': 'supported',
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
      unsupportedReason: 'AVR has no native WiFi hardware.',
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
      unsupportedReason: 'AVR has no native HTTP client.',
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
      // Native AVR drivers via framework-avr/src/displays/*. AVR's 2KB RAM
      // (ATmega328P) constrains support to page-buffered displays — only
      // SSD1309 (1KB page buffer) fits. ILI9341/ST7796S need 150KB+ RGB565
      // framebuffers or unacceptably slow direct-mode SPI on an 8-bit MCU;
      // SSD1680 needs 5KB+ mono buffers. Those three throw a clear error in
      // resolveDisplayAdapter rather than emitting uncompilable code. ESP32
      // supports ILI9341/ST7796S/SSD1309 — see framework-esp32.
      //
      // resolveDisplayOp returns undefined (display ops are resolved through
      // the adapter path, not per-op HAL lowering) and resolveDisplayAdapter
      // dispatches by driver.
      //
      // Per-op status is 'supported' — resolveDisplayOp lowers each display.*
      // op to a call into the adapter surface (display_init /
      // display_targetFillRect / etc.) via resolveNativeDisplayOp, and the
      // validator's probe sees the lowering. Earlier this was marked
      // 'probe-inconclusive' under the (incorrect) assumption that the adapter
      // path bypassed HAL lowering; that assumption was stale after
      // resolveNativeDisplayOp landed.
      supported: true,
      drivers: ['ssd1309'],
      colorFormat: 'rgb565',
      partialCoverage: false,
      ops: {
        'display.init': 'supported',
        'display.fill_rect': 'supported',
        'display.draw_text': 'supported',
        'display.draw_rect': 'supported',
        'display.flush': 'supported',
      },
    },
    // ESP32-silicon-specific peripherals. These do not exist on AVR hardware
    // (ATmega328P etc.) at all — they are ESP-IDF-only. Declared unsupported
    // here so the coverage matrix is uniform across frameworks.
    // (framework-esp32 owns the roadmap for native lowerings.)
    i2s: {
      supported: false,
      unsupportedReason: 'I2S / digital audio is an ESP32 peripheral; AVR hardware has no I2S block.',
      partialCoverage: false,
      ops: { 'i2s.init': 'unsupported', 'i2s.write': 'unsupported', 'i2s.read': 'unsupported' },
    },
    twai: {
      supported: false,
      unsupportedReason: 'CAN / TWAI is an ESP32 peripheral; AVR hardware has no CAN controller.',
      partialCoverage: false,
      ops: { 'twai.init': 'unsupported', 'twai.send': 'unsupported', 'twai.receive': 'unsupported' },
    },
    usb: {
      supported: false,
      unsupportedReason: 'USB OTG / USB-Serial-JTAG is an ESP32-S3/C3/C6 peripheral; AVR has no USB block.',
      partialCoverage: false,
      ops: { 'usb.init': 'unsupported', 'usb.write': 'unsupported', 'usb.read': 'unsupported' },
    },
    eth: {
      supported: false,
      unsupportedReason: 'Ethernet MAC is an ESP32 peripheral; AVR has no Ethernet MAC.',
      partialCoverage: false,
      ops: { 'eth.init': 'unsupported', 'eth.start': 'unsupported', 'eth.is_linked': 'unsupported' },
    },
    espnow: {
      supported: false,
      unsupportedReason: 'ESP-NOW is an ESP-exclusive wireless protocol; AVR has no WiFi radio.',
      partialCoverage: false,
      ops: { 'espnow.init': 'unsupported', 'espnow.add_peer': 'unsupported', 'espnow.send': 'unsupported', 'espnow.on_receive': 'unsupported' },
    },
    crypto: {
      supported: false,
      unsupportedReason: 'Hardware crypto acceleration (AES/SHA/HMAC/RSA/ECC) is an ESP32 peripheral; AVR has no crypto accelerator.',
      partialCoverage: false,
      ops: { 'crypto.aes_encrypt': 'unsupported', 'crypto.sha256': 'unsupported', 'crypto.hmac': 'unsupported' },
    },
    pcnt: {
      supported: false,
      unsupportedReason: 'Pulse counter (PCNT) is an ESP32 peripheral; AVR has no dedicated PCNT block.',
      partialCoverage: false,
      ops: { 'pcnt.init': 'unsupported', 'pcnt.count': 'unsupported', 'pcnt.clear': 'unsupported' },
    },
    mcpwm: {
      supported: false,
      unsupportedReason: 'Motor control PWM (MCPWM) is an ESP32 peripheral; AVR timers are general-purpose only.',
      partialCoverage: false,
      ops: { 'mcpwm.init': 'unsupported', 'mcpwm.set_duty': 'unsupported', 'mcpwm.start': 'unsupported' },
    },
    raw: { supported: true },
  },

  polyfills: {
    emitted: [
      { id: 'string_methods', domain: 'standard' },
      { id: 'cuttlefish_halt', domain: 'standard' },
      { id: 'timer_methods', domain: 'standard' },
      { id: 'static_array', domain: 'standard' },
      { id: 'console', domain: 'embedded', notes: 'Native UART console polyfill' },
      { id: 'native_millis', domain: 'embedded', notes: 'Timer0 ISR-based millis/micros' },
    ],
    suppressed: [],
  },

  toolchain: {
    backend: 'arduino-cli',
    operations: { prepare: true, compile: true, upload: true, monitor: true },
    reexportedFrom: '@typecad/framework-arduino',
  },

  libraryResolution: {
    isFrameworkLibraryImport: true,
    getFrameworkLibraryHeaderName: true,
    buildClassNameMap: true,
    tryGenerateLibDecl: true,
    reexportedFrom: '@typecad/framework-arduino',
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
      '01-basics', '15-math-functions', '16-bit-operations', '30-timing',
      '40-gpio', '41-analog', '42-timers',
    ],
    halResolutionTests: [],
  },
});
