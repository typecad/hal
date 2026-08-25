// ---------------------------------------------------------------------------
// @typecad/board-esp32-devkit — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32WROOM32 } from '@typecad/mcu-esp32';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32DevKit: BoardDefinition = {
  id: 'esp32-devkit',
  name: 'ESP32 DevKit',
  vendor: 'Espressif',
  description: 'ESP32 DevKit v1 (38-pin) — ESP32-WROOM-32',

  mcu: ESP32WROOM32,
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 4 * 1024 * 1024,  // 4 MB module flash (WROOM-32 default)
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ESP32WROOM32.pins,
    led: 'GPIO2',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32WROOM32.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      UART2: 'Serial2',
      I2C0:  'Wire',
      I2C1:  'Wire1',
      SPI0:  'SPI',
      SPI1:  'SPI1',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      arduino: 'esp32:esp32:esp32',
      // The Zephyr board target for `west build -b <target>` — fully
      // qualified (board/soc/core); the bare id is rejected on Zephyr >=4.3.
      zephyr: 'esp32_devkitc/esp32/procpu',
    },
    defines: {
      F_CPU:            '240000000UL',
      ARDUINO:          ARDUINO_CORE_VERSION,
      ARDUINO_ESP32_DEV: '1',
    },
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Mirrors framework-zephyr's hardcoded ESP32_DEVKITC
  // descriptor (src/chips/esp32.ts), verified against esp32_devkitc_procpu.dts.
  //
  // GPIO is split across two devicetree controllers — gpio0 (pins 0–31) and
  // gpio1 (pins 32–39) — so the runtime pin→controller routing is carried here
  // (a compile-time DT macro cannot reach it). Bus controllers, ADC channels
  // and the watchdog nodelabel below are the board-DTS-verified facts the
  // lowerings resolve against.
  zephyr: {
    gpioController: 'gpio0',
    gpioControllers: [
      { nodelabel: 'gpio0', minPin: 0, maxPin: 31 },
      { nodelabel: 'gpio1', minPin: 32, maxPin: 39 },
    ],
    gpio: {
      // The BOOT button (GPIO0) is the board's only DT-aliased GPIO. Listed so
      // a program reading/interrupting pin 0 goes through the polarity-correct
      // devicetree-spec path (GPIO_ACTIVE_LOW honored by the DT flags).
      dtSpecs: [
        { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
      ],
      interruptPins: [
        { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
      ],
    },
    // Board-wired controllers (esp32_devkitc_procpu.dts): uart0 = console
    // @115200 on the USB-serial bridge (GPIO1/GPIO3), i2c0 (GPIO21/22,
    // standard mode), spi2 + spi3 (GPSPI2/GPSPI3, pinctrl spim2/spim3_default,
    // both enabled). The overlay generator enables whichever the program uses.
    //
    // UART: the HAL instances deliberately map to the NON-console
    // controllers. The lowering resolves HAL UART instance N against
    // uart.controllers[N] (the board defines map UART0→"Serial" = index 0),
    // so declaring [uart1, uart2] puts UART0 on uart1 (and UART1 on uart2) —
    // exercising the UART never reconfigures the console mid-protocol. Both
    // carry default pinctrl groups in the board DTS (uart1_default/uart2_default).
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }] },
    spi:  { controllers: [{ nodeLabel: 'spi2' }, { nodeLabel: 'spi3' }] },
    uart: { controllers: [{ nodeLabel: 'uart1' }, { nodeLabel: 'uart2' }] },
    // ADC1 (the `adc0` DT node; ADC2 shares pads with the Wi-Fi radio and is
    // deliberately not mapped). 12-bit SARADC, ~1.1 V internal reference.
    // Channel numbering per the ESP32 datasheet: ADC1_CH0–CH7 = GPIO36, 37,
    // 38, 39, 32, 33, 34, 35 (A0 = GPIO36 is CH0). The node ships disabled
    // in esp32_common.dtsi — the overlay generator enables it on adc use.
    adc: {
      nodeLabel: 'adc0',
      resolution: 12,
      vrefMv: 1100,
      channels: [
        { pin: 36, channel: 0 },  // A0
        { pin: 37, channel: 1 },  // A1
        { pin: 38, channel: 2 },
        { pin: 39, channel: 3 },
        { pin: 32, channel: 4 },  // A4
        { pin: 33, channel: 5 },  // A5
        { pin: 34, channel: 6 },  // A2 (input-only pad)
        { pin: 35, channel: 7 },  // A3 (input-only pad)
      ],
    },
    // Timer-group 0 main watchdog — enabled in esp32_common.dtsi.
    wdt: { nodeLabel: 'wdt0' },
    // The ESP32 has a 2.4GHz radio; conn_mgr + the esp32 wifi driver
    // (CONFIG_WIFI_ESP32) provide connectivity. Omitted on radioless targets.
    wifi: { supported: true },
  },
};

export default ESP32DevKit;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package
export * from '@typecad/mcu-esp32';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API overrides (using silicon pins from MCU)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19,
  GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33,
  GPIO34, GPIO35, GPIO36, GPIO39,
} from '@typecad/mcu-esp32';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs on ESP32). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33] as const,
  /** Analog input pins. */
  analog: [GPIO36, GPIO39, GPIO34, GPIO35, GPIO32, GPIO33] as const,
  /** All GPIOs support interrupts on ESP32. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33, GPIO34, GPIO35, GPIO36, GPIO39] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33, GPIO34, GPIO35, GPIO36, GPIO39] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32 DevKit.
 */
export const PeripheralPins = {
  /** I2C bus 0 — requires GPIO21 (SDA) and GPIO22 (SCL). */
  I2C0: { SDA: 'GPIO21', SCL: 'GPIO22' } as const,
  /** I2C bus 1 — no fixed pins (remappable). */
  I2C1: { SDA: 'remappable', SCL: 'remappable' } as const,
  /** SPI bus 0 / HSPI — GPIO13 (MOSI), GPIO12 (MISO), GPIO14 (SCK). GPIO15 is default CS. */
  SPI0: { MOSI: 'GPIO13', MISO: 'GPIO12', SCK: 'GPIO14', CS: 'GPIO15' } as const,
  /** SPI bus 1 / VSPI — GPIO23 (MOSI), GPIO19 (MISO), GPIO18 (SCK). GPIO5 is default CS. */
  SPI1: { MOSI: 'GPIO23', MISO: 'GPIO19', SCK: 'GPIO18', CS: 'GPIO5' } as const,
  /** UART 0 — GPIO1 (TX) and GPIO3 (RX). USB serial. */
  UART0: { TX: 'GPIO1', RX: 'GPIO3' } as const,
  /** UART 2 — GPIO17 (TX) and GPIO16 (RX). */
  UART2: { TX: 'GPIO17', RX: 'GPIO16' } as const,
} as const;

// Board-level typed pins (including Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';