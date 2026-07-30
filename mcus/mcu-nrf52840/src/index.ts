// ---------------------------------------------------------------------------
// @typecad/mcu-nrf52840 — MCU definition manifest
//
// Nordic nRF52840: ARM Cortex-M4F, 1 MB flash, 256 KB RAM, BLE/802.15.4 radio.
// Silicon-level facts only — board overlays live in the board-* packages.
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
// Default capability flags for nRF52840
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Full GPIO: digital I/O + pull-up + pull-down + interrupt. No PWM/touch/DAC. */
const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: YES,
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: NO,
} as const;

/** Full GPIO + analog input (SAADC). */
const GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// MCU definition
// ---------------------------------------------------------------------------

export const NRF52840: MCUDefinition = {
  id: 'nrf52840',
  name: 'nRF52840',
  architecture: 'nrf52',
  memory: {
    flash: 1_048_576, // 1 MB
    sram:   262_144,  // 256 KB
    eeprom:      0,
  },
  pins: {
    all: [
      // ---- User button + LED (also exposed) --------------------------------
      { number:  4, gpio:  4, name: 'P0.04', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['User Button'],
        onboardButton: true },
      { number: 26, gpio: 26, name: 'P0.26', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['User LED (active-low)'],
        onboardLed: true,
        notes: 'Active-low: logic 0 = LED on. Zephyr DT honors GPIO_ACTIVE_LOW.' },

      // ---- XIAO edge pins D0–D10 -------------------------------------------
      { number:  2, gpio:  2, name: 'P0.02', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }],
        alternateFunctions: ['D0', 'AIN0'] },
      { number:  3, gpio:  3, name: 'P0.03', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch1' }],
        alternateFunctions: ['D1', 'AIN1'] },
      { number: 28, gpio: 28, name: 'P0.28', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' }],
        alternateFunctions: ['D2', 'AIN2'] },
      { number: 29, gpio: 29, name: 'P0.29', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }],
        alternateFunctions: ['D3', 'AIN3'] },
      { number:  5, gpio:  5, name: 'P0.05', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['D5'] },
      { number: 43, gpio: 43, name: 'P1.11', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['D6'] },
      { number: 44, gpio: 44, name: 'P1.12', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['D7'] },
      { number:  8, gpio:  8, name: 'P0.08', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['D8'] },
      { number:  9, gpio:  9, name: 'P0.09', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['D9', 'NFC1'],
        warnings: ['P0.09 is shared with the NFC antenna; configure NFC as disabled to use as GPIO'] },
      { number: 10, gpio: 10, name: 'P0.10', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['D10', 'NFC2'],
        warnings: ['P0.10 is shared with the NFC antenna; configure NFC as disabled to use as GPIO'] },

      // ---- Default I2C / SPI / UART pins -----------------------------------
      { number: 24, gpio: 24, name: 'P0.24', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'] },
      { number: 25, gpio: 25, name: 'P0.25', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'] },
      { number: 13, gpio: 13, name: 'P0.13', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['SPI0 MOSI'] },
      { number: 14, gpio: 14, name: 'P0.14', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['SPI0 MISO'] },
      { number: 15, gpio: 15, name: 'P0.15', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['SPI0 SCK'] },
      { number:  6, gpio:  6, name: 'P0.06', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'] },
      { number: 34, gpio: 34, name: 'P1.02', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'] },
    ],

    digital: [
      'P0.04', 'P0.26', 'P0.02', 'P0.03', 'P0.28', 'P0.29', 'P0.05',
      'P1.11', 'P1.12', 'P0.08', 'P0.09', 'P0.10',
      'P0.24', 'P0.25', 'P0.13', 'P0.14', 'P0.15', 'P0.06', 'P1.02',
    ],
    analog: ['P0.02', 'P0.03', 'P0.28', 'P0.29'],
    pwm: [],
    unsafe: ['P0.09', 'P0.10'], // NFC-shared
    led: 'P0.26',
    button: 'P0.04',

    i2c: { 0: { sda: 'P0.24', scl: 'P0.25' } },
    spi: { 0: { mosi: 'P0.13', miso: 'P0.14', sck: 'P0.15' } },
    uart: { 0: { tx: 'P0.06', rx: 'P1.02' } },
  },

  peripherals: {
    i2c: I2C_INSTANCES,
    spi: SPI_INSTANCES,
    uart: UART_INSTANCES,
    adc: ADC_INSTANCES,
    timers: TIMER_INSTANCES,
    // nRF52840 PWM is via the TIMER + GPIOTE/PWM peripheral. Not lowered by
    // the MVP; the field is required by the schema, so record a minimal entry.
    pwm: { channels: 0, resolution: 16, maxFrequency: 2_000_000 },
    aliases: {},
  },

  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true, // nRF52840 has a hardware RNG
    fpu: true,
  },

  build: {
    extraFlags: [],
  },
};

export default NRF52840;

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
  /** All MCU port-level pin names (e.g. 'P0.02', 'P1.11'). */
  pinNames: [
    'P0.02', 'P0.03', 'P0.04', 'P0.05', 'P0.06', 'P0.08', 'P0.09', 'P0.10',
    'P0.13', 'P0.14', 'P0.15', 'P0.24', 'P0.25', 'P0.26', 'P0.28', 'P0.29',
    'P1.02', 'P1.11', 'P1.12',
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: [] as const,
} as const;
