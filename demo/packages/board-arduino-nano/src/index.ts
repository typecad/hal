// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecode/core';

// Re-export the platform strategy so the CLI can resolve it automatically
export { BoardStrategy } from './strategy';

// ---------------------------------------------------------------------------
// Default capability flags (customize based on your board's pins)
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

/** Shorthand: digital I/O + analog input. */
const ANALOG_IN = { ...DIGITAL, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ArduinoNano: BoardDefinition = {
  id: 'arduino-nano',
  name: 'Arduino Nano',
  vendor: 'Unknown',
  description: 'Arduino Nano — ATmega328P',
  architecture: 'avr',
  mcu: 'ATmega328P',
  clockSpeed: 16000000,

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  32768,
    sram:   2048,
    eeprom: 1024,
  },

  // ----- Pins --------------------------------------------------------------
  // TODO: Fill in your board's pin definitions
  pins: {
    all: [
      // Example pin definitions (customize for your board):
      // { number: 0, gpio: 0, name: 'D0', capabilities: DIGITAL_INT,
      //   functions: [{ type: 'uart', instance: 0, role: 'rx' }] },
      // { number: 1, gpio: 1, name: 'D1', capabilities: DIGITAL_INT,
      //   functions: [{ type: 'uart', instance: 0, role: 'tx' }] },
      // { number: 13, gpio: 13, name: 'D13', aliases: ['LED'], capabilities: DIGITAL,
      //   onboardLed: true },
    ],

    digital: [
      // 'D0', 'D1', ...
    ],
    analog: [
      // 'A0', 'A1', ...
    ],
    pwm: [
      // 'D3', 'D5', ...
    ],

    i2c:  { 0: { sda: 'TODO', scl: 'TODO' } },
    spi:  { 0: { mosi: 'TODO', miso: 'TODO', sck: 'TODO', cs: 'TODO' } },
    uart: { 0: { tx: 'TODO', rx: 'TODO' } },

    led: 'TODO',  // On-board LED pin name
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    i2c:  [{ instance: 0, defaultPins: { sda: 'TODO', scl: 'TODO' } }],
    spi:  [{ instance: 0, defaultPins: { mosi: 'TODO', miso: 'TODO', sck: 'TODO', cs: 'TODO' } }],
    uart: [{ instance: 0, defaultPins: { tx: 'TODO', rx: 'TODO' } }],
    adc:  [{ instance: 0, channels: 0, resolution: 10, referenceVoltage: 3.3 }],
    pwm:  { channels: 0, resolution: 8, maxFrequency: 1000 },
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
    arduino: '',
    extraFlags: [],
    defines: {
      F_CPU: '16000000UL',
      ARDUINO: '10819',
    },
  },
};

export default ArduinoNano;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins (individual + aliases)
export {
  // D0, D1, D2, ...
  // A0, A1, A2, ...
  // LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

// Re-export HIGH/LOW constants from core
export { HIGH, LOW } from '@typecode/core';

// Peripheral bus instances
export { I2C0, SPI0, UART0 } from './peripherals';

// Timing / utility functions
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';

// Analog helpers
export { AnalogReference, analogReference } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
