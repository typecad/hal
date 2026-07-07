// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — MCU definition manifest
//
// ESP32-C3 is a single-core RISC-V (RV32IMC) @ 160 MHz with Wi-Fi 4 + BLE 5
// (long range) and native USB Serial/JTAG. It has 22 GPIO (0-10, 12-21);
// GPIO 11 is consumed by internal flash Vpp and is not broken out. All GPIOs
// are bidirectional. No DAC. No PSRAM support.
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import { MCU_PERIPHERALS } from './peripherals.js';

// ---------------------------------------------------------------------------
// Default capability flags for ESP32-C3
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

/** Full GPIO + analog input + touch. */
const FULL_GPIO_ANALOG_TOUCH = { ...FULL_GPIO, analogInput: YES, touch: YES } as const;

// ---------------------------------------------------------------------------
// Helper: build ADC/touch peripheral-function references.
//
// ADC1 channels: GPIO0..GPIO4 -> ch0..ch4 (always usable).
// ADC2 channels: GPIO5 -> ch0 (NOT usable while Wi-Fi is on).
// Touch channels: GPIO0..GPIO5 -> T0..T5.
// ---------------------------------------------------------------------------

function adc(n: number, ch: number) {
  return { type: 'adc' as const, instance: n, role: `ch${ch}` };
}
function touch(ch: number) {
  return { type: 'touch' as const, instance: 0, role: `touch${ch}` };
}

// ---------------------------------------------------------------------------
// MCU definition
// ---------------------------------------------------------------------------

export const ESP32C3: MCUDefinition = {
  id: 'esp32-c3',
  name: 'ESP32-C3',
  architecture: 'esp32c3',
  memory: {
    flash:    384 * 1024, // usable app flash; remainder reserved by bootloader/OTADATA
    sram:     400 * 1024, // 400 KB
    eeprom:   0,
    rtcMemory: 16 * 1024, // 16 KB RTC slow memory
  },
  pins: {
    all: [
      // ---- ADC1 + touch pins (GPIO0-GPIO4) ---------------------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 0), touch(0)],
        alternateFunctions: ['ADC1_CH0', 'Touch0'] },

      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 1), touch(1)],
        alternateFunctions: ['ADC1_CH1', 'Touch1'] },

      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 2), touch(2)],
        alternateFunctions: ['ADC1_CH2', 'Touch2'],
        warnings: ['GPIO2 is a strapping pin — boot mode select at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 3), touch(3)],
        alternateFunctions: ['ADC1_CH3', 'Touch3'] },

      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 4), touch(4), { type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['ADC1_CH4', 'Touch4', 'SPI0 SCK'] },

      // ---- ADC2 pin (GPIO5) — Wi-Fi conflicted ------------------------------
      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 0), touch(5), { type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['ADC2_CH0', 'Touch5', 'SPI0 MISO'],
        warnings: ['GPIO5 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number:  6, gpio:  6, name: 'GPIO6', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['SPI0 MOSI'] },

      { number:  7, gpio:  7, name: 'GPIO7', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }],
        alternateFunctions: ['SPI0 CS'] },

      { number:  8, gpio:  8, name: 'GPIO8', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C0 SDA'],
        warnings: ['GPIO8 is a strapping pin — controls VDD_SPI voltage at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  9, gpio:  9, name: 'GPIO9', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C0 SCL'],
        warnings: ['GPIO9 is a strapping pin — must be HIGH at boot (reset source)'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 10, gpio: 10, name: 'GPIO10', capabilities: FULL_GPIO,
        alternateFunctions: ['FSPICS0'] },

      // ---- GPIO 11 — internal flash Vpp, not broken out on the C3 ----------

      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'sck' }],
        alternateFunctions: ['FSPICLK'] },
      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'mosi' }],
        alternateFunctions: ['FSPID'] },
      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'miso' }],
        alternateFunctions: ['FSPIQ'] },
      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'cs' }],
        alternateFunctions: ['FSPICS1'] },
      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO,
        alternateFunctions: [] },
      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO,
        alternateFunctions: [] },

      // ---- USB Serial/JTAG pins (unsafe) -----------------------------------
      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dm' }],
        alternateFunctions: ['USB D-'],
        warnings: ['GPIO18 is USB D- — using it as GPIO disables native USB Serial/JTAG'],
        unsafe: true, notes: 'USB D- pin' },
      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO,
        functions: [{ type: 'usb', instance: 0, role: 'dp' }],
        alternateFunctions: ['USB D+'],
        warnings: ['GPIO19 is USB D+ — using it as GPIO disables native USB Serial/JTAG'],
        unsafe: true, notes: 'USB D+ pin' },

      // ---- UART0 default pins ----------------------------------------------
      { number: 20, gpio: 20, name: 'GPIO20', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO20 as GPIO will interfere with UART0 receive'] },
      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO21 as GPIO will interfere with UART0 transmit'] },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10',
      'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
      'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    ],
    analog: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4',  // ADC1
      'GPIO5',                                       // ADC2
    ],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10',
      'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
      'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    ],
    unsafe: ['GPIO2', 'GPIO8', 'GPIO9', 'GPIO18', 'GPIO19'],

    i2c:  { 0: { sda: 'GPIO8',  scl: 'GPIO9'  } },
    spi:  {
      0: { mosi: 'GPIO6', miso: 'GPIO5', sck: 'GPIO4', cs: 'GPIO7' },  // GPSPI2 / VSPI
    },
    uart: {
      0: { tx: 'GPIO21', rx: 'GPIO20' },
    },
  },

  // ----- Peripherals -------------------------------------------------------
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
  build: {
    extraFlags: [],
  },
};

export default ESP32C3;

// Re-exports
export * from './pins.js';
export * from './peripherals.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  /** All MCU port-level pin names (e.g. 'GPIO0', 'GPIO1'). */
  pinNames: [
    'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
    'GPIO8', 'GPIO9', 'GPIO10',
    'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
    'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: ['I2C0', 'SPI0', 'UART0', 'UART1'] as const,
} as const;
