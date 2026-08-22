// ---------------------------------------------------------------------------
// @typecad/board-rp2040 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { RP2040 } from '@typecad/mcu-rp2040';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const RP2040Board: BoardDefinition = {
  id: 'rp2040',
  name: 'RP2040 (Pico)',
  vendor: 'Raspberry Pi',
  description:
    'Generic Raspberry Pi Pico (RP2040). Dual-core ARM Cortex-M0+ @ 133 MHz. ' +
    '30 GPIO, 264 KB SRAM, 2 MB QSPI flash. No wireless. USB device mode.',

  mcu: RP2040,
  clockSpeed: 133_000_000,

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 2 * 1024 * 1024,
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...RP2040.pins,
    // Board overlay: the Pico onboard LED is on GP25.
    led: 'GP25',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...RP2040.peripherals,
    aliases: {
      UART0: 'Serial1',
      UART1: 'Serial2',
      I2C0:  'Wire',
      I2C1:  'Wire1',
      SPI0:  'SPI',
      SPI1:  'SPI1',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      arduino: 'rp2040:rp2040:rpipico',
      // The Zephyr board target for `west build -b <target>`.
      zephyr: 'rpi_pico',
    },
    defines: {
      F_CPU:         '133000000UL',
      ARDUINO:       ARDUINO_CORE_VERSION,
      ARDUINO_RPIPICO: '1',
    },
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Verified against Zephyr 4.3's
  // boards/raspberrypi/rpi_pico/rpi_pico-common.dtsi, rpi_pico-led.dtsi, and
  // the common pinctrl dtsi.
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener.
  zephyr: {
    // Single GPIO controller — every exposed GP pin (0–28) is on gpio0.
    gpioController: 'gpio0',
    gpio: {
      // Pico onboard LED on GP25, GPIO_ACTIVE_HIGH in rpi_pico-led.dtsi.
      // Pins without a dtSpec fall back to the raw gpio0 controller path.
      dtSpecs: [
        { pin: 25, dtSpec: 'led0' },
      ],
      // No gpio-keys node in mainline rpi_pico DTS (no `sw0` alias) — an
      // entry here would emit GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios) and fail
      // to compile. Same situation as the XIAO nRF52840.
      interruptPins: [],
    },
    // Board-wired controllers (rpi_pico-common.dtsi):
    //   uart0 = GP0/GP1, i2c0 = GP4/GP5, spi0 = GP16–GP19 (okay by default;
    //   the overlay generator enables whichever the program uses).
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }] },
    spi:  { controllers: [{ nodeLabel: 'spi0' }] },
    uart: { controllers: [{ nodeLabel: 'uart0' }] },
    // ADC: 12-bit SAR, vref-mv defaults to 3300 in the raspberrypi,pico-adc
    // binding; GP26–GP29 = channels 0–3 (adc_default pinctrl group).
    adc: {
      nodeLabel: 'adc',
      resolution: 12,
      vrefMv: 3300,
      channels: [
        { pin: 26, channel: 0 },
        { pin: 27, channel: 1 },
        { pin: 28, channel: 2 },
        { pin: 29, channel: 3 },
      ],
    },
    wdt: { nodeLabel: 'wdt0' },
    // NOTE: no pwm.specs — the `pwm-led0` alias (PWM slice 4B on GP25) points
    // at a `pwm_leds` node that is status = "disabled" in mainline rpi_pico
    // DTS; the overlay generator does not enable it, so a spec here would
    // compile but fail at runtime. pwm.* ops lower to a comment until a board
    // overlay enables the node.
  },
};

export default RP2040Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package
export * from '@typecad/mcu-rp2040';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses local silicon pins)
import {
  GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7,
  GP8, GP9, GP10, GP11, GP12, GP13, GP14, GP15,
  GP16, GP17, GP18, GP19, GP20, GP21, GP22,
  GP26, GP27, GP28,
} from '@typecad/mcu-rp2040';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all GPIOs except GP23–GP25, which are board-internal). */
  pwm: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
        GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
        GP20, GP21, GP22, GP26, GP27, GP28] as const,
  /** Analog input pins (ADC0–ADC2 on GP26–GP28). */
  analog: [GP26, GP27, GP28] as const,
  /** All GPIOs support interrupts on RP2040. */
  interrupt: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
              GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
              GP20, GP21, GP22, GP26, GP27, GP28] as const,
  /** All digital I/O pins. */
  digital: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
            GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
            GP20, GP21, GP22, GP26, GP27, GP28] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the RP2040 (Pico).
 */
export const PeripheralPins = {
  /** I2C bus 0 — GP4 (SDA) / GP5 (SCL). */
  I2C0: { SDA: 'GP4', SCL: 'GP5' } as const,
  /** SPI bus 0 — GP19 (MOSI), GP16 (MISO), GP18 (SCK). GP17 is default CS. */
  SPI0: { MOSI: 'GP19', MISO: 'GP16', SCK: 'GP18', CS: 'GP17' } as const,
  /** UART 0 — GP0 (TX) / GP1 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GP0', RX: 'GP1' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
