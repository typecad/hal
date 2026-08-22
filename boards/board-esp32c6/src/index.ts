// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32C6 } from '@typecad/mcu-esp32c6';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32C6Board: BoardDefinition = {
  id: 'esp32c6',
  name: 'ESP32-C6',
  vendor: 'Espressif',
  description:
    'Generic ESP32-C6 devboard (vendor-agnostic). Single-core RISC-V ' +
    '(RV32IMAC) @ 160 MHz with Wi-Fi 6 (802.11ax) + BLE 5.3 and native USB ' +
    'Serial/JTAG + USB-OTG. 30 GPIO; no PSRAM support.',

  mcu: ESP32C6,
  clockSpeed: 160_000_000,

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 4 * 1024 * 1024,
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ESP32C6.pins,
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32C6.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      arduino: 'esp32:esp32:esp32c6',
      // The Zephyr board target for `west build -b <target>`. QUALIFIED form
      // required: the board ships hpcore/lpcore cpucluster variants and Zephyr
      // 4.3+ rejects the bare `esp32c6_devkitc` ("Board qualifiers ... not
      // found") — same situation as rpi_pico2. The hpcore is the RV32IMAC
      // application core; the lpcore (RV32EC) cannot run Zephyr apps.
      zephyr: 'esp32c6_devkitc/esp32c6/hpcore',
    },
    defines: {
      F_CPU:             '160000000UL',
      ARDUINO:           ARDUINO_CORE_VERSION,
      ARDUINO_ESP32C6_DEV: '1',
    },
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Mirrors the ESP32/S3 board packages' zephyr fields,
  // verified against Zephyr 4.3's
  // boards/espressif/esp32c6_devkitc/esp32c6_devkitc_hpcore.dts,
  // dts/riscv/espressif/esp32c6/esp32c6_common.dtsi, and the board pinctrl dtsi.
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener.
  zephyr: {
    // Single GPIO controller — every GPIO line (0–29) is on gpio0
    // (esp32c6_common.dtsi gpio0, ngpios = 30).
    gpioController: 'gpio0',
    gpio: {
      // The BOOT button (GPIO9) is the board's only DT-aliased GPIO —
      // `sw0 = &user_button1`, active-low + pull-up in the board DTS. The
      // onboard RGB is a WS2812, not a plain GPIO LED, so there is
      // deliberately no led0 entry. Every other pin uses the raw-controller
      // path against gpio0.
      dtSpecs: [
        { pin: 9, dtSpec: 'sw0' },  // BOOT button (GPIO9)
      ],
      interruptPins: [
        { pin: 9, dtSpec: 'sw0' },  // BOOT button (GPIO9)
      ],
    },
    // Board-wired default-enabled controllers (esp32c6_devkitc_hpcore.dts):
    //   uart0 = console @115200, i2c0 (fast mode), spi2 (GPSPI2).
    // The overlay generator enables whichever the program uses.
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }] },
    spi:  { controllers: [{ nodeLabel: 'spi2' }] },
    uart: { controllers: [{ nodeLabel: 'uart0' }] },
    // wdt0 is the lowering's default when `wdt` is omitted (both are wdt0).
    // Wi-Fi 6 + BLE 5.3 (+ 802.15.4): the board DTS enables &wifi and
    // &ieee802154; CONFIG_WIFI_ESP32 covers the whole ESP32 family.
    wifi: { supported: true },
  },
};

export default ESP32C6Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package
export * from '@typecad/mcu-esp32c6';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses local silicon pins)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27,
} from '@typecad/mcu-esp32c6';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
        GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
  /** Analog input pins (ADC1 — GPIO0–GPIO6). */
  analog: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6] as const,
  /** All GPIOs support interrupts on ESP32-C6. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
              GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
            GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-C6.
 */
export const PeripheralPins = {
  /** I2C bus 0 — GPIO23 (SDA) / GPIO22 (SCL). */
  I2C0: { SDA: 'GPIO23', SCL: 'GPIO22' } as const,
  /** SPI bus 0 — GPIO19 (MOSI), GPIO20 (MISO), GPIO21 (SCK). GPIO18 is default CS. */
  SPI0: { MOSI: 'GPIO19', MISO: 'GPIO20', SCK: 'GPIO21', CS: 'GPIO18' } as const,
  /** UART 0 — GPIO16 (TX) / GPIO17 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO16', RX: 'GPIO17' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
