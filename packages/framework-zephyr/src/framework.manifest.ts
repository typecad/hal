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
    // resolver. ESP32-S3 added alongside the original nRF52840 MVP target.
    targets: ['xiao_ble', 'esp32s3_devkitc'],
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
    wifi: {
      supported: false,
      unsupportedReason: 'No WiFi lowering implemented (nRF52840 has no WiFi; ESP32 WiFi not yet wired).',
      ops: unsupportedOps('wifi.'),
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
      'pwm', 'spi', 'timing', 'tone', 'uart', 'wdt',
    ],
  },
});
