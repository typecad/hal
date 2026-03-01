// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Board definition manifest
//
// Native ATmega328P board package that uses direct AVR register access
// instead of the Arduino framework. Provides Arduino-equivalent functions:
// - digitalRead(pin)
// - digitalWrite(pin, value)
// - analogRead(pin)
// - analogWrite(pin, value)  [PWM only]
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecode/core';

// Re-export the platform strategy so the CLI can resolve it automatically
export { BoardStrategy } from './strategy';

// Re-export Serial peripheral for native UART communication
export { Serial } from './peripherals';

// Register the native strategy with the CLI platform registry
// This allows the transpiler to use our native code generation
import { registerPlatformStrategy } from 'typecode/platform/registry';
import { NativeStrategy } from './strategy';

// Auto-register the native strategy when this package is imported
registerPlatformStrategy(new NativeStrategy());

// ---------------------------------------------------------------------------
// Default capability flags for ATmega328P
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

export const NativeATmega328P: BoardDefinition = {
  id: 'native-atmega328p',
  name: 'Native ATmega328P',
  vendor: 'Atmel/Microchip',
  description: 'ATmega328P with native AVR register access (no Arduino framework)',
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
        functions: [{ type: 'uart', instance: 0, role: 'rx' }] },
      { number:  1, gpio:  1, name: 'D1',  aliases: ['TX'],   capabilities: DIGITAL_INT,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }] },
      { number:  2, gpio:  2, name: 'D2',                     capabilities: DIGITAL_INT },
      { number:  3, gpio:  3, name: 'D3',                     capabilities: DIGITAL_PWM_INT,
        functions: [{ type: 'pwm', instance: 0, role: 'OC2B' }] },
      { number:  4, gpio:  4, name: 'D4',                     capabilities: DIGITAL },
      { number:  5, gpio:  5, name: 'D5',                     capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC0B' }] },
      { number:  6, gpio:  6, name: 'D6',                     capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC0A' }] },
      { number:  7, gpio:  7, name: 'D7',                     capabilities: DIGITAL },
      { number:  8, gpio:  8, name: 'D8',                     capabilities: DIGITAL },
      { number:  9, gpio:  9, name: 'D9',                     capabilities: DIGITAL_PWM,
        functions: [{ type: 'pwm', instance: 0, role: 'OC1A' }] },
      { number: 10, gpio: 10, name: 'D10', aliases: ['SS'],   capabilities: DIGITAL_PWM,
        functions: [
          { type: 'pwm', instance: 0, role: 'OC1B' },
          { type: 'spi', instance: 0, role: 'cs'   },
        ] },
      { number: 11, gpio: 11, name: 'D11', aliases: ['MOSI'], capabilities: DIGITAL_PWM,
        functions: [
          { type: 'pwm', instance: 0, role: 'OC2A' },
          { type: 'spi', instance: 0, role: 'mosi' },
        ] },
      { number: 12, gpio: 12, name: 'D12', aliases: ['MISO'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }] },
      { number: 13, gpio: 13, name: 'D13', aliases: ['SCK', 'LED'], capabilities: DIGITAL,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
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
        ] },
      { number: 19, gpio: 19, name: 'A5', aliases: ['SCL'], capabilities: ANALOG_IN,
        functions: [
          { type: 'adc', instance: 0, role: 'ch5' },
          { type: 'i2c', instance: 0, role: 'scl' },
        ] },
    ],

    digital: [
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
      'D8', 'D9', 'D10', 'D11', 'D12', 'D13',
    ],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    pwm:    ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'],

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
    // Native build uses avr-gcc directly, not Arduino
    platformio: 'uno',  // Still compatible with PlatformIO for flashing
    arduino: 'arduino:avr:uno',  // Fallback for Arduino-compatible builds
    extraFlags: ['-mmcu=atmega328p', '-nostdlib', '-nodefaultlibs'],
    defines: {
      F_CPU: '16000000UL',
      __AVR_ATmega328P__: '1',
    },
  },
};

export default NativeATmega328P;

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

// Native digital I/O functions
export {
  pinMode,
  digitalRead,
  digitalWrite,
  setHigh,
  setLow,
  togglePin,
  INPUT,
  OUTPUT,
  INPUT_PULLUP,
  HIGH,
  LOW,
} from './digital';

// Native analog I/O functions
export {
  analogRead,
  analogWrite,
  analogReference,
  setADCPrescaler,
  isPWMCapable,
  disablePWM,
  AnalogReference,
  ADCPrescaler,
} from './analog';

// Native register mappings (for advanced use)
export {
  PIN_PORT,
  PIN_DDR,
  PIN_IN,
  PIN_BIT,
  PWM_OCR,
  ADC_CHANNEL,
  isPWMPin,
  isAnalogPin,
  isValidDigitalPin,
} from './native';

// Timing utilities
export {
  delay,
  millis,
  micros,
  delayMicroseconds,
  map,
  constrain,
} from './timing';

// Interrupt utilities
export {
  noInterrupts,
  interrupts,
  attachInterrupt,
  detachInterrupt,
} from './interrupts';
