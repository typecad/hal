// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32C3 } from '@typecad/mcu-esp32c3';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32C3Board: BoardDefinition = {
  id: 'esp32c3',
  name: 'ESP32-C3',
  vendor: 'Espressif',
  description:
    'Generic ESP32-C3 devboard (vendor-agnostic). Single-core RISC-V ' +
    '(RV32IMC) @ 160 MHz with Wi-Fi 4 + BLE 5 and native USB Serial/JTAG. ' +
    '22 GPIO; no PSRAM support.',

  mcu: ESP32C3,
  clockSpeed: 160_000_000, // 160 MHz

  // ----- Memory (module-level; silicon memory lives on the MCU) -----------
  // 4 MB module flash; no external RAM (the C3 silicon does not support it).
  memory: {
    flash: 4 * 1024 * 1024,
  },

  // ----- Pins (no onboard LED declared — generic board) -------------------
  pins: {
    ...ESP32C3.pins,
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32C3.peripherals,
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
      arduino: 'esp32:esp32:esp32c3',
      // The Zephyr board target for `west build -b <target>`. Qualified form
      // (board/soc): esp32c3_devkitm has a single soc variant so the bare id
      // also works, but every catalog-provided target is kept qualified for
      // consistency (verified against Zephyr 4.3
      // boards/espressif/esp32c3_devkitm/board.yml).
      zephyr: 'esp32c3_devkitm/esp32c3',
    },
    defines: {
      F_CPU:             '160000000UL',
      ARDUINO:           ARDUINO_CORE_VERSION,
      ARDUINO_ESP32C3_DEV: '1',
    },
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Mirrors the ESP32/S3 board packages' zephyr fields,
  // verified against Zephyr 4.3's
  // boards/espressif/esp32c3_devkitm/esp32c3_devkitm.dts,
  // dts/riscv/espressif/esp32c3/esp32c3_common.dtsi, and the board pinctrl dtsi.
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener.
  zephyr: {
    // Single GPIO controller — every GPIO line (0–25) is on gpio0
    // (esp32c3_common.dtsi gpio0, ngpios = 26; the board exposes GPIO0–21,
    // GPIO22–25 are the USB/flash pads).
    gpioController: 'gpio0',
    gpio: {
      // The BOOT button (GPIO9) is the board's only DT-aliased GPIO —
      // `sw0 = &user_button1`, active-low + pull-up in the board DTS. The
      // onboard RGB is a WS2812 on GPIO8, not a plain GPIO LED, so there is
      // deliberately no led0 entry. Every other pin uses the raw-controller
      // path against gpio0.
      dtSpecs: [
        { pin: 9, dtSpec: 'sw0' },  // BOOT button (GPIO9)
      ],
      interruptPins: [
        { pin: 9, dtSpec: 'sw0' },  // BOOT button (GPIO9)
      ],
    },
    // Board-wired default-enabled controllers (esp32c3_devkitm.dts):
    //   uart0 = console @115200, i2c0 (standard mode), spi2 (GPSPI2).
    // The overlay generator enables whichever the program uses.
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }] },
    spi:  { controllers: [{ nodeLabel: 'spi2' }] },
    uart: { controllers: [{ nodeLabel: 'uart0' }] },
    // ADC1 (the `adc0` DT node — the C3 has a single ADC). 12-bit SARADC,
    // ~1.1 V internal reference. Channel numbering per the ESP32-C3
    // datasheet: ADC1_CH0–CH4 = GPIO0–GPIO4 (A0 = GPIO0 is CH0). The node
    // ships disabled in esp32c3_common.dtsi — the overlay generator enables
    // it on adc use.
    adc: {
      nodeLabel: 'adc0',
      resolution: 12,
      vrefMv: 1100,
      channels: [
        { pin: 0, channel: 0 },  // A0
        { pin: 1, channel: 1 },  // A1
        { pin: 2, channel: 2 },  // A2
        { pin: 3, channel: 3 },  // A3
        { pin: 4, channel: 4 },  // A4
      ],
    },
    // Timer-group 0 main watchdog — enabled by the board DTS (&wdt0 okay in
    // esp32c3_devkitm.dts).
    wdt: { nodeLabel: 'wdt0' },
    // Wi-Fi 4 + BLE 5: the board DTS enables &wifi; CONFIG_WIFI_ESP32 covers
    // the whole ESP32 family. Omitted on radioless targets.
    wifi: { supported: true },
  },
};

export default ESP32C3Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level
export * from '@typecad/mcu-esp32c3';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses silicon pins from MCU)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
  GPIO18, GPIO19, GPIO20, GPIO21,
} from '@typecad/mcu-esp32c3';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs that are not USB/strap). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
        GPIO18, GPIO19, GPIO20, GPIO21] as const,
  /** Analog input pins (ADC1 — usable while Wi-Fi active). */
  analog: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4] as const,
  /** All GPIOs support interrupts on ESP32-C3. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
              GPIO18, GPIO19, GPIO20, GPIO21] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
            GPIO18, GPIO19, GPIO20, GPIO21] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-C3.
 */
export const PeripheralPins = {
  /** I2C bus 0 — default GPIO8 (SDA) / GPIO9 (SCL); remappable via GPIO matrix. */
  I2C0: { SDA: 'GPIO8',  SCL: 'GPIO9'  } as const,
  /** SPI bus 0 / GPSPI2 — GPIO6 (MOSI), GPIO5 (MISO), GPIO4 (SCK). GPIO7 is default CS. */
  SPI0: { MOSI: 'GPIO6', MISO: 'GPIO5', SCK: 'GPIO4', CS: 'GPIO7' } as const,
  /** UART 0 — GPIO21 (TX) / GPIO20 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO21', RX: 'GPIO20' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
