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
    },
    defines: {
      F_CPU:         '133000000UL',
      ARDUINO:       ARDUINO_CORE_VERSION,
      ARDUINO_RPIPICO: '1',
    },
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
