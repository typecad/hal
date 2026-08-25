// ---------------------------------------------------------------------------
// @typecad/mcu-samd21 — MCU definition manifest
//
// Microchip SAMD21G18A: ARM Cortex-M0+, 48 MHz, 256 KB flash, 32 KB SRAM,
// USB device, 6 SERCOM blocks (muxable UART/SPI/I2C). Silicon-level facts
// only — board overlays live in the board-* packages.
//
// Pin numbers use port-block numbering (PA<bit> → bit, PB<bit> → 32+bit)
// matching the Zephyr per-port porta/portb controller split. Bonded pins
// verified against Zephyr 4.3's boards/arduino/nano_33_iot devicetree chain
// (arduino_nano_33_iot.dts + pinctrl dtsi + arduino_nano_connector.dtsi).
//
// On SAM D21 only pins 0–15 of each port carry an EXTINT line, so interrupt
// capability is per-pin (not blanket like on STM32).
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import {
  I2C_INSTANCES,
  SPI_INSTANCES,
  UART_INSTANCES,
  ADC_INSTANCES,
  TIMER_INSTANCES,
} from './peripherals.js';

// ---------------------------------------------------------------------------
// Default capability flags for SAMD21
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Full GPIO: digital I/O + pull-up + pull-down + interrupt (EXTINT ≤15). No DAC. */
const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,            interrupt: YES,
  pullUp: YES,        pullDown: YES,
  touch: NO,          openDrain: YES,
} as const;

/** GPIO without EXTINT (port pins 16+). */
const NO_EXTINT = { ...FULL_GPIO, interrupt: NO } as const;

/** Full GPIO + ADC input. */
const GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;

/** ADC input, but port pin 16+ → no EXTINT (the PA9/PA10/PA11 AIN17-19 pins). */
const GPIO_ANALOG_NO_EXTINT = { ...NO_EXTINT, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// MCU definition
// ---------------------------------------------------------------------------

export const SAMD21: MCUDefinition = {
  id: 'samd21',
  name: 'SAMD21',
  architecture: 'samd21',
  memory: {
    flash:   262_144, // 256 KB
    sram:     32_768, // 32 KB
    eeprom:        0,
  },
  pins: {
    all: [
      // ---- Port A (numbers 0–31) --------------------------------------------
      // PA2 — A0 header pin; ADC AIN0.
      { number:  2, gpio:  2, name: 'PA2', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }],
        alternateFunctions: ['AIN0', 'EXTINT2'] },
      { number:  4, gpio:  4, name: 'PA4', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT4'] },
      { number:  5, gpio:  5, name: 'PA5', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT5'] },
      { number:  6, gpio:  6, name: 'PA6', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT6'] },
      { number:  7, gpio:  7, name: 'PA7', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT7'] },
      // PA8 — NINA-W102 RESET line on the Nano 33 IoT (radio held in reset
      // when driven low — WiFi/BLE via NINA is unsupported, so the line is
      // free for GPIO once you accept the radio stays off).
      { number:  8, gpio:  8, name: 'PA8', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT8', 'NINA-W102 RESET'],
        warnings: ['PA8 is the NINA-W102 radio reset line on the Nano 33 IoT — driving it low holds the radio in reset (radio support is not exposed anyway)'] },
      // PA9/PA10/PA11 — A6/A3/A2 header pins; ADC AIN17/18/19.
      { number:  9, gpio:  9, name: 'PA9', capabilities: GPIO_ANALOG_NO_EXTINT,
        functions: [{ type: 'adc', instance: 0, role: 'ch17' }],
        alternateFunctions: ['AIN17'] },
      { number: 10, gpio: 10, name: 'PA10', capabilities: GPIO_ANALOG_NO_EXTINT,
        functions: [{ type: 'adc', instance: 0, role: 'ch18' }],
        alternateFunctions: ['AIN18'] },
      { number: 11, gpio: 11, name: 'PA11', capabilities: GPIO_ANALOG_NO_EXTINT,
        functions: [{ type: 'adc', instance: 0, role: 'ch19' }],
        alternateFunctions: ['AIN19'] },
      // PA12–PA15 — the NINA-W102's SPI (sercom2) on the Nano 33 IoT.
      { number: 12, gpio: 12, name: 'PA12', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['SERCOM2_PAD0', 'NINA SPI'],
        warnings: ['PA12 is wired to the NINA-W102 radio SPI on the Nano 33 IoT — using it as GPIO disconnects the radio (radio support is not exposed anyway)'] },
      { number: 13, gpio: 13, name: 'PA13', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['SERCOM2_PAD1', 'NINA SPI'],
        warnings: ['PA13 is wired to the NINA-W102 radio SPI on the Nano 33 IoT — using it as GPIO disconnects the radio (radio support is not exposed anyway)'] },
      { number: 14, gpio: 14, name: 'PA14', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'cs' }],
        alternateFunctions: ['SERCOM2_PAD2', 'NINA CS'],
        warnings: ['PA14 is the NINA-W102 chip-select line on the Nano 33 IoT — using it as GPIO disconnects the radio (radio support is not exposed anyway)'] },
      { number: 15, gpio: 15, name: 'PA15', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['SERCOM2_PAD3', 'NINA SPI'],
        warnings: ['PA15 is wired to the NINA-W102 radio SPI on the Nano 33 IoT — using it as GPIO disconnects the radio (radio support is not exposed anyway)'] },
      // PA16 — D11 header (SPI MOSI).
      { number: 16, gpio: 16, name: 'PA16', capabilities: NO_EXTINT,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['SERCOM1_PAD0', 'TCC2/WO0'] },
      // PA17 — D13 header (SPI SCK) + onboard LED (active-high) + the board's
      // one enabled PWM channel (TCC2/WO1, the dts `pwm-led0`).
      { number: 17, gpio: 17, name: 'PA17', capabilities: { ...NO_EXTINT, pwm: YES },
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['SERCOM1_PAD1', 'TCC2/WO1', 'User LED (active-high)'] },
      { number: 18, gpio: 18, name: 'PA18', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: [] },
      { number: 19, gpio: 19, name: 'PA19', capabilities: NO_EXTINT,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['SERCOM1_PAD3'] },
      { number: 20, gpio: 20, name: 'PA20', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: [] },
      // PA21 — D10 header (SPI CS).
      { number: 21, gpio: 21, name: 'PA21', capabilities: NO_EXTINT,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }],
        alternateFunctions: [] },
      // PA22/PA23 — the NINA-W102's programming UART (sercom3).
      { number: 22, gpio: 22, name: 'PA22', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['SERCOM3_PAD0', 'NINA prog UART'],
        warnings: ['PA22 is wired to the NINA-W102 radio programming UART on the Nano 33 IoT'] },
      { number: 23, gpio: 23, name: 'PA23', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['SERCOM3_PAD1', 'NINA prog UART'],
        warnings: ['PA23 is wired to the NINA-W102 radio programming UART on the Nano 33 IoT'] },
      // PA24/PA25 — the USB data lines.
      { number: 24, gpio: 24, name: 'PA24', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['USB_DM'],
        warnings: ['PA24 is the USB D- line — using it as GPIO breaks USB (bootloader flashing, CDC console)'] },
      { number: 25, gpio: 25, name: 'PA25', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['USB_DP'],
        warnings: ['PA25 is the USB D+ line — using it as GPIO breaks USB (bootloader flashing, CDC console)'] },
      { number: 27, gpio: 27, name: 'PA27', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['NINA IRQ'],
        warnings: ['PA27 is the NINA-W102 radio IRQ line on the Nano 33 IoT'] },
      { number: 28, gpio: 28, name: 'PA28', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['NINA ready'],
        warnings: ['PA28 is the NINA-W102 radio ready line on the Nano 33 IoT'] },
      // PA30/PA31 — SWCLK/SWDIO on the bottom-side debug pads.
      { number: 30, gpio: 30, name: 'PA30', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['SWCLK'],
        warnings: ['PA30 is the SWCLK debug line — using it as GPIO breaks SWD debugging'] },
      { number: 31, gpio: 31, name: 'PA31', capabilities: NO_EXTINT,
        functions: [], alternateFunctions: ['SWDIO'],
        warnings: ['PA31 is the SWDIO debug line — using it as GPIO breaks SWD debugging'] },

      // ---- Port B (numbers 32–55) -------------------------------------------
      { number: 34, gpio: 34, name: 'PB2', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch10' }],
        alternateFunctions: ['AIN10', 'EXTINT2'] },
      { number: 35, gpio: 35, name: 'PB3', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT3'] },
      // PB8/PB9 — A4/A5 header pins; ADC AIN2/3 and the I2C bus (sercom4,
      // shared with the onboard LSM6DS3 + ATECC608A).
      { number: 40, gpio: 40, name: 'PB8', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' },
                    { type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['AIN2', 'EXTINT8', 'SERCOM4_PAD0'] },
      { number: 41, gpio: 41, name: 'PB9', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' },
                    { type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['AIN3', 'EXTINT9', 'SERCOM4_PAD1'] },
      { number: 42, gpio: 42, name: 'PB10', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT10'] },
      { number: 43, gpio: 43, name: 'PB11', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['EXTINT11'] },
      // PB22/PB23 — D1/D0 header pins; the UART + Zephyr console (sercom5).
      { number: 54, gpio: 54, name: 'PB22', capabilities: NO_EXTINT,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['SERCOM5_PAD2'],
        warnings: ['PB22 is the UART0 TX / Zephyr console line — using it as GPIO silences console output'] },
      { number: 55, gpio: 55, name: 'PB23', capabilities: NO_EXTINT,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['SERCOM5_PAD3'],
        warnings: ['PB23 is the UART0 RX line — using it as GPIO blocks serial input'] },
    ],

    digital: [
      'PA2', 'PA4', 'PA5', 'PA6', 'PA7', 'PA8', 'PA9', 'PA10', 'PA11',
      'PA12', 'PA13', 'PA14', 'PA15', 'PA16', 'PA17', 'PA18', 'PA19',
      'PA20', 'PA21', 'PA22', 'PA23', 'PA24', 'PA25', 'PA27', 'PA28',
      'PA30', 'PA31',
      'PB2', 'PB3', 'PB8', 'PB9', 'PB10', 'PB11', 'PB22', 'PB23',
    ],
    analog: ['PA2', 'PA9', 'PA10', 'PA11', 'PB2', 'PB8', 'PB9'],
    pwm: ['PA17'],
    unsafe: ['PA24', 'PA25', 'PA30', 'PA31'], // USB/SWD-shared

    i2c: {
      0: { sda: 'PB8', scl: 'PB9' },
    },
    spi: {
      0: { mosi: 'PA16', miso: 'PA19', sck: 'PA17', cs: 'PA21' },
    },
    uart: {
      0: { tx: 'PB22', rx: 'PB23' },
    },
  },

  peripherals: {
    i2c: I2C_INSTANCES,
    spi: SPI_INSTANCES,
    uart: UART_INSTANCES,
    adc: ADC_INSTANCES,
    timers: TIMER_INSTANCES,
    pwm: { channels: 4, resolution: 16, maxFrequency: 46_875 },
    aliases: {},
  },

  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: true,
    watchdog: false, // SAMD21 has a WDT peripheral, but Zephyr's samd21 dtsi exposes no watchdog node
    externalInterrupts: true,
    hardwareRng: false, // no hardware RNG on SAMD21 (the ATECC608A crypto chip is not exposed)
    fpu: false,
  },

  build: {
    extraFlags: [],
  },
};

export default SAMD21;

// ---------------------------------------------------------------------------
// Pin + peripheral re-exports
// ---------------------------------------------------------------------------

export * from './pins.js';
export * from './peripherals.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  /** All MCU port-level pin names (e.g. 'PA2', 'PB9'). */
  pinNames: [
    'PA2', 'PA4', 'PA5', 'PA6', 'PA7', 'PA8', 'PA9', 'PA10', 'PA11',
    'PA12', 'PA13', 'PA14', 'PA15', 'PA16', 'PA17', 'PA18', 'PA19',
    'PA20', 'PA21', 'PA22', 'PA23', 'PA24', 'PA25', 'PA27', 'PA28',
    'PA30', 'PA31',
    'PB2', 'PB3', 'PB8', 'PB9', 'PB10', 'PB11', 'PB22', 'PB23',
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: [] as const,
} as const;

// Generic HAL re-exports — an MCU package is a superset of @typecad/hal
// (mirrors board packages), so code importing from '@typecad/board' resolves
// identically whether a board package is configured or bare silicon.
export * from '@typecad/hal';
