// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typehal/schema';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

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
// Board definition
// ---------------------------------------------------------------------------

export const ESP32DevKit: BoardDefinition = {
  id: 'esp32-devkit',
  name: 'ESP32 DevKit',
  vendor: 'Espressif',
  description: 'ESP32 DevKit v1 (38-pin) — ESP32-WROOM-32',
  architecture: 'esp32',
  mcu: 'ESP32-WROOM-32',
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  4_194_304, // 4 MB
    sram:     532_480, // 520 KB
    eeprom:        0,
    rtcMemory: 16_384, // 16 KB
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    analogOffset: 36, // A0 is GPIO 36
    all: [
      // ---- Boot strapping pins (unsafe) ------------------------------------
      { number:  0, gpio:  0, name: 'D0', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [{ type: 'touch', instance: 0, role: 'touch1' }, { type: 'adc', instance: 1, role: 'ch1' }],
        alternateFunctions: ['Touch1', 'ADC2_CH1', 'Boot mode select'],
        warnings: ['D0 must be HIGH at boot for normal flash boot; LOW enters download mode'],
        unsafe: true, notes: 'Boot strapping pin — do not pull LOW during boot' },

      // ---- UART0 pins (unsafe — USB serial) --------------------------------
      { number:  1, gpio:  1, name: 'D1', aliases: ['TX'], capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using D1 as GPIO will interfere with Serial (UART0) transmit'],
        unsafe: true, notes: 'UART0 TX — using will interfere with USB serial' },

      // ---- Onboard LED -----------------------------------------------------
      { number:  2, gpio:  2, name: 'D2', aliases: ['LED'], capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [{ type: 'touch', instance: 0, role: 'touch2' }, { type: 'adc', instance: 1, role: 'ch2' }],
        alternateFunctions: ['Touch2', 'ADC2_CH2', 'On-board LED'],
        onboardLed: true },

      { number:  3, gpio:  3, name: 'D3', aliases: ['RX'], capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using D3 as GPIO will interfere with Serial (UART0) receive'],
        unsafe: true, notes: 'UART0 RX — using will interfere with USB serial' },

      { number:  4, gpio:  4, name: 'D4', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [{ type: 'touch', instance: 0, role: 'touch0' }, { type: 'adc', instance: 1, role: 'ch0' }],
        alternateFunctions: ['Touch0', 'ADC2_CH0'] },

      { number:  5, gpio:  5, name: 'D5', aliases: ['SS'], capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'cs' }],
        alternateFunctions: ['VSPI CS0'],
        warnings: ['D5 must be HIGH at boot'],
        unsafe: true, notes: 'Boot strapping pin — must be HIGH during boot' },

      // ---- GPIO 6-11 connected to internal flash (excluded) ----------------

      { number: 12, gpio: 12, name: 'D12', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch5' },
          { type: 'adc', instance: 1, role: 'ch5' },
          { type: 'spi', instance: 0, role: 'miso' },
        ],
        alternateFunctions: ['Touch5', 'ADC2_CH5', 'HSPI MISO'],
        warnings: ['D12 selects flash voltage at boot — must be LOW for 3.3V flash'],
        unsafe: true, notes: 'Boot strapping pin — incorrect state can brick the board' },

      { number: 13, gpio: 13, name: 'D13', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch4' },
          { type: 'adc', instance: 1, role: 'ch4' },
          { type: 'spi', instance: 0, role: 'mosi' },
        ],
        alternateFunctions: ['Touch4', 'ADC2_CH4', 'HSPI MOSI'] },

      { number: 14, gpio: 14, name: 'D14', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch6' },
          { type: 'adc', instance: 1, role: 'ch6' },
          { type: 'spi', instance: 0, role: 'sck' },
        ],
        alternateFunctions: ['Touch6', 'ADC2_CH6', 'HSPI SCK'] },

      { number: 15, gpio: 15, name: 'D15', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch3' },
          { type: 'adc', instance: 1, role: 'ch3' },
          { type: 'spi', instance: 0, role: 'cs' },
        ],
        alternateFunctions: ['Touch3', 'ADC2_CH3', 'HSPI CS0'],
        warnings: ['D15 must be HIGH at boot — silences boot message output'],
        unsafe: true, notes: 'Boot strapping pin — must be HIGH during boot' },

      { number: 16, gpio: 16, name: 'D16', aliases: ['RX2'], capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 2, role: 'rx' }],
        alternateFunctions: ['UART2 RX'] },

      { number: 17, gpio: 17, name: 'D17', aliases: ['TX2'], capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 2, role: 'tx' }],
        alternateFunctions: ['UART2 TX'] },

      { number: 18, gpio: 18, name: 'D18', aliases: ['SCK'], capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'sck' }],
        alternateFunctions: ['VSPI SCK'] },

      { number: 19, gpio: 19, name: 'D19', aliases: ['MISO'], capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'miso' }],
        alternateFunctions: ['VSPI MISO'] },

      // GPIO 20 not available on 38-pin DevKit

      { number: 21, gpio: 21, name: 'D21', aliases: ['SDA'], capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'],
        warnings: ['Using D21 as GPIO will interfere with I2C0 SDA'] },

      { number: 22, gpio: 22, name: 'D22', aliases: ['SCL'], capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'],
        warnings: ['Using D22 as GPIO will interfere with I2C0 SCL'] },

      { number: 23, gpio: 23, name: 'D23', aliases: ['MOSI'], capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'mosi' }],
        alternateFunctions: ['VSPI MOSI'] },

      // GPIO 24 not available on 38-pin DevKit

      { number: 25, gpio: 25, name: 'D25', aliases: ['DAC1'], capabilities: FULL_GPIO_DAC,
        functions: [
          { type: 'dac', instance: 0, role: 'ch1' },
          { type: 'adc', instance: 1, role: 'ch8' },
        ],
        alternateFunctions: ['DAC1', 'ADC2_CH8'] },

      { number: 26, gpio: 26, name: 'D26', aliases: ['DAC2'], capabilities: FULL_GPIO_DAC,
        functions: [
          { type: 'dac', instance: 0, role: 'ch2' },
          { type: 'adc', instance: 1, role: 'ch9' },
        ],
        alternateFunctions: ['DAC2', 'ADC2_CH9'] },

      { number: 27, gpio: 27, name: 'D27', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch7' },
          { type: 'adc', instance: 1, role: 'ch7' },
        ],
        alternateFunctions: ['Touch7', 'ADC2_CH7'] },

      // GPIO 28-31 not available on 38-pin DevKit

      { number: 32, gpio: 32, name: 'D32', aliases: ['A4'], capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch9' },
          { type: 'adc', instance: 0, role: 'ch4' },
        ],
        alternateFunctions: ['Touch9', 'ADC1_CH4'] },

      { number: 33, gpio: 33, name: 'D33', aliases: ['A5'], capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [
          { type: 'touch', instance: 0, role: 'touch8' },
          { type: 'adc', instance: 0, role: 'ch5' },
        ],
        alternateFunctions: ['Touch8', 'ADC1_CH5'] },

      // ---- Input-only pins (no output, no pull-up/pull-down) ----------------
      { number: 34, gpio: 34, name: 'D34', aliases: ['A2'], capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch6' }],
        alternateFunctions: ['ADC1_CH6'],
        notes: 'Input-only — no internal pull-up/pull-down' },

      { number: 35, gpio: 35, name: 'D35', aliases: ['A3'], capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch7' }],
        alternateFunctions: ['ADC1_CH7'],
        notes: 'Input-only — no internal pull-up/pull-down' },

      { number: 36, gpio: 36, name: 'D36', aliases: ['A0', 'VP'], capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }],
        alternateFunctions: ['ADC1_CH0', 'VP'],
        notes: 'Input-only — no internal pull-up/pull-down' },

      // GPIO 37-38 not available on 38-pin DevKit

      { number: 39, gpio: 39, name: 'D39', aliases: ['A1', 'VN'], capabilities: INPUT_ONLY,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }],
        alternateFunctions: ['ADC1_CH3', 'VN'],
        notes: 'Input-only — no internal pull-up/pull-down' },
    ],

    digital: [
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5',
      'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19',
      'D21', 'D22', 'D23', 'D25', 'D26', 'D27', 'D32', 'D33',
      'D34', 'D35', 'D36', 'D39',
    ],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    pwm: [
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5',
      'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19',
      'D21', 'D22', 'D23', 'D25', 'D26', 'D27', 'D32', 'D33',
    ],
    unsafe: ['D0', 'D1', 'D3', 'D5', 'D12', 'D15'],

    i2c:  { 0: { sda: 'D21', scl: 'D22' } },
    spi:  {
      0: { mosi: 'D13', miso: 'D12', sck: 'D14', cs: 'D15' },  // HSPI
      1: { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5' },   // VSPI
    },
    uart: {
      0: { tx: 'D1', rx: 'D3' },
      2: { tx: 'D17', rx: 'D16' },
    },

    led: 'D2',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      UART2: 'Serial2',
      I2C0:  'Wire',
      I2C1:  'Wire1',
      SPI0:  'SPI',
      SPI1:  'SPI1',
    },
    i2c: [
      { instance: 0, defaultPins: { sda: 'D21', scl: 'D22' } },
      { instance: 1, defaultPins: { sda: 'D21', scl: 'D22' }, alternatePins: { sda: ['D4', 'D13', 'D14', 'D25', 'D26', 'D27', 'D32', 'D33'], scl: ['D4', 'D13', 'D14', 'D25', 'D26', 'D27', 'D32', 'D33'] } },
    ],
    spi: [
      { instance: 0, defaultPins: { mosi: 'D13', miso: 'D12', sck: 'D14', cs: 'D15' } },  // HSPI
      { instance: 1, defaultPins: { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5' } },   // VSPI
    ],
    uart: [
      { instance: 0, defaultPins: { tx: 'D1', rx: 'D3' } },
      { instance: 2, defaultPins: { tx: 'D17', rx: 'D16' } },
    ],
    adc: [
      { instance: 0, channels: 8, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
        referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },   // ADC1 — usable with WiFi active
      { instance: 1, channels: 10, resolution: 12, referenceVoltage: 3.3, maxValue: 4095,
        referenceVoltages: { DEFAULT: 3.3, INTERNAL: 1.1 } },  // ADC2 — NOT usable with WiFi active
    ],
    dac: [
      { instance: 0, resolution: 8, pins: ['D25', 'D26'] },
    ],
    pwm: { channels: 16, resolution: 20, maxFrequency: 40_000_000 },
    touch: {
      channels: 10,
      pins: ['D4', 'D0', 'D2', 'D15', 'D13', 'D12', 'D14', 'D27', 'D33', 'D32'],
    },
    wifi: { type: 'wifi', supportsStation: true, supportsAp: true },
    bluetooth: { type: 'dual', version: '5.0' },
  },

  // ----- Features ----------------------------------------------------------
  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: true,
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      platformio: 'esp32dev',
      arduino: 'esp32:esp32:esp32',
    },
    extraFlags: [],
    defines: {
      F_CPU:            '240000000UL',
      ARDUINO:          ARDUINO_CORE_VERSION,
      ARDUINO_ESP32_DEV: '1',
    },
  },
};

export default ESP32DevKit;

// ---------------------------------------------------------------------------
// Pin Discovery API
// ---------------------------------------------------------------------------

import {
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17, D18, D19,
  D21, D22, D23, D25, D26, D27, D32, D33,
  D34, D35, D36, D39,
} from './pins';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs on ESP32). */
  pwm: [D0, D1, D2, D3, D4, D5, D12, D13, D14, D15, D16, D17, D18, D19, D21, D22, D23, D25, D26, D27, D32, D33] as const,
  /** Analog input pins (A0-A5 aliases). */
  analog: [D36, D39, D34, D35, D32, D33] as const,
  /** All GPIOs support interrupts on ESP32. */
  interrupt: [D0, D1, D2, D3, D4, D5, D12, D13, D14, D15, D16, D17, D18, D19, D21, D22, D23, D25, D26, D27, D32, D33, D34, D35, D36, D39] as const,
  /** All digital I/O pins. */
  digital: [D0, D1, D2, D3, D4, D5, D12, D13, D14, D15, D16, D17, D18, D19, D21, D22, D23, D25, D26, D27, D32, D33, D34, D35, D36, D39] as const,
} as const;

// ---------------------------------------------------------------------------
// Peripheral Pin Assignments
// ---------------------------------------------------------------------------

export const PeripheralPins = {
  /** I2C bus 0 — requires D21 (SDA) and D22 (SCL). */
  I2C0: { SDA: 'D21', SCL: 'D22' } as const,
  /** I2C bus 1 — no fixed pins (remappable). */
  I2C1: { SDA: 'remappable', SCL: 'remappable' } as const,
  /** SPI bus 0 / HSPI — D13 (MOSI), D12 (MISO), D14 (SCK). D15 is default CS. */
  SPI0: { MOSI: 'D13', MISO: 'D12', SCK: 'D14', CS: 'D15' } as const,
  /** SPI bus 1 / VSPI — D23 (MOSI), D19 (MISO), D18 (SCK). D5 is default CS. */
  SPI1: { MOSI: 'D23', MISO: 'D19', SCK: 'D18', CS: 'D5' } as const,
  /** UART 0 — D1 (TX) and D3 (RX). USB serial. */
  UART0: { TX: 'D1', RX: 'D3' } as const,
  /** UART 2 — D17 (TX) and D16 (RX). */
  UART2: { TX: 'D17', RX: 'D16' } as const,
} as const;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins (individual + aliases)
export {
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17, D18, D19,
  D21, D22, D23, D25, D26, D27, D32, D33,
  D34, D35, D36, D39,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,
} from './pins';

// Re-export constants from typehal
export { HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP } from '@typehal/typehal';

// Peripheral bus instances
export { I2C0, I2C1, SPI0, SPI1, UART0, UART2 } from './peripherals';

// Timing / utility functions
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';

// Number utilities (fluent + direct)
export { abs, min, max, clamp, inRange, toPercent, toByte, Num } from './num';

// Pulse measurement utilities
export { pulseIn, pulseInLong, Pulse } from './pulse';

// Shift register utilities
export { shiftIn, shiftOut, Shift, ShiftBitOrder } from './shift';

// Random number utilities
export { randomSeed, random, Random } from './random';

// Analog helpers
export { DEFAULT, INTERNAL } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';

// ADC singleton
export { ADC } from '@typehal/typehal';
