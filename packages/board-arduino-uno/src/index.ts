// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typehal/schema';
import { ARDUINO_CORE_VERSION } from '@typehal/schema';

// NOTE: Platform strategy is now provided by framework packages:
//   - @typehal/framework-arduino for Arduino framework (digitalWrite, etc.)
//   - @typehal/framework-avr for native AVR registers (PORTB, etc.)
// Set `framework` in typehal.config.ts to choose the code generation strategy.

// ---------------------------------------------------------------------------
// Default capability flags for AVR (fields absent on this platform)
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
// Board definition
// ---------------------------------------------------------------------------

export const ArduinoUno: BoardDefinition = {
  id: 'arduino-uno',
  name: 'Arduino Uno',
  vendor: 'Arduino',
  description: 'Arduino Uno Rev3 — ATmega328P',
  architecture: 'avr',
  mcu: 'ATmega328P',
  clockSpeed: 16_000_000, // 16 MHz

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  32_768, // 32 KB
    sram:    2_048, //  2 KB
    eeprom:  1_024, //  1 KB
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    all: [
      // Digital pins D0 – D13
      { number:  0, gpio:  0, name: 'D0',  aliases: ['RX'],   capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using D0 as GPIO will interfere with Serial (UART0) receive'],
        unsafe: true, notes: 'UART RX pin - using will interfere with serial communication' },
      { number:  1, gpio:  1, name: 'D1',  aliases: ['TX'],   capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using D1 as GPIO will interfere with Serial (UART0) transmit'],
        unsafe: true, notes: 'UART TX pin - using will interfere with serial communication' },
      { number:  2, gpio:  2, name: 'D2',                     capabilities: DIGITAL_INT },
      { number:  3, gpio:  3, name: 'D3',                     capabilities: DIGITAL_PWM_INT,
        functions: [{ type: 'pwm', instance: 0, role: 'OC2B', timer: 'timer2' }] },
      { number:  4, gpio:  4, name: 'D4',                     capabilities: DIGITAL },
      { number:  5, gpio:  5, name: 'D5',                     capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC0B', timer: 'timer0' }] },
      { number:  6, gpio:  6, name: 'D6',                     capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC0A', timer: 'timer0' }] },
      { number:  7, gpio:  7, name: 'D7',                     capabilities: DIGITAL },
      { number:  8, gpio:  8, name: 'D8',                     capabilities: DIGITAL },
      { number:  9, gpio:  9, name: 'D9',                     capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC1A', timer: 'timer1' }] },
      { number: 10, gpio: 10, name: 'D10', aliases: ['SS'],   capabilities: DIGITAL_PWM,
        functions: [
          { type: 'pwm', instance: 0, role: 'OC1B', timer: 'timer1' },
          { type: 'spi', instance: 0, role: 'cs'   },
        ],
        alternateFunctions: ['SPI0 CS'] },
      { number: 11, gpio: 11, name: 'D11', aliases: ['MOSI'], capabilities: DIGITAL_PWM,
        functions: [
          { type: 'pwm', instance: 0, role: 'OC2A', timer: 'timer2' },
          { type: 'spi', instance: 0, role: 'mosi' },
        ],
        alternateFunctions: ['SPI0 MOSI'],
        warnings: ['Using D11 as GPIO will interfere with SPI0 MOSI'] },
      { number: 12, gpio: 12, name: 'D12', aliases: ['MISO'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['SPI0 MISO'],
        warnings: ['Using D12 as GPIO will interfere with SPI0 MISO'] },
      { number: 13, gpio: 13, name: 'D13', aliases: ['SCK', 'LED'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['SPI0 SCK', 'On-board LED'],
        warnings: ['D13 is SPI0 SCK and the on-board LED — using as GPIO conflicts with SPI0'],
        onboardLed: true },

      // Analog pins A0 – A5
      { number: 14, gpio: 14, name: 'A0', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }] },
      { number: 15, gpio: 15, name: 'A1', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch1' }] },
      { number: 16, gpio: 16, name: 'A2', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' }] },
      { number: 17, gpio: 17, name: 'A3', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }] },
      { number: 18, gpio: 18, name: 'A4', aliases: ['SDA'], capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch4' },
          { type: 'i2c', instance: 0, role: 'sda' },
        ],
        alternateFunctions: ['I2C0 SDA', 'ADC ch4'],
        warnings: ['Using A4 as GPIO will interfere with I2C0 SDA'] },
      { number: 19, gpio: 19, name: 'A5', aliases: ['SCL'], capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch5' },
          { type: 'i2c', instance: 0, role: 'scl' },
        ],
        alternateFunctions: ['I2C0 SCL', 'ADC ch5'],
        warnings: ['Using A5 as GPIO will interfere with I2C0 SCL'] },
    ],

    digital: [
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
      'D8', 'D9', 'D10', 'D11', 'D12', 'D13',
      'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
    ],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    pwm:    ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'],
    unsafe: ['D0', 'D1'],

    i2c:  { 0: { sda: 'A4', scl: 'A5' } },
    spi:  { 0: { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' } },
    uart: { 0: { tx: 'D1', rx: 'D0' } },

    led: 'D13',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    i2c:  [{ instance: 0, defaultPins: { sda: 'A4', scl: 'A5' } }],
    spi:  [{ instance: 0, defaultPins: { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' } }],
    uart: [{ instance: 0, defaultPins: { tx: 'D1', rx: 'D0' } }],
    adc:  [{ instance: 0, channels: 6, resolution: 10, referenceVoltage: 5.0 }],
    pwm:  { channels: 6, resolution: 8, maxFrequency: 62_500 },
  },

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
    platformio: 'uno',
    arduino: 'arduino:avr:uno',
    extraFlags: ['-mmcu=atmega328p'],
    defines: {
      F_CPU:           '16000000UL',
      ARDUINO:         ARDUINO_CORE_VERSION,
      ARDUINO_AVR_UNO: '1',
    },
  },
};

export default ArduinoUno;

// ---------------------------------------------------------------------------
// Pin Discovery API
// ---------------------------------------------------------------------------

import {
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,
} from './pins';

/**
 * Pin collections for runtime capability discovery.
 * Use these when you need to iterate over pins by capability
 * or for dynamic pin handling.
 * 
 * @example
 * ```typescript
 * import { pins, D9 } from '@typehal/board-arduino-uno';
 * 
 * // Check if a specific pin is in a capability group
 * if (pins.pwm.includes(D9)) {
 *   D9.pwm(50);
 * }
 * 
 * // Or iterate over all PWM pins
 * for (const pwmPin of pins.pwm) {
 *   pwmPin.asOutput();
 * }
 * ```
 */
export const pins = {
  /** PWM-capable pins: D3, D5, D6, D9, D10, D11 */
  pwm: [D3, D5, D6, D9, D10, D11] as const,
  /** Analog input pins: A0, A1, A2, A3, A4, A5 */
  analog: [A0, A1, A2, A3, A4, A5] as const,
  /** External interrupt-capable pins: D0, D1, D2, D3 */
  interrupt: [D0, D1, D2, D3] as const,
  /** All digital I/O pins */
  digital: [D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, A0, A1, A2, A3, A4, A5] as const,
} as const;

// ---------------------------------------------------------------------------
// Peripheral Pin Assignments
// ---------------------------------------------------------------------------

/**
 * Peripheral-to-pin mapping for the Arduino Uno.
 * Use this to understand which pins are reserved by each peripheral
 * and avoid conflicts in your designs.
 *
 * @example
 * ```typescript
 * import { PeripheralPins } from '@typehal/board-arduino-uno';
 *
 * // Check which pins I2C uses
 * console.log(PeripheralPins.I2C0); // { SDA: 'A4', SCL: 'A5' }
 *
 * // D13 is used by SPI as SCK AND is the onboard LED.
 * // Using D13 as GPIO while SPI is active will cause conflicts.
 * ```
 */
export const PeripheralPins = {
  /** I2C bus 0 — requires A4 (SDA) and A5 (SCL). */
  I2C0: { SDA: 'A4', SCL: 'A5' } as const,
  /** SPI bus 0 — requires D11 (MOSI), D12 (MISO), D13 (SCK). D10 is default CS. */
  SPI0: { MOSI: 'D11', MISO: 'D12', SCK: 'D13', CS: 'D10' } as const,
  /** UART/Serial 0 — requires D1 (TX) and D0 (RX). */
  UART0: { TX: 'D1', RX: 'D0' } as const,
} as const;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins (individual + aliases)
export {
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

// Re-export HIGH/LOW constants from core
export { HIGH, LOW } from '@typehal/core';

// Peripheral bus instances
export { I2C0, SPI0, UART0 } from './peripherals';

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
export { AnalogReference, analogReference } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
