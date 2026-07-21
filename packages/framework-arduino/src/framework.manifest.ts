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
      unsupportedReason: 'Arduino core has no WiFi HAL. ESP32 WiFi lives in framework-esp32.',
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
      unsupportedReason: 'Arduino core has no HTTP client HAL. ESP32 HTTP lives in framework-esp32.',
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

  ambientTypes: ['Timing', 'EEPROM', 'WDT', 'Preferences', 'Owned', 'Shared', 'Mutable'],

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
});
