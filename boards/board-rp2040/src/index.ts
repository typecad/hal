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
      USB0:  'USBSerial',
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
    //   uart0 = GP0/GP1, i2c0 = GP4/GP5 (okay by default), i2c1 = GP6/GP7
    //   (disabled in the board DTS but fully pinned — i2c1_default in
    //   rpi_pico-pinctrl-common.dtsi — so the overlay generator enables it),
    //   spi0 = GP16–GP19 (okay by default; the overlay generator enables
    //   whichever the program uses). uart1 has no default pinctrl group in
    //   the board DT — its entry below carries synthesis data instead.
    //   spi1 is not declared (unused, and likewise unpinned by the board).
    i2c:  { controllers: [{ nodeLabel: 'i2c0' }, { nodeLabel: 'i2c1' }] },
    spi:  { controllers: [{ nodeLabel: 'spi0' }] },
    // The board defines map UART0→Arduino "Serial1" (= uart1 on the Pico),
    // so uart0 (the console) is declared for completeness and HAL UART0
    // resolves to the SECOND entry — uart1 on GP8/GP9, free header pins.
    // The mainline rpi_pico DT ships no uart1 pinctrl group, so the entry
    // carries synthesis data; the overlay generator emits the group under
    // &pinctrl (UART1_TX_P8 / UART1_RX_P9) and enables the controller.
    uart: { controllers: [
      { nodeLabel: 'uart0' },
      {
        nodeLabel: 'uart1',
        pinctrl: {
          include: 'zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h',
          pinmux: ['UART1_TX_P8'],
          inputPinmux: ['UART1_RX_P9'],
        },
        // The PL011 binding requires current-speed; the board DTS only sets
        // it on its own wired uart0.
        props: ['current-speed = <115200>;'],
      },
    ] },
    // RP2040 watchdog (`wdt0`, raspberrypi,pico-watchdog @40058000) — ships
    // disabled in rp2040.dtsi; the overlay generator enables it on wdt use.
    // Note it cannot be disabled once started (single-shot tickle), same
    // operational caveat as the STM32 IWDG.
    wdt: { nodeLabel: 'wdt0' },
    // USB device: the RP2040 USBD peripheral on the USB-C connector (dedicated
    // D+/D- pads, not GPIOs). Zephyr's rpi_pico DTS labels it `zephyr_udc0`
    // and enables it by default (rpi_pico-common.dtsi:
    // `zephyr_udc0: &usbd { status = "okay"; }`), and the next-stack UDC
    // driver (drivers/usb/udc/udc_rpi_pico.c) backs it — the overlay
    // generator composes one CDC-ACM serial instance when a program uses USB0.
    // USB CDC is the Pico's primary serial link (there is no UART bridge on
    // the connector).
    usb: { controller: 'zephyr_udc0', cdcInstances: 1 },
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
    // Where the board DTS's chosen console goes (rpi_pico-common.dtsi routes
    // zephyr,console to uart0 on the GP0/GP1 header pins — a USB-serial
    // adapter is needed to see it). Set console.output: 'usb' in
    // cuttlefish.config.ts to route console.log to the USB-C connector
    // instead (the CDC port this board composes).
    consoleDescription: 'uart0 on GP0 (TX) / GP1 (RX)',
    // Storage partition synthesis: rpi_pico_common.dtsi defines only the
    // second-stage-bootloader (0x0–0x100) and a read-only code_partition —
    // no storage_partition for the ZMS-backed Preferences / littlefs FS
    // backends. The overlay generator declares this region under &flash0
    // when a program uses preferences.* or fs.*: the top 512 KB of the
    // Pico's 2 MB flash (4 KB-erased sectors, ZMS needs ≥2). The app links
    // from 0x100 and would have to exceed 1.5 MB to reach it.
    storage: { offset: 0x00180000, size: 0x00080000 },
    // PWM: GP25 — the only pad the board DT pins for PWM (pwm_ch4b_default,
    // slice 4 channel B = driver channel 9). Declared in controller+channel
    // form: the overlay generator enables &pwm (the node ships disabled in
    // rp2040.dtsi, and rpi_pico-common already attaches the pinctrl group)
    // and synthesizes the channel node — the board's own pwm_leds node also
    // ships disabled and is left untouched. Other pads would need a
    // synthesized pinctrl group (the board pins none of them).
    pwm: {
      specs: [{ pin: 25, controller: 'pwm', channel: 9 }],
    },
    //
    // Named probe methods — what `zephyr.probe` / `--probe` accept on this
    // board, for BOTH flashing and debugging (rpi_pico board.cmake):
    //   - uf2: the BOOTSEL UF2 bootloader — hold BOOTSEL while plugging in
    //     USB, the board mounts as a drive and west flash copies the UF2.
    //     Zero extra hardware, but no debug (it's a bootloader).
    //   - openocd: any CMSIS-DAP-class SWD probe on the 3-pin SWD header
    //     (the board.cmake default adapter). A Raspberry Pi Debug Probe
    //     (picoprobe) needs the raw zephyr.runner escape hatch today — its
    //     interface cfg is selected at CMake configure time
    //     (-DRPI_PICO_DEBUG_ADAPTER=picoprobe), not via runner args.
    //   - jlink: J-Link SWD (device RP2040_M0_0 per board.cmake).
    probeMethods: [
      { id: 'uf2', runner: 'uf2',
        description: 'BOOTSEL UF2 bootloader: hold BOOTSEL while plugging in USB (no debug)',
        debug: false },
      { id: 'openocd', runner: 'openocd',
        description: 'Any CMSIS-DAP-class SWD probe on the SWD header — also debugs',
        debug: true, debugInterface: 'swd',
        debugCfgSource: ['interface/cmsis-dap.cfg', 'target/rp2040.cfg'] },
      { id: 'jlink', runner: 'jlink',
        description: 'J-Link probe (SWD) — also debugs',
        debug: true, debugInterface: 'swd', debugDevice: 'RP2040_M0_0' },
    ],
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
