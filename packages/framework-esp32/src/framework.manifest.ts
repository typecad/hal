import { defineFrameworkManifest } from '@typecad/cuttlefish/api/shared';

// ESP32 framework manifest. Coverage reflects actual resolveHALOperation /
// lowerHalOp behavior. WiFi and HTTP are fully supported (ESP-IDF native).
//
// Display is declared unsupported: ESP32 has no ESP-IDF display driver
// lowering (lowering/index.ts:46 throws). The strategy inherits Arduino's
// resolveDisplayOp, which still lowers display.init — a latent inheritance
// bug the validator catches. Resolution tracked for v1.1.

export default defineFrameworkManifest({
  schemaVersion: 1,
  frameworkId: 'esp32',
  packageName: '@typecad/framework-esp32',
  canonical: false,
  displayName: 'ESP32 (ESP-IDF)',
  description: 'Native ESP32 framework targeting ESP-IDF (no Arduino core).',
  basedOn: '@typecad/framework-arduino',
  implementationMode: 'extends-canonical',
  inheritsStrategyId: 'arduino',

  entrypoint: {
    entrypointFunctionName: 'setup',
    requiresLoopFunction: true,
    sourceExtension: 'cc',
    overrideBaseName: 'main',
    outputSubdirectory: 'main',
    generateHeaderFile: true,
    customBridgeShim: 'app_main',
  },

  profile: {
    targets: ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'],
    forcedIncludes: ['<stdio.h>', '<string.h>', '"freertos/FreeRTOS.h"', '"esp_log.h"', '"esp_system.h"'],
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
      partialCoverage: true,
      ops: {
        'adc.read': 'probe-inconclusive',
        'adc.get_resolution': 'supported',
        'adc.set_reference': 'supported',
        'adc.get_reference': 'supported',
        'adc.read_voltage': 'probe-inconclusive',
      },
    },
    dac: {
      supported: true,
      partialCoverage: false,
      ops: {
        'dac.write': 'probe-inconclusive',
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
        'i2c.write_bytes': 'probe-inconclusive',
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
      partialCoverage: false,
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
        'board.resolve': 'supported',
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
      supported: true,
      partialCoverage: false,
      ops: {
        'wifi.connect': 'supported',
        'wifi.connect_start': 'supported',
        'wifi.disconnect': 'supported',
        'wifi.status': 'supported',
        'wifi.is_connected': 'supported',
        'wifi.local_ip': 'supported',
        'wifi.rssi': 'supported',
        'wifi.mac': 'supported',
        'wifi.set_hostname': 'supported',
        'wifi.set_static_ip': 'supported',
        'wifi.set_auto_reconnect': 'supported',
        'wifi.set_power_save': 'supported',
        'wifi.set_tx_power': 'supported',
        'wifi.on_event': 'supported',
        'wifi.ap_start': 'supported',
        'wifi.ap_stop': 'supported',
        'wifi.ap_client_count': 'supported',
        'wifi.ap_ip': 'supported',
        'wifi.ap_set_channel': 'supported',
        'wifi.ap_set_hidden': 'supported',
        'wifi.ap_set_max_clients': 'supported',
        'wifi.scan': 'supported',
        'wifi.scan_start': 'supported',
        'wifi.scan_done': 'supported',
        'wifi.scan_count': 'supported',
        'wifi.scan_ssid': 'supported',
        'wifi.scan_rssi': 'supported',
        'wifi.scan_encryption': 'supported',
        'wifi.scan_channel': 'supported',
        'wifi.save_credentials': 'supported',
        'wifi.connect_saved': 'supported',
        'wifi.clear_credentials': 'supported',
        'wifi.wait_connected': 'supported',
        'wifi.wait_disconnected': 'supported',
      },
    },
    http: {
      supported: true,
      partialCoverage: false,
      ops: {
        'http.begin': 'supported',
        'http.reset': 'supported',
        'http.set_header': 'supported',
        'http.set_timeout': 'supported',
        'http.set_max_body': 'supported',
        'http.set_body': 'supported',
        'http.set_insecure': 'supported',
        'http.set_ca_cert': 'supported',
        'http.send': 'supported',
        'http.send_start': 'supported',
        'http.done': 'supported',
        'http.status': 'supported',
        'http.ok': 'supported',
        'http.body': 'supported',
        'http.content_length': 'supported',
        'http.response_header': 'supported',
      },
    },
    display: {
      // HONEST DECLARATION: ESP32 has no native display lowering yet (v1.1).
      // lowerHalOp throws at lowering/index.ts:46. The strategy inherits
      // Arduino's resolveDisplayOp, which still lowers display.init — a
      // latent inheritance bug the validator catches. Resolution tracked for
      // v1.1: override resolveDisplayOp to throw on ESP32.
      supported: false,
      unsupportedReason: 'Deferred to v1.1; ESP-IDF display drivers pending. See packages/framework-esp32/src/lowering/index.ts:46.',
      drivers: [],
      colorFormat: null,
      partialCoverage: false,
      ops: {
        'display.init': 'unsupported',
        'display.fill_rect': 'unsupported',
        'display.draw_text': 'unsupported',
        'display.draw_rect': 'unsupported',
        'display.flush': 'unsupported',
      },
    },
    raw: { supported: true },
  },

  polyfills: {
    emitted: [
      { id: 'string_methods', domain: 'standard' },
      { id: 'cuttlefish_halt', domain: 'esp32', notes: 'Mapped to esp_system_abort' },
      { id: 'timer_methods', domain: 'standard' },
      { id: 'static_array', domain: 'standard' },
    ],
    suppressed: [],
  },

  toolchain: {
    backend: 'idf.py',
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
    needsIostream: true,
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

  ambientTypes: ['Timing', 'WDT', 'Preferences', 'EEPROM'],

  conformance: {
    hardwareTestGroups: ['01-hardware', '02-math-bits', '03-advanced'],
    halResolutionTests: [
      'adc', 'dac', 'gpio', 'http', 'i2c', 'interrupts', 'power', 'pulse-shift',
      'pwm', 'spi', 'timing', 'tone', 'uart', 'wdt', 'wifi',
    ],
  },
});
