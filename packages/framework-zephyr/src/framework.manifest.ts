// ---------------------------------------------------------------------------
// Zephyr framework manifest
//
// Coverage reflects actual resolveHALOperation / lowerHalOp behavior. GPIO,
// PWM, ADC, I2C, SPI, UART, interrupts, tone, power, pulse, shift, WDT, BLE,
// and timing are lowered; WiFi/HTTP/display/board are honestly unsupported
// (nRF52840 has no WiFi; display deferred). The manifest validator probes
// every declared op against the resolver: a 'supported' op must lower, an
// 'unsupported' op must return undefined.
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
    targets: ['xiao_ble'],
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

    // ── Partial: Timing (delay/millis/delay_us/micros/free_heap; no timers) ─
    timing: {
      supported: true,
      partialCoverage: true,
      ops: {
        'timing.delay': 'supported',            // → k_msleep(ms)
        'timing.delay_microseconds': 'supported', // → k_busy_wait(us)
        'timing.millis': 'supported',           // → k_uptime_get_32()
        'timing.micros': 'supported',           // → k_cycle_get_32 + cycles/sec
        'timing.free_heap': 'supported',        // → 0 (no portable query; see lowering)
        // Timer ops are POLYFILL_BACKED_OPS. Declared unsupported here because
        // the framework does not emit the timer_methods polyfill yet (no async
        // runtime). The validator only requires 'polyfill' status when the
        // named polyfill is in polyfills.emitted — it is not.
        'timing.set_interval': 'unsupported',
        'timing.set_timeout': 'unsupported',
        'timing.clear_interval': 'unsupported',
        'timing.clear_timeout': 'unsupported',
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
      unsupportedReason: 'No DAC on nRF52840; lowering not applicable for the MVP target.',
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
        'power.deep_sleep_pin': 'supported',   // comment (GPIOTE sense deferred)
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
      partialCoverage: true,
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
      unsupportedReason: 'nRF52840 has no WiFi; not applicable for this target.',
      ops: unsupportedOps('wifi.'),
    },
    http: {
      supported: false,
      unsupportedReason: 'HTTP lowering deferred (requires networking stack).',
      ops: unsupportedOps('http.'),
    },
    display: {
      supported: false,
      unsupportedReason: 'Display lowering deferred.',
      drivers: [],
      colorFormat: null,
      ops: {
        'display.init': 'unsupported',
        'display.fill_rect': 'unsupported',
        'display.draw_text': 'unsupported',
        'display.draw_rect': 'unsupported',
        'display.flush': 'unsupported',
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
