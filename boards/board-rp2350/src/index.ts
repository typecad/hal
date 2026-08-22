// ---------------------------------------------------------------------------
// @typecad/board-rp2350 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { RP2350 } from '@typecad/mcu-rp2350';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const RP2350Board: BoardDefinition = {
  id: 'rp2350',
  name: 'RP2350 (Pico 2)',
  vendor: 'Raspberry Pi',
  description:
    'Generic Raspberry Pi Pico 2 (RP2350). Dual-core ARM Cortex-M33 @ 150 MHz. ' +
    '48 GPIO, 520 KB SRAM, 4 MB QSPI flash. No wireless. USB device mode. FPU.',

  mcu: RP2350,
  clockSpeed: 150_000_000,

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 4 * 1024 * 1024,
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...RP2350.pins,
    // Board overlay: the Pico 2 onboard LED is on GP25.
    led: 'GP25',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...RP2350.peripherals,
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
      arduino: 'rp2040:rp2040:rpipico2',
      // The Zephyr board target for `west build -b <target>`. Qualified with
      // the soc/cpucluster path: the rpi_pico2 board ships hazard3 (RISC-V)
      // and m33 (Cortex-M33) variants with no default, so Zephyr 4.3+ rejects
      // the bare `rpi_pico2` name. M33 matches the ARM toolchain the rest of
      // the Zephyr targets use.
      zephyr: 'rpi_pico2/rp2350a/m33',
    },
    defines: {
      F_CPU:           '150000000UL',
      ARDUINO:         ARDUINO_CORE_VERSION,
      ARDUINO_RPIPICO2: '1',
    },
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Verified against Zephyr 4.3's
  // boards/raspberrypi/rpi_pico2/rpi_pico2.dtsi + rpi_pico2_rp2350a_m33.dts,
  // rpi_pico-led.dtsi, and the common pinctrl dtsi (Pico and Pico 2 are pin
  // compatible).
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener.
  zephyr: {
    // Single GPIO controller — every exposed GP pin (0–28) is on gpio0.
    gpioController: 'gpio0',
    gpio: {
      // Pico 2 onboard LED on GP25, GPIO_ACTIVE_HIGH in rpi_pico-led.dtsi
      // (shared with the Pico). Pins without a dtSpec fall back to the raw
      // gpio0 controller path.
      dtSpecs: [
        { pin: 25, dtSpec: 'led0' },
      ],
      // No gpio-keys node in mainline rpi_pico2 DTS (no `sw0` alias) — an
      // entry here would emit GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios) and fail
      // to compile. Same situation as the XIAO nRF52840.
      interruptPins: [],
    },
    // Board-wired controllers (rpi_pico2.dtsi, identical pinout to the Pico):
    //   uart0 = GP0/GP1, i2c0 = GP4/GP5, spi0 = GP16–GP19.
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }] },
    spi:  { controllers: [{ nodeLabel: 'spi0' }] },
    uart: { controllers: [{ nodeLabel: 'uart0' }] },
    // ADC: 12-bit SAR (raspberrypi,pico-adc binding, vref-mv default 3300);
    // GP26–GP29 = channels 0–3 (adc_default pinctrl group).
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
    // NOTE: no pwm.specs — the `pwm-led0` alias (PWM channel 9, GP25) points
    // at a `pwm_leds` node that is status = "disabled" in mainline rpi_pico
    // DTS; the overlay generator does not enable it, so a spec here would
    // compile but fail at runtime. pwm.* ops lower to a comment until a board
    // overlay enables the node.
  },
};

export default RP2350Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package
export * from '@typecad/mcu-rp2350';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses local silicon pins)
import {
  GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7,
  GP8, GP9, GP10, GP11, GP12, GP13, GP14, GP15,
  GP16, GP17, GP18, GP19, GP20, GP21, GP22, GP23,
  GP24, GP25, GP26, GP27, GP28, GP29, GP30, GP31,
  GP32, GP33,
} from '@typecad/mcu-rp2350';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all GPIOs except GP24/GP25, which are board-internal). */
  pwm: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
        GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
        GP20, GP21, GP22, GP23, GP24, GP25, GP26, GP27, GP28, GP29,
        GP30, GP31, GP32, GP33] as const,
  /** Analog input pins (ADC0–ADC7 on GP26–GP33). */
  analog: [GP26, GP27, GP28, GP29, GP30, GP31, GP32, GP33] as const,
  /** All GPIOs support interrupts on RP2350. */
  interrupt: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
              GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
              GP20, GP21, GP22, GP23, GP24, GP25, GP26, GP27, GP28, GP29,
              GP30, GP31, GP32, GP33] as const,
  /** All digital I/O pins. */
  digital: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
            GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
            GP20, GP21, GP22, GP23, GP24, GP25, GP26, GP27, GP28, GP29,
            GP30, GP31, GP32, GP33] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the RP2350 (Pico 2).
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
