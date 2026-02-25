// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Board definition manifest
//
// Covers the DOIT ESP32 DevKit V1 (38-pin), the most common ESP32 development
// board.  Uses the Espressif ESP32 (Xtensa LX6 dual-core, 240 MHz).
// arduino-cli FQBN: esp32:esp32:esp32doit-devkit-v1
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecode/core';

// ---------------------------------------------------------------------------
// Capability shorthands
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Digital I/O only (no ADC, no PWM, no interrupt). */
const DIGITAL = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: YES,   // every ESP32 GPIO supports edge interrupts
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: YES,
} as const;

/** Digital I/O + PWM (LEDC — all output-capable GPIOs on ESP32). */
const DIGITAL_PWM = { ...DIGITAL, pwm: YES } as const;

/** Digital I/O + PWM + capacitive touch. */
const DIGITAL_PWM_TOUCH = { ...DIGITAL_PWM, touch: YES } as const;

/** Digital I/O + PWM + analog input (ADC2 — unavailable when WiFi is active). */
const ANALOG_PWM = { ...DIGITAL_PWM, analogInput: YES } as const;

/** Digital I/O + PWM + ADC2 + capacitive touch. */
const ANALOG_PWM_TOUCH = { ...DIGITAL_PWM_TOUCH, analogInput: YES } as const;

/** Digital I/O + PWM + ADC1 (WiFi-safe ADC). */
const ANALOG1_PWM = { ...DIGITAL_PWM, analogInput: YES } as const;

/** ADC1 input-only (no digital output, no PWM).  GPIO 34-39. */
const ANALOG_IN = {
  digitalInput: YES,  digitalOutput: NO,
  analogInput: YES,   analogOutput: NO,
  pwm: NO,            interrupt: YES,
  pullUp: NO,         pullDown: NO,
  touch: NO,          openDrain: NO,
} as const;

/** DAC output + ADC2 + digital I/O + PWM. */
const DAC_ANALOG_PWM = { ...ANALOG_PWM, analogOutput: YES } as const;

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const Esp32DevKit: BoardDefinition = {
  id: 'esp32-devkit-v1',
  name: 'ESP32 DevKit V1',
  vendor: 'Espressif / DOIT',
  description: 'DOIT ESP32 DevKit V1 — Dual-core Xtensa LX6, 240 MHz, WiFi + BT',
  architecture: 'esp32',
  mcu: 'ESP32',
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:   4_194_304, // 4 MB (typical DevKit V1 flash)
    sram:      532_480, // 520 KB SRAM
    eeprom:          0, // none — use NVS / SPIFFS instead
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    all: [
      // -- Output-capable GPIOs (digital, PWM, interrupt) -------------------

      // GPIO 0 — boot-strapping, ADC2_CH1, TOUCH1
      { number:  0, gpio:  0, name: 'D0', capabilities: ANALOG_PWM_TOUCH,
        notes: 'Boot-strapping pin. Pull HIGH for normal boot.',
        functions: [{ type: 'adc', instance: 2, role: 'ch1' }] },

      // GPIO 1 — UART0 TX (USB)
      { number:  1, gpio:  1, name: 'D1', aliases: ['TX', 'TX0'], capabilities: DIGITAL,
        notes: 'UART0 TX — connected to USB-UART bridge.',
        functions: [{ type: 'uart', instance: 0, role: 'tx' }] },

      // GPIO 2 — ADC2_CH2, TOUCH2, on-board LED (many DevKit variants)
      { number:  2, gpio:  2, name: 'D2', aliases: ['LED'], capabilities: ANALOG_PWM_TOUCH,
        onboardLed: true,
        functions: [{ type: 'adc', instance: 2, role: 'ch2' }] },

      // GPIO 3 — UART0 RX (USB)
      { number:  3, gpio:  3, name: 'D3', aliases: ['RX', 'RX0'], capabilities: DIGITAL,
        notes: 'UART0 RX — connected to USB-UART bridge.',
        functions: [{ type: 'uart', instance: 0, role: 'rx' }] },

      // GPIO 4 — ADC2_CH0, TOUCH0
      { number:  4, gpio:  4, name: 'D4', capabilities: ANALOG_PWM_TOUCH,
        functions: [{ type: 'adc', instance: 2, role: 'ch0' }] },

      // GPIO 5 — VSPI CS, boot-strapping
      { number:  5, gpio:  5, name: 'D5', aliases: ['SS'], capabilities: DIGITAL_PWM,
        notes: 'Boot-strapping pin. VSPI chip select.',
        functions: [{ type: 'spi', instance: 0, role: 'cs' }] },

      // GPIO 12 — HSPI MISO, ADC2_CH5, TOUCH5, boot-strapping
      { number: 12, gpio: 12, name: 'D12', capabilities: ANALOG_PWM_TOUCH,
        notes: 'Boot-strapping pin (affects flash voltage). Use with care.',
        functions: [
          { type: 'adc',  instance: 2, role: 'ch5'  },
          { type: 'spi',  instance: 1, role: 'miso' },
        ] },

      // GPIO 13 — HSPI MOSI, ADC2_CH4, TOUCH4
      { number: 13, gpio: 13, name: 'D13', capabilities: ANALOG_PWM_TOUCH,
        functions: [
          { type: 'adc',  instance: 2, role: 'ch4'  },
          { type: 'spi',  instance: 1, role: 'mosi' },
        ] },

      // GPIO 14 — HSPI SCK, ADC2_CH6, TOUCH6
      { number: 14, gpio: 14, name: 'D14', capabilities: ANALOG_PWM_TOUCH,
        functions: [
          { type: 'adc',  instance: 2, role: 'ch6'  },
          { type: 'spi',  instance: 1, role: 'sck'  },
        ] },

      // GPIO 15 — HSPI SS, ADC2_CH3, TOUCH3, boot-strapping
      { number: 15, gpio: 15, name: 'D15', capabilities: ANALOG_PWM_TOUCH,
        notes: 'Boot-strapping pin. HSPI chip select.',
        functions: [
          { type: 'adc',  instance: 2, role: 'ch3'  },
          { type: 'spi',  instance: 1, role: 'cs'   },
        ] },

      // GPIO 16 — UART2 RX (default)
      { number: 16, gpio: 16, name: 'D16', aliases: ['RX2'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'uart', instance: 2, role: 'rx' }] },

      // GPIO 17 — UART2 TX (default)
      { number: 17, gpio: 17, name: 'D17', aliases: ['TX2'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'uart', instance: 2, role: 'tx' }] },

      // GPIO 18 — VSPI SCK
      { number: 18, gpio: 18, name: 'D18', aliases: ['SCK'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }] },

      // GPIO 19 — VSPI MISO
      { number: 19, gpio: 19, name: 'D19', aliases: ['MISO'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }] },

      // GPIO 21 — I2C SDA (Wire default)
      { number: 21, gpio: 21, name: 'D21', aliases: ['SDA'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }] },

      // GPIO 22 — I2C SCL (Wire default)
      { number: 22, gpio: 22, name: 'D22', aliases: ['SCL'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }] },

      // GPIO 23 — VSPI MOSI
      { number: 23, gpio: 23, name: 'D23', aliases: ['MOSI'], capabilities: DIGITAL_PWM,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }] },

      // GPIO 25 — DAC1, ADC2_CH8
      { number: 25, gpio: 25, name: 'D25', aliases: ['DAC1'], capabilities: DAC_ANALOG_PWM,
        functions: [
          { type: 'adc', instance: 2, role: 'ch8' },
          { type: 'dac', instance: 0, role: 'out' },
        ] },

      // GPIO 26 — DAC2, ADC2_CH9
      { number: 26, gpio: 26, name: 'D26', aliases: ['DAC2'], capabilities: DAC_ANALOG_PWM,
        functions: [
          { type: 'adc', instance: 2, role: 'ch9' },
          { type: 'dac', instance: 1, role: 'out' },
        ] },

      // GPIO 27 — ADC2_CH7, TOUCH7
      { number: 27, gpio: 27, name: 'D27', capabilities: ANALOG_PWM_TOUCH,
        functions: [{ type: 'adc', instance: 2, role: 'ch7' }] },

      // GPIO 32 — ADC1_CH4, TOUCH9 (WiFi-safe ADC)
      { number: 32, gpio: 32, name: 'D32', aliases: ['A4'], capabilities: ANALOG1_PWM,
        functions: [{ type: 'adc', instance: 1, role: 'ch4' }] },

      // GPIO 33 — ADC1_CH5, TOUCH8 (WiFi-safe ADC)
      { number: 33, gpio: 33, name: 'D33', aliases: ['A5'], capabilities: ANALOG1_PWM,
        functions: [{ type: 'adc', instance: 1, role: 'ch5' }] },

      // -- Input-only GPIOs (ADC1, no output, no pull-up/down) --------------

      // GPIO 34 — ADC1_CH6, input only
      { number: 34, gpio: 34, name: 'A2', capabilities: ANALOG_IN,
        notes: 'Input-only pin. No internal pull-up/down.',
        functions: [{ type: 'adc', instance: 1, role: 'ch6' }] },

      // GPIO 35 — ADC1_CH7, input only
      { number: 35, gpio: 35, name: 'A3', capabilities: ANALOG_IN,
        notes: 'Input-only pin. No internal pull-up/down.',
        functions: [{ type: 'adc', instance: 1, role: 'ch7' }] },

      // GPIO 36 — ADC1_CH0, VP, input only
      { number: 36, gpio: 36, name: 'A0', aliases: ['VP'], capabilities: ANALOG_IN,
        notes: 'Input-only pin. No internal pull-up/down.',
        functions: [{ type: 'adc', instance: 1, role: 'ch0' }] },

      // GPIO 39 — ADC1_CH3, VN, input only
      { number: 39, gpio: 39, name: 'A1', aliases: ['VN'], capabilities: ANALOG_IN,
        notes: 'Input-only pin. No internal pull-up/down.',
        functions: [{ type: 'adc', instance: 1, role: 'ch3' }] },
    ],

    digital: [
      'D0', 'D1', 'D2', 'D3', 'D4', 'D5',
      'D12', 'D13', 'D14', 'D15', 'D16', 'D17',
      'D18', 'D19', 'D21', 'D22', 'D23',
      'D25', 'D26', 'D27', 'D32', 'D33',
    ],
    analog: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'D0', 'D2', 'D4', 'D12', 'D13', 'D14', 'D15', 'D25', 'D26', 'D27'],
    pwm: [
      'D0', 'D2', 'D4', 'D5',
      'D12', 'D13', 'D14', 'D15', 'D16', 'D17',
      'D18', 'D19', 'D21', 'D22', 'D23',
      'D25', 'D26', 'D27', 'D32', 'D33',
    ],

    i2c:  { 0: { sda: 'D21', scl: 'D22' } },
    spi:  { 0: { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5' } },
    uart: { 0: { tx: 'D1', rx: 'D3' }, 2: { tx: 'D17', rx: 'D16' } },

    led: 'D2',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    i2c: [
      { instance: 0, defaultPins: { sda: 'D21', scl: 'D22' } },
    ],
    spi: [
      { instance: 0, defaultPins: { mosi: 'D23', miso: 'D19', sck: 'D18', cs: 'D5'  } }, // VSPI
      { instance: 1, defaultPins: { mosi: 'D13', miso: 'D12', sck: 'D14', cs: 'D15' } }, // HSPI
    ],
    uart: [
      { instance: 0, defaultPins: { tx: 'D1',  rx: 'D3'  } }, // USB / Serial
      { instance: 2, defaultPins: { tx: 'D17', rx: 'D16' } }, // Serial2
    ],
    adc: [
      { instance: 1, channels: 8,  resolution: 12, referenceVoltage: 3.3 },
      { instance: 2, channels: 10, resolution: 12, referenceVoltage: 3.3 },
    ],
    pwm: {
      channels: 16,          // LEDC: 16 independent channels
      resolution: 10,        // 10-bit default (1–16 bit configurable)
      maxFrequency: 40_000_000,
    },
    dac: [
      { instance: 0, resolution: 8, pins: ['D25'] },
      { instance: 1, resolution: 8, pins: ['D26'] },
    ],
    touch: {
      channels: 10,
      pins: ['D0', 'D2', 'D4', 'D12', 'D13', 'D14', 'D15', 'D27', 'D32', 'D33'],
    },
    wifi: {
      type: 'wifi',
      supportsStation: true,
      supportsAp: true,
    },
    bluetooth: {
      type: 'dual',
      version: '4.2',
    },
  },

  // ----- Features ----------------------------------------------------------
  features: {
    multicore: true,
    coreCount: 2,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: false,            // LX6 has no hardware FPU
  },

  // ----- Build config ------------------------------------------------------
  build: {
    platformio: 'esp32dev',
    arduino: 'esp32:esp32:esp32doit-devkit-v1',
    extraFlags: ['-DBOARD_HAS_PSRAM'],
    defines: {
      ARDUINO_ESP32_DEV:  '1',
      F_CPU:              '240000000UL',
      ARDUINO:            '10819',
    },
  },
};

export default Esp32DevKit;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins
export {
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17,
  D18, D19, D21, D22, D23,
  D25, D26, D27, D32, D33,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,
} from './pins';

// Peripheral bus instances
export { I2C0, SPI0, Serial, Serial2 } from './peripherals';

// Timing / utility functions
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';

// Analog helpers
export { AnalogAttenuation, analogSetAttenuation } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
