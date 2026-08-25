// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — MCU definition manifest
//
// ESP32-C6 is a single-core RISC-V (RV32IMAC) @ 160 MHz with Wi-Fi 6
// (802.11ax) + BLE 5.3 and native USB Serial/JTAG + USB-OTG. It has 30 GPIO
// (0-7, 8-14, 15-30). All GPIOs are bidirectional. No DAC. No PSRAM.
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import { MCU_PERIPHERALS } from './peripherals.js';

const NO  = false as const;
const YES = true  as const;

const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: YES,          interrupt: YES,
  pullUp: YES,       pullDown: YES,
  touch: NO,         openDrain: NO,
} as const;

const FULL_GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;
// No FULL_GPIO_ANALOG_TOUCH — the C6 has no exposed touch peripheral.

function adc(n: number, ch: number) {
  return { type: 'adc' as const, instance: n, role: `ch${ch}` };
}

export const ESP32C6: MCUDefinition = {
  id: 'esp32-c6',
  name: 'ESP32-C6',
  architecture: 'esp32c6',
  memory: {
    flash:    384 * 1024,
    sram:     512 * 1024,
    eeprom:   0,
    rtcMemory: 16 * 1024,
  },
  pins: {
    all: [
      // ---- ADC1 pins (GPIO0-GPIO6) — no touch on the C6 --------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 0)], alternateFunctions: ['ADC1_CH0'] },
      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 1)], alternateFunctions: ['ADC1_CH1'] },
      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 2)], alternateFunctions: ['ADC1_CH2'] },
      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 3)], alternateFunctions: ['ADC1_CH3'] },
      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 4)], alternateFunctions: ['ADC1_CH4'] },
      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 5)], alternateFunctions: ['ADC1_CH5'] },
      { number:  6, gpio:  6, name: 'GPIO6', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 6)], alternateFunctions: ['ADC1_CH6'] },

      // ---- ADC2 pin (GPIO7) — Wi-Fi conflicted ------------------------------
      { number:  7, gpio:  7, name: 'GPIO7', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 0)],
        alternateFunctions: ['ADC2_CH0'],
        warnings: ['GPIO7 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number:  8, gpio:  8, name: 'GPIO8', capabilities: FULL_GPIO,
        alternateFunctions: [] },

      // ---- Strapping pins (unsafe) -----------------------------------------
      { number:  9, gpio:  9, name: 'GPIO9', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO9 is a strapping pin — boot mode select at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 10, gpio: 10, name: 'GPIO10', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 11, gpio: 11, name: 'GPIO11', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO, alternateFunctions: [] },

      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO13 is a strapping pin — controls VDD_SPI voltage at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO, alternateFunctions: [] },

      // ---- GPIO 15-25 — general purpose (incl. bus defaults) ---------------
      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO16 as GPIO will interfere with UART0 transmit'] },
      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO17 as GPIO will interfere with UART0 receive'] },
      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }],
        alternateFunctions: ['SPI0 CS'] },
      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['SPI0 MOSI'] },
      { number: 20, gpio: 20, name: 'GPIO20', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['SPI0 MISO'] },
      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['SPI0 SCK'] },
      { number: 22, gpio: 22, name: 'GPIO22', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'] },
      { number: 23, gpio: 23, name: 'GPIO23', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'] },
      { number: 24, gpio: 24, name: 'GPIO24', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 25, gpio: 25, name: 'GPIO25', capabilities: FULL_GPIO, alternateFunctions: [] },

      // ---- USB Serial/JTAG + USB-OTG pins (unsafe) -------------------------
      { number: 26, gpio: 26, name: 'GPIO26', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dm' }],
        alternateFunctions: ['USB D-'],
        warnings: ['GPIO26 is USB D- — using it as GPIO disables native USB'],
        unsafe: true, notes: 'USB D- pin' },
      { number: 27, gpio: 27, name: 'GPIO27', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dp' }],
        alternateFunctions: ['USB D+'],
        warnings: ['GPIO27 is USB D+ — using it as GPIO disables native USB'],
        unsafe: true, notes: 'USB D+ pin' },

      // ---- SPI flash / PSRAM pins (unsafe) ---------------------------------
      { number: 28, gpio: 28, name: 'GPIO28', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICS0'],
        warnings: ['GPIO28 is connected to SPI flash — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 29, gpio: 29, name: 'GPIO29', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICLK'],
        warnings: ['GPIO29 is connected to SPI flash — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 30, gpio: 30, name: 'GPIO30', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIQ'],
        warnings: ['GPIO30 is connected to SPI flash — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO28',
      'GPIO29', 'GPIO30',
    ],
    analog: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6',  // ADC1
      'GPIO7',                                                         // ADC2
    ],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25',
    ],
    unsafe: ['GPIO9', 'GPIO13', 'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30'],

    i2c:  { 0: { sda: 'GPIO23', scl: 'GPIO22' } },
    spi:  { 0: { mosi: 'GPIO19', miso: 'GPIO20', sck: 'GPIO21', cs: 'GPIO18' } },
    uart: { 0: { tx: 'GPIO16', rx: 'GPIO17' } },
  },

  peripherals: MCU_PERIPHERALS,

  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: true,
    fpu: false,
  },
  build: { extraFlags: [] },
};

export default ESP32C6;

export * from './pins.js';
export * from './peripherals.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  pinNames: [
    'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
    'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
    'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO28',
    'GPIO29', 'GPIO30',
  ] as const,
  peripheralNames: ['I2C0', 'SPI0', 'UART0', 'UART1'] as const,
} as const;

// Generic HAL re-exports — an MCU package is a superset of @typecad/hal
// (mirrors board packages), so code importing from '@typecad/board' resolves
// identically whether a board package is configured or bare silicon.
export * from '@typecad/hal';
