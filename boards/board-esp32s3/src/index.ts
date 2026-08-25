// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32S3 } from '@typecad/mcu-esp32s3';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32S3Board: BoardDefinition = {
  id: 'esp32s3',
  name: 'ESP32-S3',
  vendor: 'Espressif',
  description:
    'Generic ESP32-S3 (vendor-agnostic). Dual-core Xtensa LX7 @ 240 MHz ' +
    'with Wi-Fi 4 + BLE 5 and native USB-OTG. Flash/PSRAM are module-dependent; ' +
    'override via FQBN menu options, e.g. ' +
    'esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi',

  mcu: ESP32S3,
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 8 * 1024 * 1024,        // 8 MB module flash (N8R2-class default)
    externalRam: 2 * 1024 * 1024,  // 2 MB octal PSRAM
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ESP32S3.pins,
    led: 'GPIO48',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32S3.peripherals,
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
      arduino: 'esp32:esp32:esp32s3',
      // The Zephyr board target for `west build -b <target>` — fully
      // qualified (board/soc/core); the bare id is rejected on Zephyr >=4.3.
      zephyr: 'esp32s3_devkitc/esp32s3/procpu',
    },
    defines: {
      F_CPU:              '240000000UL',
      ARDUINO:            ARDUINO_CORE_VERSION,
      ARDUINO_ESP32S3_DEV: '1',
    },
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Mirrors framework-zephyr's hardcoded
  // ESP32S3_DEVKITC descriptor (src/chips/esp32s3.ts), verified against
  // esp32s3_devkitc_procpu.dts.
  //
  // GPIO is split across two devicetree controllers — gpio0 (pins 0–31) and
  // gpio1 (pins 32–48) — so the runtime pin→controller routing is carried here
  // (a compile-time DT macro cannot reach it). Bus controllers, ADC channels
  // and the watchdog nodelabel below are the board-DTS-verified facts the
  // lowerings resolve against. The onboard RGB LED is a WS2812 on GPIO38 (not
  // a plain GPIO), so it is not listed here — same as the framework descriptor.
  zephyr: {
    gpioController: 'gpio0',
    gpioControllers: [
      { nodelabel: 'gpio0', minPin: 0, maxPin: 31 },
      { nodelabel: 'gpio1', minPin: 32, maxPin: 48 },
    ],
    gpio: {
      // The BOOT button (GPIO0) is the board's only DT-aliased GPIO. Listed so a
      // program reading/interrupting pin 0 goes through the polarity-correct
      // devicetree-spec path (GPIO_ACTIVE_LOW honored by the DT flags). Every
      // other GPIO pin uses the raw-controller path against its owning controller.
      dtSpecs: [
        { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
      ],
      interruptPins: [
        { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
      ],
    },
    // Board-wired controllers (esp32s3_devkitc_procpu.dts): uart0 = console
    // @115200 (the USB-serial bridge), i2c0 (pinctrl i2c0_default), spi2 +
    // spi3 (GPSPI2/GPSPI3, pinctrl spim2/spim3_default, both enabled),
    // uart1 (pinctrl uart1_default — uart2 carries no default group in the
    // board DT). The overlay generator enables whichever the program uses.
    //
    // UART: the HAL instances deliberately map to the NON-console controller —
    // the lowering resolves HAL UART instance N against uart.controllers[N]
    // (the board defines map UART0→"Serial" = index 0), so declaring [uart1]
    // puts UART0 on uart1 and exercising the UART never reconfigures the
    // console mid-protocol. The esp32s3_devkitc pinctrl dtsi defines a
    // uart1_default group but the board DTS never attaches it to &uart1 —
    // pinctrlRef wires the existing group when the overlay enables the node.
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }] },
    spi:  { controllers: [{ nodeLabel: 'spi2' }, { nodeLabel: 'spi3' }] },
    uart: { controllers: [
      {
        nodeLabel: 'uart1',
        pinctrlRef: 'uart1_default',
        // The esp32-uart binding requires current-speed once the node is
        // enabled; the board DTS only sets it on the console uart0.
        props: ['current-speed = <115200>;'],
      },
    ] },
    // ADC1 (the `adc0` DT node; ADC2 shares pads with the Wi-Fi radio and is
    // deliberately not mapped). 12-bit SARADC, ~1.1 V internal reference.
    // Channel numbering per the ESP32-S3 datasheet: ADC1_CH0–CH9 = GPIO1–10
    // (A0 = GPIO1 is CH0). The node ships disabled in esp32s3_common.dtsi —
    // the overlay generator enables it on adc use.
    adc: {
      nodeLabel: 'adc0',
      resolution: 12,
      vrefMv: 1100,
      channels: [
        { pin: 1, channel: 0 },   // A0
        { pin: 2, channel: 1 },   // A1
        { pin: 3, channel: 2 },
        { pin: 4, channel: 3 },
        { pin: 5, channel: 4 },
        { pin: 6, channel: 5 },
        { pin: 7, channel: 6 },
        { pin: 8, channel: 7 },
        { pin: 9, channel: 8 },
        { pin: 10, channel: 9 },
      ],
    },
    // Timer-group 0 main watchdog — enabled in esp32s3_common.dtsi.
    wdt: { nodeLabel: 'wdt0' },
    // The ESP32-S3 has a 2.4GHz radio; conn_mgr + the esp32 wifi driver
    // (CONFIG_WIFI_ESP32) provide connectivity. Omitted on radioless targets.
    wifi: { supported: true },
  },
};

export default ESP32S3Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level (local MCU module)
export * from '@typecad/mcu-esp32s3';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses local silicon pins)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43, GPIO44,
  GPIO45, GPIO46, GPIO47, GPIO48,
} from '@typecad/mcu-esp32s3';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs that are not flash/USB/strap). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
        GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
        GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
  /** Analog input pins (ADC1 — usable while Wi-Fi active). */
  analog: [GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9, GPIO10] as const,
  /** All GPIOs support interrupts on ESP32-S3. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
              GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
              GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
            GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
            GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-S3.
 */
export const PeripheralPins = {
  /** I2C bus 0 — default GPIO8 (SDA) / GPIO9 (SCL); remappable via GPIO matrix. */
  I2C0: { SDA: 'GPIO8',  SCL: 'GPIO9'  } as const,
  /** I2C bus 1 — no fixed pins (remappable). */
  I2C1: { SDA: 'remappable', SCL: 'remappable' } as const,
  /** SPI bus 0 / FSPI — GPIO12 (MOSI), GPIO13 (MISO), GPIO11 (SCK). GPIO10 is default CS. */
  SPI0: { MOSI: 'GPIO12', MISO: 'GPIO13', SCK: 'GPIO11', CS: 'GPIO10' } as const,
  /** SPI bus 1 / GPSI — no fixed pins (remappable). */
  SPI1: { MOSI: 'remappable', MISO: 'remappable', SCK: 'remappable' } as const,
  /** UART 0 — GPIO43 (TX) / GPIO44 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO43', RX: 'GPIO44' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
