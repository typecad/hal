// ---------------------------------------------------------------------------
// @typehal/mcu-atmega328p — MCU hardware definition
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typehal/schema';
import { MCU_PERIPHERALS } from './peripherals';

// ---------------------------------------------------------------------------
// Pin capability shorthands
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Shorthand: digital I/O only, with internal pull-up. */
const DIGITAL = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: NO,
  pullUp: YES,       pullDown: NO,
  touch: NO,         openDrain: NO,
} as const;

/** Shorthand: digital I/O + external-interrupt capable. */
const DIGITAL_INT = { ...DIGITAL, interrupt: YES } as const;

/** Shorthand: digital I/O + PWM. */
const DIGITAL_PWM = { ...DIGITAL, pwm: YES } as const;

/** Shorthand: digital I/O + PWM + interrupt. */
const DIGITAL_PWM_INT = { ...DIGITAL, pwm: YES, interrupt: YES } as const;

/** Shorthand: digital I/O + analog input. */
const ANALOG_IN = { ...DIGITAL, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// ATmega328P MCU Definition
// ---------------------------------------------------------------------------

export const ATmega328P: MCUDefinition = {
  id: 'atmega328p',
  name: 'ATmega328P',
  architecture: 'avr',

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  32_768, // 32 KB
    sram:    2_048, //  2 KB
    eeprom:  1_024, //  1 KB
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    all: [
      // Port D pins (PD0–PD7)
      { number:  0, gpio:  0, name: 'PD0', aliases: ['RX'], capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using PD0 as GPIO will interfere with UART0 receive'],
        unsafe: true, notes: 'UART RX pin' },
      { number:  1, gpio:  1, name: 'PD1', aliases: ['TX'], capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using PD1 as GPIO will interfere with UART0 transmit'],
        unsafe: true, notes: 'UART TX pin' },
      { number:  2, gpio:  2, name: 'PD2', capabilities: DIGITAL_INT },
      { number:  3, gpio:  3, name: 'PD3', capabilities: DIGITAL_PWM_INT,
        functions: [{ type: 'pwm', instance: 0, role: 'OC2B', timer: 'timer2' }] },
      { number:  4, gpio:  4, name: 'PD4', capabilities: DIGITAL },
      { number:  5, gpio:  5, name: 'PD5', capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC0B', timer: 'timer0' }] },
      { number:  6, gpio:  6, name: 'PD6', capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC0A', timer: 'timer0' }] },
      { number:  7, gpio:  7, name: 'PD7', capabilities: DIGITAL },

      // Port B pins (PB0–PB5)
      { number:  8, gpio:  8, name: 'PB0', capabilities: DIGITAL },
      { number:  9, gpio:  9, name: 'PB1', capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC1A', timer: 'timer1' }] },
      { number: 10, gpio: 10, name: 'PB2', aliases: ['SS'], capabilities: DIGITAL_PWM,
        functions: [
          { type: 'pwm', instance: 0, role: 'OC1B', timer: 'timer1' },
          { type: 'spi', instance: 0, role: 'cs'   },
        ],
        alternateFunctions: ['SPI0 CS'] },
      { number: 11, gpio: 11, name: 'PB3', aliases: ['MOSI'], capabilities: DIGITAL_PWM,
        functions: [
          { type: 'pwm', instance: 0, role: 'OC2A', timer: 'timer2' },
          { type: 'spi', instance: 0, role: 'mosi' },
        ],
        alternateFunctions: ['SPI0 MOSI'],
        warnings: ['Using PB3 as GPIO will interfere with SPI0 MOSI'] },
      { number: 12, gpio: 12, name: 'PB4', aliases: ['MISO'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['SPI0 MISO'],
        warnings: ['Using PB4 as GPIO will interfere with SPI0 MISO'] },
      { number: 13, gpio: 13, name: 'PB5', aliases: ['SCK'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['SPI0 SCK'],
        warnings: ['PB5 is SPI0 SCK'] },

      // Port C pins (PC0–PC5)
      { number: 14, gpio: 14, name: 'PC0', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }] },
      { number: 15, gpio: 15, name: 'PC1', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch1' }] },
      { number: 16, gpio: 16, name: 'PC2', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' }] },
      { number: 17, gpio: 17, name: 'PC3', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }] },
      { number: 18, gpio: 18, name: 'PC4', aliases: ['SDA'], capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch4' },
          { type: 'i2c', instance: 0, role: 'sda' },
        ],
        alternateFunctions: ['I2C0 SDA', 'ADC ch4'],
        warnings: ['Using PC4 as GPIO will interfere with I2C0 SDA'] },
      { number: 19, gpio: 19, name: 'PC5', aliases: ['SCL'], capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch5' },
          { type: 'i2c', instance: 0, role: 'scl' },
        ],
        alternateFunctions: ['I2C0 SCL', 'ADC ch5'],
        warnings: ['Using PC5 as GPIO will interfere with I2C0 SCL'] },
    ],

    digital: [
      'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7',
      'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5',
      'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5',
    ],
    analog: ['PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5'],
    pwm:    ['PD3', 'PD5', 'PD6', 'PB1', 'PB2', 'PB3'],
    unsafe: ['PD0', 'PD1'],

    i2c:  { 0: { sda: 'PC4', scl: 'PC5' } },
    spi:  { 0: { mosi: 'PB3', miso: 'PB4', sck: 'PB5', cs: 'PB2' } },
    uart: { 
      0: { tx: 'PD1', rx: 'PD0' },
      1: { tx: 'PD2', rx: 'PD3' },
    },
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: MCU_PERIPHERALS,

  // ----- Features ----------------------------------------------------------
  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: false,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: false,
    fpu: false,
  },

  // ----- Build config ------------------------------------------------------
  build: {
    extraFlags: ['-mmcu=atmega328p'],
  },
};

export default ATmega328P;
