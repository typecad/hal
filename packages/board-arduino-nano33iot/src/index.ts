// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Board definition manifest
//
// Arduino NANO 33 IoT — SAMD21G18A (ARM Cortex-M0+ @ 48 MHz)
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecode/core';

// ---------------------------------------------------------------------------
// Capability flag shorthands
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Digital I/O with pull-up; no PWM, no interrupt. */
const DIGITAL = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: NO,
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: NO,
} as const;

/** Digital I/O + external interrupt (no PWM). */
const DIGITAL_INT = { ...DIGITAL, interrupt: YES } as const;

/** Digital I/O + PWM + external interrupt (SAMD21 standard). */
const DIGITAL_PWM_INT = { ...DIGITAL, pwm: YES, interrupt: YES } as const;

/** Analog input (also digital I/O; no PWM). */
const ANALOG_IN = { ...DIGITAL, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ArduinoNano33IoT: BoardDefinition = {
  id: 'arduino-nano33iot',
  name: 'Arduino NANO 33 IoT',
  vendor: 'Arduino',
  description: 'Arduino NANO 33 IoT — SAMD21G18A ARM Cortex-M0+ @ 48 MHz with Wi-Fi and BLE',
  architecture: 'samd',
  mcu: 'SAMD21G18A',
  clockSpeed: 48_000_000, // 48 MHz

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  262_144, // 256 KB
    sram:    32_768, //  32 KB
    eeprom:       0, // No hardware EEPROM (software emulation via SAMD FlashStorage)
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    all: [
      // D0 / RX — UART0 receive
      { number:  0, gpio:  0, name: 'D0',  aliases: ['RX'],   capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }] },
      // D1 / TX — UART0 transmit
      { number:  1, gpio:  1, name: 'D1',  aliases: ['TX'],   capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }] },
      // D2–D12: all PWM-capable and interrupt-capable on SAMD21
      { number:  2, gpio:  2, name: 'D2',                     capabilities: DIGITAL_PWM_INT },
      { number:  3, gpio:  3, name: 'D3',                     capabilities: DIGITAL_PWM_INT },
      { number:  4, gpio:  4, name: 'D4',                     capabilities: DIGITAL_PWM_INT },
      { number:  5, gpio:  5, name: 'D5',                     capabilities: DIGITAL_PWM_INT },
      { number:  6, gpio:  6, name: 'D6',                     capabilities: DIGITAL_PWM_INT },
      { number:  7, gpio:  7, name: 'D7',                     capabilities: DIGITAL_PWM_INT },
      { number:  8, gpio:  8, name: 'D8',                     capabilities: DIGITAL_PWM_INT },
      { number:  9, gpio:  9, name: 'D9',                     capabilities: DIGITAL_PWM_INT },
      { number: 10, gpio: 10, name: 'D10', aliases: ['SS'],   capabilities: DIGITAL_PWM_INT,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }] },
      { number: 11, gpio: 11, name: 'D11', aliases: ['MOSI'], capabilities: DIGITAL_PWM_INT,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }] },
      { number: 12, gpio: 12, name: 'D12', aliases: ['MISO'], capabilities: DIGITAL_INT,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }] },
      { number: 13, gpio: 13, name: 'D13', aliases: ['SCK', 'LED'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        onboardLed: true },

      // Analog pins A0–A7 (pin numbers 14–21, 12-bit ADC)
      { number: 14, gpio: 14, name: 'A0', capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch0' },
          { type: 'dac', instance: 0, role: 'out' }, // SAMD21 single DAC on A0
        ] },
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
        ] },
      { number: 19, gpio: 19, name: 'A5', aliases: ['SCL'], capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch5' },
          { type: 'i2c', instance: 0, role: 'scl' },
        ] },
      { number: 20, gpio: 20, name: 'A6', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch6' }] },
      { number: 21, gpio: 21, name: 'A7', capabilities: ANALOG_IN,
        functions: [{ type: 'adc', instance: 0, role: 'ch7' }] },
    ],

    digital: [
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
      'D8', 'D9', 'D10', 'D11', 'D12', 'D13',
    ],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'],
    pwm:    ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'],

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
    adc:  [{ instance: 0, channels: 8, resolution: 12, referenceVoltage: 3.3 }],
    pwm:  { channels: 10, resolution: 8, maxFrequency: 187_500 },
  },

  // ----- Features ----------------------------------------------------------
  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: false,
    fpu: false,
  },

  // ----- Build config ------------------------------------------------------
  build: {
    platformio: 'nano33iot',
    arduino: 'arduino:samd:nano_33_iot',
    extraFlags: [],
    defines: {
      F_CPU:                   '48000000UL',
      ARDUINO:                 '10819',
      ARDUINO_SAMD_NANO_33_IOT: '1',
      ARDUINO_ARCH_SAMD:       '1',
    },
  },
};

export default ArduinoNano33IoT;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins (individual + aliases)
export {
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5, A6, A7,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

// Peripheral bus instances
export { I2C0, SPI0, Serial } from './peripherals';

// Timing / utility functions
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';

// Analog helpers
export { AnalogReference, analogReference, analogReadResolution, analogWriteResolution } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
