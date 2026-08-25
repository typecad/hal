// ---------------------------------------------------------------------------
// @typecad/board-nano-33-iot — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { SAMD21 } from '@typecad/mcu-samd21';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const Nano33IotBoard: BoardDefinition = {
  id: 'nano-33-iot',
  name: 'Arduino Nano 33 IoT',
  vendor: 'Arduino',
  description:
    'Arduino Nano 33 IoT (Microchip SAMD21G18A, ARM Cortex-M0+ @ 48 MHz ' +
    'from the 8 MHz internal oscillator). 256 KB flash (app linked at ' +
    '0x2000 behind the 8 KB BOSSA/UF2 bootloader), 32 KB SRAM. Onboard ' +
    'LSM6DS3 IMU + ATECC608A crypto chip on I2C, u-blox NINA-W102 ' +
    'WiFi/BLE radio (UNSUPPORTED — radio pins repurposable), user LED on ' +
    'D13 (PA17, active-high). Native USB (CDC-ACM) + double-tap-reset ' +
    'bootloader flashing; SWD pads on the board underside for debugging.',

  mcu: SAMD21,
  // 48 MHz — the Zephyr board DTS's cpu0 clock-frequency (OSC8M @ 8 MHz
  // DFLL-multiplied to 48 MHz so the USB peripheral gets its 48 MHz clock).
  clockSpeed: 48_000_000,

  // ----- Memory (board-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 256 * 1024,
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...SAMD21.pins,
    // Board overlay: the user LED is on D13/PA17 (active-HIGH — the board
    // DTS's led0 gpios flag is 0). No user button on this board.
    led: 'PA17',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...SAMD21.peripherals,
    aliases: {
      UART0: 'Serial',
      USB0:  'USBSerial',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      // The Zephyr board target for `west build -b <target>`. Qualified form
      // (board/soc) — verified against Zephyr 4.3
      // boards/arduino/nano_33_iot/board.yml (soc samd21g18a).
      zephyr: 'arduino_nano_33_iot/samd21g18a',
    },
    defines: {},
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Verified against Zephyr 4.3's
  // boards/arduino/nano_33_iot/arduino_nano_33_iot.dts, its pinctrl dtsi,
  // and arduino_nano_connector.dtsi. Pin numbers use the port-block scheme
  // (PA<bit> → bit, PB<bit> → 32+bit).
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener.
  zephyr: {
    // GPIO is split across TWO devicetree controllers — one per port — so
    // the runtime pin→controller routing is carried here, same shape as the
    // STM32 per-port gpioa/gpiob/gpioc split.
    gpioController: 'porta',
    gpioControllers: [
      { nodelabel: 'porta', minPin: 0, maxPin: 31 },
      { nodelabel: 'portb', minPin: 32, maxPin: 55 },
    ],
    gpio: {
      // The board's only DT-aliased GPIO, listed so a program driving the
      // user LED goes through the devicetree-spec path. Every other pin uses
      // the raw-controller path against its owning port controller. There is
      // no sw0 button alias (the board has no user button) and hence no
      // DT-spec interrupt pin — interrupt.attach on other pins wires through
      // the raw gpio_pin_interrupt_configure path.
      dtSpecs: [
        { pin: 17, dtSpec: 'led0' },  // User LED (D13/PA17, active-high)
      ],
      interruptPins: [],
    },
    // Board-wired default-enabled controllers (arduino_nano_33_iot.dts):
    //   sercom5 = console @115200 (PB22/PB23 = D1/D0 header),
    //   sercom4 = I2C fast mode (PB8/PB9 = A4/A5 header),
    //   sercom1 = SPI (PA16/PA17/PA19 = D11/D13/D12 header).
    // sercom2/sercom3 belong to the NINA radio (unsupported) and are not
    // exposed as user buses.
    i2c:  { controllers: [{ nodeLabel: 'sercom4' }] },
    spi:  { controllers: [{ nodeLabel: 'sercom1' }] },
    uart: { controllers: [{ nodeLabel: 'sercom5' }] },
    // USB device: the SAMD21 USB peripheral on PA24/PA25 (the micro-USB
    // connector). The board DTS already carries `zephyr_udc0` (usb0,
    // enabled); the overlay generator composes one CDC-ACM serial instance
    // when a program uses USB0. Per-board PID under the Zephyr test VID so a
    // multi-board test rig can tell boards apart; test-pins.json carries the
    // same pair for host-side port matching.
    usb: { controller: 'zephyr_udc0', cdcInstances: 1, vid: '0x2FE3', pid: '0x0003',
      // 1200-baud touch-to-reset: the emitted USB shim reboots into the
      // BOSSA bootloader when the host sets the CDC baud to 1200 (the
      // bootloader checks the last word of SRAM for the Arduino SAMD magic
      // 0x07738135 — SAMD21G18A's 32 KB SRAM ends at 0x20007FFC). The host
      // side (bossac uploads) then watches for the bootloader's own USB
      // identity 2341:0057 to pick the flash port. No double-tap needed.
      touchReset: { flagAddress: 0x20007FFC, magic: 0x07738135,
        bootloaderVid: '0x2341', bootloaderPid: '0x0057' } },
    // NOTE: no wdt — Zephyr's samd21.dtsi exposes no watchdog devicetree
    // node, so wdt.* ops are flagged by profile diagnostics.
    // NOTE: no storage — the board DTS already defines a storage_partition
    // (0x3c000, 16 KB, the last flash region behind the bootloader-linked
    // app at 0x2000); the overlay only adds the /chosen pointer.
    // Human text for the build-time console.log destination note (the board
    // DTS's chosen console). Set console.output: 'usb' in cuttlefish.config.ts
    // to route console.log to the USB connector instead (freeing the D0/D1
    // pins for the UART group).
    consoleDescription: 'sercom5 on PB22 (TX, D1) / PB23 (RX, D0) at 115200',
    // PWM: the board DTS enables tcc2 (TCC2/WO1 on PA17) as `pwm-led0` with
    // a 20 ms period — the board-shipped-alias spec form. Prescaler 1024 off
    // the 48 MHz GCLK → 46.875 kHz counter clock; 16-bit counter.
    pwm: {
      specs: [
        { pin: 17, dtSpec: 'pwm-led0' },  // D13/PA17 (TCC2/WO1)
      ],
      maxFrequencyHz: 46_875,
      resolutionBits: 16,
    },
    // ADC: 12-bit. Seven inputs reach header pins (per the board dts's
    // adc_default pinctrl group, which already muxes all of them — no
    // per-channel pinctrl needed). The sam0 driver supports only gain 1x
    // and the VDDANA/2 (1.65 V @ 3.3 V) internal reference (ADC_REF_VDD_1_2
    // → INTVCC0), so reads saturate above ~1.65 V; full 0–3.3 V range is
    // not reachable through the Zephyr sam0 driver on this SoC (the AREF
    // pad is not brought to a header pin either).
    adc: {
      nodeLabel: 'adc',
      resolution: 12,
      vrefMv: 1650,
      gain: 'ADC_GAIN_1',
      reference: 'ADC_REF_VDD_1_2',
      channels: [
        { pin:  2, channel: 0 },   // PA2  (A0, AIN0)
        { pin: 40, channel: 2 },   // PB8  (A4, AIN2)
        { pin: 41, channel: 3 },   // PB9  (A5, AIN3)
        { pin: 34, channel: 10 },  // PB2  (A1, AIN10)
        { pin:  9, channel: 17 },  // PA9  (A6, AIN17)
        { pin: 10, channel: 18 },  // PA10 (A3, AIN18)
        { pin: 11, channel: 19 },  // PA11 (A2, AIN19)
      ],
    },
    // NOTE: no wifi and no ble — the NINA-W102 radio is unsupported; its
    // absence is the "no radio" signal for profile diagnostics (wifi.* /
    // ble.* ops fail with a clear error).
    //
    // NOTE: 1200-baud touch-to-reset — the emitted USB shim reboots into the
    // BOSSA bootloader when the host sets the CDC baud to 1200, and the
    // bossac upload path performs that touch automatically (see
    // usb.touchReset above). No double-tap reset needed for re-flashes.
    //
    // Named probe methods — what `zephyr.probe` / `--probe` accept on this
    // board, for BOTH flashing and debugging. bossac is the bootloader
    // route (touched automatically when touchReset data is present; needs no
    // probe wiring but cannot debug). Debugging requires a probe on the SWD
    // pads on the board underside (SWDIO=PA31, SWCLK=PA30, plus VTref/GND).
    probeMethods: [
      { id: 'bossac', runner: 'bossac',
        description: 'Built-in USB bootloader: double-tap reset, flash over the USB port (no debug)',
        debug: false },
      { id: 'openocd', runner: 'openocd',
        description: 'Any CMSIS-DAP-class SWD probe on the underside SWD pads — also debugs',
        debug: true, debugInterface: 'swd',
        debugCfg: ['reset_config none'],
        debugCfgSource: ['interface/cmsis-dap.cfg', 'target/at91samd.cfg'] },
      { id: 'jlink', runner: 'jlink',
        description: 'J-Link probe (SWD) on the underside SWD pads — also debugs',
        debug: true, debugInterface: 'swd', debugDevice: 'ATSAMD21G18' },
    ],
  },
};

export default Nano33IotBoard;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level
export * from '@typecad/mcu-samd21';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses silicon pins from MCU)
import {
  PA2, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11,
  PA12, PA13, PA14, PA15, PA16, PA17, PA18, PA19,
  PA20, PA21, PA22, PA23, PA24, PA25, PA27, PA28,
  PA30, PA31,
  PB2, PB3, PB8, PB9, PB10, PB11, PB22, PB23,
} from '@typecad/mcu-samd21';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (TCC2/WO1 on PA17 — the board-DTS-enabled channel). */
  pwm: [PA17] as const,
  /** Analog input pins (A0/A2–A6 = PA2, PA11, PA10, PA9, PB2, PB8, PB9). */
  analog: [PA2, PA9, PA10, PA11, PB2, PB8, PB9] as const,
  /** Interrupt-capable pins — on SAM D21 only port pins 0–15 carry EXTINT. */
  interrupt: [PA2, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11,
              PA12, PA13, PA14, PA15,
              PB2, PB3, PB8, PB9, PB10, PB11] as const,
  /** All digital I/O pins. */
  digital: [PA2, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11,
            PA12, PA13, PA14, PA15, PA16, PA17, PA18, PA19,
            PA20, PA21, PA22, PA23, PA24, PA25, PA27, PA28,
            PA30, PA31,
            PB2, PB3, PB8, PB9, PB10, PB11, PB22, PB23] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the Nano 33 IoT (board default wiring —
 * matches the Zephyr board DTS's default-enabled controllers).
 */
export const PeripheralPins = {
  /** I2C (sercom4) — PB8 (SDA, A4) / PB9 (SCL, A5). Shared with the
   *  onboard LSM6DS3 IMU + ATECC608A crypto chip. */
  I2C0: { SDA: 'PB8', SCL: 'PB9' } as const,
  /** SPI (sercom1) — PA16 (MOSI, D11), PA19 (MISO, D12), PA17 (SCK, D13).
   *  D10/PA21 is the conventionial chip-select. */
  SPI0: { MOSI: 'PA16', MISO: 'PA19', SCK: 'PA17', CS: 'PA21' } as const,
  /** UART (sercom5) — PB22 (TX, D1) / PB23 (RX, D0); console + USB-CDC
   *  serial available. */
  UART0: { TX: 'PB22', RX: 'PB23' } as const,
  /** USB CDC serial — the SAMD21 USB peripheral on the micro-USB connector
   *  (PA24 = D-, PA25 = D+). */
  USB0: { DM: 'PA24', DP: 'PA25' } as const,
} as const;

// Board-level typed pins (LED + A0–A7 analog aliases + D-pin aliases)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
