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
    },
    defines: {
      F_CPU:           '150000000UL',
      ARDUINO:         ARDUINO_CORE_VERSION,
      ARDUINO_RPIPICO2: '1',
    },
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
