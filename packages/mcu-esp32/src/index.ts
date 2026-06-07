// ---------------------------------------------------------------------------
// @typecad/mcu-esp32 — MCU definition manifest
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import { MCU_PERIPHERALS } from './peripherals';

// ---------------------------------------------------------------------------
// Default capability flags for ESP32
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Full GPIO: digital I/O + pull-up + pull-down + PWM + interrupt. */
const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: YES,          interrupt: YES,
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: NO,
} as const;

/** Full GPIO + analog input (ADC). */
const FULL_GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;

/** Full GPIO + touch. */
const FULL_GPIO_TOUCH = { ...FULL_GPIO, touch: YES } as const;

/** Full GPIO + analog input + touch. */
const FULL_GPIO_ANALOG_TOUCH = { ...FULL_GPIO, analogInput: YES, touch: YES } as const;

/** Full GPIO + DAC (analog output). */
const FULL_GPIO_DAC = { ...FULL_GPIO, analogInput: YES, analogOutput: YES } as const;

/** Input-only: no output, no pull-up/pull-down, ADC + interrupt only. */
const INPUT_ONLY = {
  digitalInput: YES, digitalOutput: NO,
  analogInput: YES,  analogOutput: NO,
  pwm: NO,           interrupt: YES,
  pullUp: NO,        pullDown: NO,
  touch: NO,         openDrain: NO,
} as const;

// ---------------------------------------------------------------------------
// MCU definition
// ---------------------------------------------------------------------------

export const ESP32WROOM32: MCUDefinition = {
  id: 'esp32-wroom-32',
  name: 'ESP32-WROOM-32',
  architecture: 'esp32',
  memory: {
    flash:  4_194_304, // 4 MB
    sram:     532_480, // 520 KB
    eeprom:        0,
    rtcMemory: 16_384, // 16 KB
  },
  pins: {
    all: [
      // ---- Boot strapping pins (unsafe) ------------------------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [{ type: 'touch', instance: 0, role: 'touch1' }, { type: 'adc', instance: 1, role: 'ch1' }],
        alternateFunctions: ['Touch1', 'ADC2_CH1', 'Boot mode select'],
        warnings: ['GPIO0 must be HIGH at boot for normal flash boot; LOW enters download mode'],
        unsafe: true, notes: 'Boot strapping pin — do not pull LOW during boot' },

      // ---- UART0 pins (unsafe — USB serial) --------------------------------
      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO1 as GPIO will interfere with UART0 transmit'],
        unsafe: true, notes: 'UART0 TX — using will interfere with programming serial' },

      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [{ type: 'touch', instance: 0, role: 'touch2' }, { type: 'adc', instance: 1, role: 'ch2' }],
        alternateFunctions: ['Touch2', 'ADC2_CH2'] },

      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO3 as GPIO will interfere with UART0 receive'],
        unsafe: true, notes: 'UART0 RX — using will interfere with programming serial' },

      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [{ type: 'touch', instance: 0, role: 'touch0' }, { type: 'adc', instance: 1, role: 'ch0' }],
        alternateFunctions: ['Touch0', 'ADC2_CH0'] },

      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'cs' }],
        alternateFunctions: ['VSPI CS0'],
        warnings: ['GPIO5 must be HIGH at boot'],
        unsafe: true, notes: 'Boot strapping pin — must be HIGH during boot' },

      // ---- GPIO 6-11 connected to internal flash (excluded) ----------------

      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch5' },
          { type: 'adc', instance: 1, role: 'ch5' },
          { type: 'spi', instance: 0, role: 'miso' },
        ],
        alternateFunctions: ['Touch5', 'ADC2_CH5', 'HSPI MISO'],
        warnings: ['GPIO12 selects flash voltage at boot — must be LOW for 3.3V flash'],
        unsafe: true, notes: 'Boot strapping pin — incorrect state can brick the board' },

      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch4' },
          { type: 'adc', instance: 1, role: 'ch4' },
          { type: 'spi', instance: 0, role: 'mosi' },
        ],
        alternateFunctions: ['Touch4', 'ADC2_CH4', 'HSPI MOSI'] },

      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch6' },
          { type: 'adc', instance: 1, role: 'ch6' },
          { type: 'spi', instance: 0, role: 'sck' },
        ],
        alternateFunctions: ['Touch6', 'ADC2_CH6', 'HSPI SCK'] },

      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch3' },
          { type: 'adc', instance: 1, role: 'ch3' },
          { type: 'spi', instance: 0, role: 'cs' },
        ],
        alternateFunctions: ['Touch3', 'ADC2_CH3', 'HSPI CS0'],
        warnings: ['GPIO15 must be HIGH at boot — silences boot message output'],
        unsafe: true, notes: 'Boot strapping pin — must be HIGH during boot' },

      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 2, role: 'rx' }],
        alternateFunctions: ['UART2 RX'] },

      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 2, role: 'tx' }],
        alternateFunctions: ['UART2 TX'] },

      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'sck' }],
        alternateFunctions: ['VSPI SCK'] },

      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'miso' }],
        alternateFunctions: ['VSPI MISO'] },

      // GPIO 20 not available on 38-pin DevKit

      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'],
        warnings: ['Using GPIO21 as GPIO will interfere with I2C0 SDA'] },

      { number: 22, gpio: 22, name: 'GPIO22', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'],
        warnings: ['Using GPIO22 as GPIO will interfere with I2C0 SCL'] },

      { number: 23, gpio: 23, name: 'GPIO23', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'mosi' }],
        alternateFunctions: ['VSPI MOSI'] },

      // GPIO 24 not available on 38-pin DevKit

      { number: 25, gpio: 25, name: 'GPIO25', capabilities: FULL_GPIO_DAC,
        functions: [
          { type: 'dac', instance: 0, role: 'ch1' },
          { type: 'adc', instance: 1, role: 'ch8' },
        ],
        alternateFunctions: ['DAC1', 'ADC2_CH8'] },

      { number: 26, gpio: 26, name: 'GPIO26', capabilities: FULL_GPIO_DAC,
        functions: [
          { type: 'dac', instance: 0, role: 'ch2' },
          { type: 'adc', instance: 1, role: 'ch9' },
        ],
        alternateFunctions: ['DAC2', 'ADC2_CH9'] },

      { number: 27, gpio: 27, name: 'GPIO27', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch7' },
          { type: 'adc', instance: 1, role: 'ch7' },
        ],
        alternateFunctions: ['Touch7', 'ADC2_CH7'] },

      // GPIO 28-31 not available on 38-pin DevKit

      { number: 32, gpio: 32, name: 'GPIO32', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch9' },
          { type: 'adc', instance: 0, role: 'ch4' },
        ],
        alternateFunctions: ['Touch9', 'ADC1_CH4'] },

      { number: 33, gpio: 33, name: 'GPIO33', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch8' },
          { type: 'adc', instance: 0, role: 'ch5' },
        ],
        alternateFunctions: ['Touch8', 'ADC1_CH5'] },

      // ---- Input-only pins (no output, no pull-up/pull-down) ----------------
      { number: 34, gpio: 34, name: 'GPIO34', capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch6' }],
        alternateFunctions: ['ADC1_CH6'],
        notes: 'Input-only — no internal pull-up/pull-down' },

      { number: 35, gpio: 35, name: 'GPIO35', capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch7' }],
        alternateFunctions: ['ADC1_CH7'],
        notes: 'Input-only — no internal pull-up/pull-down' },

      { number: 36, gpio: 36, name: 'GPIO36', capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }],
        alternateFunctions: ['ADC1_CH0', 'VP'],
        notes: 'Input-only — no internal pull-up/pull-down' },

      // GPIO 37-38 not available on 38-pin DevKit

      { number: 39, gpio: 39, name: 'GPIO39', capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }],
        alternateFunctions: ['ADC1_CH3', 'VN'],
        notes: 'Input-only — no internal pull-up/pull-down' },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5',
      'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
      'GPIO21', 'GPIO22', 'GPIO23', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33',
      'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39',
    ],
    analog: ['GPIO36', 'GPIO39', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33'],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5',
      'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
      'GPIO21', 'GPIO22', 'GPIO23', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33',
    ],
    unsafe: ['GPIO0', 'GPIO1', 'GPIO3', 'GPIO5', 'GPIO12', 'GPIO15'],

    i2c:  { 0: { sda: 'GPIO21', scl: 'GPIO22' } },
    spi:  {
      0: { mosi: 'GPIO13', miso: 'GPIO12', sck: 'GPIO14', cs: 'GPIO15' },  // HSPI
      1: { mosi: 'GPIO23', miso: 'GPIO19', sck: 'GPIO18', cs: 'GPIO5' },   // VSPI
    },
    uart: {
      0: { tx: 'GPIO1', rx: 'GPIO3' },
      2: { tx: 'GPIO17', rx: 'GPIO16' },
    },
  },
  // ----- Peripherals -------------------------------------------------------
  peripherals: MCU_PERIPHERALS,
  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: true,
  },
  build: {
    extraFlags: [],
  },
};

export default ESP32WROOM32;

// Re-exports
export * from './pins';
export * from './peripherals';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  /** All MCU port-level pin names (e.g. 'GPIO0', 'GPIO1'). */
  pinNames: [
    'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5',
    'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
    'GPIO21', 'GPIO22', 'GPIO23', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33',
    'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39'
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: ['I2C0', 'I2C1', 'SPI0', 'SPI1', 'UART0', 'UART2'] as const,
} as const;