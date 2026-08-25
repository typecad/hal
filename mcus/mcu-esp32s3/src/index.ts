// ---------------------------------------------------------------------------
// @typecad/mcu-esp32s3 — MCU definition manifest
//
// ESP32-S3 is dual-core Xtensa LX7 @ 240 MHz with Wi-Fi 4 + BLE 5 and native
// USB-OTG. It has 45 GPIO (0-21, 26-48); GPIO 22-25 and 32-37 do NOT exist on
// the S3 (different pad layout from classic ESP32). All GPIOs are bidirectional
// (no input-only pins). DAC was removed on the S3.
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import { MCU_PERIPHERALS } from './peripherals.js';

// ---------------------------------------------------------------------------
// Default capability flags for ESP32-S3
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
// ADC1 channels: GPIO1..GPIO10 -> ch0..ch9 (always usable).
// ADC2 channels: GPIO11..GPIO20 -> ch0..ch9 (NOT usable while Wi-Fi is on).
// Touch channels: GPIO1..GPIO14 -> T1..T14.
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

export const ESP32S3: MCUDefinition = {
  id: 'esp32-s3',
  name: 'ESP32-S3',
  architecture: 'esp32s3',
  memory: {
    flash:    384 * 1024, // usable app flash; remainder reserved by bootloader/OTADATA
    sram:     512 * 1024, // 512 KB
    eeprom:   0,
    rtcMemory: 16 * 1024, // 16 KB RTC slow memory
  },
  pins: {
    all: [
      // ---- Boot strapping pins (unsafe) ------------------------------------
      { number:  0, gpio:  0, name: 'GPIO0', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(1, 0), touch(1)],
        alternateFunctions: ['ADC1_CH0', 'Touch1'],
        warnings: ['GPIO0 is a strapping pin — must be HIGH at boot for normal flash boot; LOW enters download mode'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  1, gpio:  1, name: 'GPIO1', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 1), touch(2)],
        alternateFunctions: ['ADC1_CH1', 'Touch2'] },

      { number:  2, gpio:  2, name: 'GPIO2', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 2), touch(3)],
        alternateFunctions: ['ADC1_CH2', 'Touch3'] },

      { number:  3, gpio:  3, name: 'GPIO3', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 3), touch(4)],
        alternateFunctions: ['ADC1_CH3', 'Touch4'],
        warnings: ['GPIO3 is a strapping pin — controls JTAG signal source at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number:  4, gpio:  4, name: 'GPIO4', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 4), touch(5)],
        alternateFunctions: ['ADC1_CH4', 'Touch5'] },

      { number:  5, gpio:  5, name: 'GPIO5', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 5), touch(6)],
        alternateFunctions: ['ADC1_CH5', 'Touch6'] },

      { number:  6, gpio:  6, name: 'GPIO6', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 6), touch(7)],
        alternateFunctions: ['ADC1_CH6', 'Touch7'] },

      { number:  7, gpio:  7, name: 'GPIO7', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 7), touch(8)],
        alternateFunctions: ['ADC1_CH7', 'Touch8'] },

      { number:  8, gpio:  8, name: 'GPIO8', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 8), touch(9), { type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['ADC1_CH8', 'Touch9', 'I2C0 SDA'],
        warnings: ['Using GPIO8 as GPIO will interfere with I2C0 SDA'] },

      { number:  9, gpio:  9, name: 'GPIO9', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 9), touch(10), { type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['ADC1_CH9', 'Touch10', 'I2C0 SCL'],
        warnings: ['Using GPIO9 as GPIO will interfere with I2C0 SCL'] },

      { number: 10, gpio: 10, name: 'GPIO10', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(1, 10), touch(11)],
        alternateFunctions: ['ADC1_CH10', 'Touch11'] },

      { number: 11, gpio: 11, name: 'GPIO11', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 0), touch(12), { type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['ADC2_CH0', 'Touch12', 'FSPI SCK'],
        warnings: ['GPIO11 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 12, gpio: 12, name: 'GPIO12', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 1), touch(13), { type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['ADC2_CH1', 'Touch13', 'FSPI MOSI'],
        warnings: ['GPIO12 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 13, gpio: 13, name: 'GPIO13', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 2), touch(14), { type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['ADC2_CH2', 'Touch14', 'FSPI MISO'],
        warnings: ['GPIO13 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 14, gpio: 14, name: 'GPIO14', capabilities: FULL_GPIO_ANALOG_TOUCH,
        functions: [adc(2, 3)],
        alternateFunctions: ['ADC2_CH3'],
        warnings: ['GPIO14 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 15, gpio: 15, name: 'GPIO15', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 4)],
        alternateFunctions: ['ADC2_CH4'],
        warnings: ['GPIO15 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 16, gpio: 16, name: 'GPIO16', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 5)],
        alternateFunctions: ['ADC2_CH5'],
        warnings: ['GPIO16 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 17, gpio: 17, name: 'GPIO17', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 6)],
        alternateFunctions: ['ADC2_CH6'],
        warnings: ['GPIO17 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 18, gpio: 18, name: 'GPIO18', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 7)],
        alternateFunctions: ['ADC2_CH7'],
        warnings: ['GPIO18 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'] },

      { number: 19, gpio: 19, name: 'GPIO19', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 8), { type: 'usb', instance: 0, role: 'dm' }],
        alternateFunctions: ['ADC2_CH8', 'USB D-'],
        warnings: ['GPIO19 is USB D- — using it as GPIO disables native USB', 'GPIO19 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'],
        unsafe: true, notes: 'USB D- pin' },

      { number: 20, gpio: 20, name: 'GPIO20', capabilities: FULL_GPIO_ANALOG,
        functions: [adc(2, 9), { type: 'usb', instance: 0, role: 'dp' }],
        alternateFunctions: ['ADC2_CH9', 'USB D+'],
        warnings: ['GPIO20 is USB D+ — using it as GPIO disables native USB', 'GPIO20 is ADC2 — ADC2 is unusable while Wi-Fi is enabled'],
        unsafe: true, notes: 'USB D+ pin' },

      { number: 21, gpio: 21, name: 'GPIO21', capabilities: FULL_GPIO,
        alternateFunctions: [] },

      // ---- GPIO 22-25 do NOT exist on the ESP32-S3 -------------------------

      // ---- GPIO 26-32 connected to SPI flash / PSRAM (unsafe) ---------------
      { number: 26, gpio: 26, name: 'GPIO26', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICS1'],
        warnings: ['GPIO26 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 27, gpio: 27, name: 'GPIO27', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIHD'],
        warnings: ['GPIO27 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 28, gpio: 28, name: 'GPIO28', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIWP'],
        warnings: ['GPIO28 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 29, gpio: 29, name: 'GPIO29', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICS0'],
        warnings: ['GPIO29 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 30, gpio: 30, name: 'GPIO30', capabilities: FULL_GPIO,
        alternateFunctions: ['SPICLK'],
        warnings: ['GPIO30 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 31, gpio: 31, name: 'GPIO31', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIQ'],
        warnings: ['GPIO31 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },
      { number: 32, gpio: 32, name: 'GPIO32', capabilities: FULL_GPIO,
        alternateFunctions: ['SPID'],
        warnings: ['GPIO32 is connected to SPI flash/PSRAM — do not use as GPIO'],
        unsafe: true, notes: 'SPI flash pin' },

      // ---- GPIO 33-37 connected to octal PSRAM on PSRAM modules -----------
      { number: 33, gpio: 33, name: 'GPIO33', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO4'],
        warnings: ['GPIO33 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 34, gpio: 34, name: 'GPIO34', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO5'],
        warnings: ['GPIO34 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 35, gpio: 35, name: 'GPIO35', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO6'],
        warnings: ['GPIO35 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 36, gpio: 36, name: 'GPIO36', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIIO7'],
        warnings: ['GPIO36 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },
      { number: 37, gpio: 37, name: 'GPIO37', capabilities: FULL_GPIO,
        alternateFunctions: ['SPIDQS'],
        warnings: ['GPIO37 is connected to octal PSRAM on some modules — verify before use'],
        unsafe: true, notes: 'Octal SPI/PSRAM pin on PSRAM modules' },

      { number: 38, gpio: 38, name: 'GPIO38', capabilities: FULL_GPIO,
        alternateFunctions: [] },
      { number: 39, gpio: 39, name: 'GPIO39', capabilities: FULL_GPIO,
        alternateFunctions: ['MTCK'] },
      { number: 40, gpio: 40, name: 'GPIO40', capabilities: FULL_GPIO,
        alternateFunctions: ['MTDO'] },
      { number: 41, gpio: 41, name: 'GPIO41', capabilities: FULL_GPIO,
        alternateFunctions: ['MTDI'] },
      { number: 42, gpio: 42, name: 'GPIO42', capabilities: FULL_GPIO,
        alternateFunctions: ['MTMS'] },

      // ---- UART0 default pins ----------------------------------------------
      { number: 43, gpio: 43, name: 'GPIO43', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['UART0 TX'],
        warnings: ['Using GPIO43 as GPIO will interfere with UART0 transmit'] },
      { number: 44, gpio: 44, name: 'GPIO44', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['UART0 RX'],
        warnings: ['Using GPIO44 as GPIO will interfere with UART0 receive'] },

      { number: 45, gpio: 45, name: 'GPIO45', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO45 is a strapping pin — sets VDD_SPI voltage at boot'],
        unsafe: true, notes: 'Boot strapping pin' },
      { number: 46, gpio: 46, name: 'GPIO46', capabilities: FULL_GPIO,
        alternateFunctions: [],
        warnings: ['GPIO46 is a strapping pin — controls boot mode at boot'],
        unsafe: true, notes: 'Boot strapping pin' },

      { number: 47, gpio: 47, name: 'GPIO47', capabilities: FULL_GPIO,
        alternateFunctions: ['RGB_DATA'] },
      { number: 48, gpio: 48, name: 'GPIO48', capabilities: FULL_GPIO,
        alternateFunctions: ['RGB_DATA', 'Onboard LED (DevKitC-1)'],
        onboardLed: true },
    ],

    digital: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30', 'GPIO31', 'GPIO32',
      'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO37', 'GPIO38', 'GPIO39',
      'GPIO40', 'GPIO41', 'GPIO42', 'GPIO43', 'GPIO44', 'GPIO45', 'GPIO46',
      'GPIO47', 'GPIO48',
    ],
    analog: [
      'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7', 'GPIO8',
      'GPIO9', 'GPIO10',                                   // ADC1
      'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15',
      'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20',    // ADC2
    ],
    pwm: [
      'GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7',
      'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
      'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
      'GPIO38', 'GPIO39', 'GPIO40', 'GPIO41', 'GPIO42', 'GPIO43', 'GPIO44',
      'GPIO45', 'GPIO46', 'GPIO47', 'GPIO48',
    ],
    unsafe: [
      'GPIO0', 'GPIO3', 'GPIO19', 'GPIO20',
      'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30', 'GPIO31', 'GPIO32',
      'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO37',
      'GPIO45', 'GPIO46',
    ],

    i2c:  { 0: { sda: 'GPIO8',  scl: 'GPIO9'  } },
    spi:  {
      0: { mosi: 'GPIO12', miso: 'GPIO13', sck: 'GPIO11', cs: 'GPIO10' },  // FSPI
    },
    uart: {
      0: { tx: 'GPIO43', rx: 'GPIO44' },
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

export default ESP32S3;

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
    'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14',
    'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21',
    'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29', 'GPIO30', 'GPIO31', 'GPIO32',
    'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO37', 'GPIO38', 'GPIO39',
    'GPIO40', 'GPIO41', 'GPIO42', 'GPIO43', 'GPIO44', 'GPIO45', 'GPIO46',
    'GPIO47', 'GPIO48',
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: ['I2C0', 'I2C1', 'SPI0', 'SPI1', 'UART0', 'UART1', 'UART2'] as const,
} as const;

// Generic HAL re-exports — an MCU package is a superset of @typecad/hal
// (mirrors board packages), so code importing from '@typecad/board' resolves
// identically whether a board package is configured or bare silicon.
export * from '@typecad/hal';
