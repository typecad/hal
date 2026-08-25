// ---------------------------------------------------------------------------
// @typecad/mcu-rp2040 — MCU definition manifest
// Dual-core ARM Cortex-M0+ @ 133 MHz. 30 GPIO. No wireless. No PSRAM.
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

// `functions` entries MUST be inline object literals, not helper calls: the
// board-constants flattener is a static AST walker (cuttlefish
// ir/board-resolver.ts) that drops call-expression array elements — a
// `functions: [adc(0, 0)]` style entry flattens to nothing and the
// pin-capability validator then reports "no pins support analog input".

export const RP2040: MCUDefinition = {
  id: 'rp2040',
  name: 'RP2040',
  architecture: 'rp2040',
  memory: {
    flash:    2 * 1024 * 1024,
    sram:     264 * 1024,
    eeprom:   0,
  },
  pins: {
    all: [
      { number:  0, gpio:  0, name: 'GP0',  capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }], alternateFunctions: ['UART0 TX'] },
      { number:  1, gpio:  1, name: 'GP1',  capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }], alternateFunctions: ['UART0 RX'] },
      { number:  2, gpio:  2, name: 'GP2',  capabilities: FULL_GPIO, alternateFunctions: [] },
      { number:  3, gpio:  3, name: 'GP3',  capabilities: FULL_GPIO, alternateFunctions: [] },
      { number:  4, gpio:  4, name: 'GP4',  capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }], alternateFunctions: ['I2C0 SDA'] },
      { number:  5, gpio:  5, name: 'GP5',  capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }], alternateFunctions: ['I2C0 SCL'] },
      { number:  6, gpio:  6, name: 'GP6',  capabilities: FULL_GPIO, alternateFunctions: [] },
      { number:  7, gpio:  7, name: 'GP7',  capabilities: FULL_GPIO, alternateFunctions: [] },
      { number:  8, gpio:  8, name: 'GP8',  capabilities: FULL_GPIO, alternateFunctions: [] },
      { number:  9, gpio:  9, name: 'GP9',  capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 10, gpio: 10, name: 'GP10', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 11, gpio: 11, name: 'GP11', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 12, gpio: 12, name: 'GP12', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 13, gpio: 13, name: 'GP13', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 14, gpio: 14, name: 'GP14', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 15, gpio: 15, name: 'GP15', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 16, gpio: 16, name: 'GP16', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'miso' }], alternateFunctions: ['SPI0 MISO'] },
      { number: 17, gpio: 17, name: 'GP17', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'cs' }], alternateFunctions: ['SPI0 CS'] },
      { number: 18, gpio: 18, name: 'GP18', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'sck' }], alternateFunctions: ['SPI0 SCK'] },
      { number: 19, gpio: 19, name: 'GP19', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 0, role: 'mosi' }], alternateFunctions: ['SPI0 MOSI'] },
      { number: 20, gpio: 20, name: 'GP20', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 21, gpio: 21, name: 'GP21', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 22, gpio: 22, name: 'GP22', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 23, gpio: 23, name: 'GP23', capabilities: FULL_GPIO, alternateFunctions: ['SPI CS'],
        warnings: ['GP23 is connected to internal SPI flash — do not use as GPIO'], unsafe: true, notes: 'SPI flash pin' },
      { number: 24, gpio: 24, name: 'GP24', capabilities: FULL_GPIO, alternateFunctions: ['SPI SCK'],
        warnings: ['GP24 is connected to internal SPI flash — do not use as GPIO'], unsafe: true, notes: 'SPI flash pin' },
      { number: 25, gpio: 25, name: 'GP25', capabilities: FULL_GPIO, alternateFunctions: ['Onboard LED'],
        warnings: ['GP25 is the onboard LED on the Pico — using as GPIO may interfere'], unsafe: true, notes: 'Onboard LED (Pico)' },
      { number: 26, gpio: 26, name: 'GP26', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }], alternateFunctions: ['ADC0'] },
      { number: 27, gpio: 27, name: 'GP27', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch1' }], alternateFunctions: ['ADC1'] },
      { number: 28, gpio: 28, name: 'GP28', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' }], alternateFunctions: ['ADC2'] },
      { number: 29, gpio: 29, name: 'GP29', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }], alternateFunctions: ['ADC3'],
        warnings: ['GP29 is connected to internal SPI flash — do not use as GPIO'], unsafe: true, notes: 'SPI flash / ADC3' },
    ],

    digital: ['GP0','GP1','GP2','GP3','GP4','GP5','GP6','GP7','GP8','GP9',
              'GP10','GP11','GP12','GP13','GP14','GP15','GP16','GP17','GP18','GP19',
              'GP20','GP21','GP22','GP23','GP24','GP25','GP26','GP27','GP28','GP29'],
    analog: ['GP26','GP27','GP28','GP29'],
    pwm: ['GP0','GP1','GP2','GP3','GP4','GP5','GP6','GP7','GP8','GP9',
          'GP10','GP11','GP12','GP13','GP14','GP15','GP16','GP17','GP18','GP19',
          'GP20','GP21','GP22','GP26','GP27','GP28','GP29'],
    unsafe: ['GP23','GP24','GP25','GP29'],

    i2c:  { 0: { sda: 'GP4', scl: 'GP5' } },
    spi:  { 0: { mosi: 'GP19', miso: 'GP16', sck: 'GP18', cs: 'GP17' } },
    uart: { 0: { tx: 'GP0', rx: 'GP1' } },
  },

  peripherals: MCU_PERIPHERALS,

  features: {
    multicore: true, coreCount: 2, deepSleep: true, watchdog: true,
    externalInterrupts: true, hardwareRng: true, fpu: false,
  },
  build: { extraFlags: [] },
};

export default RP2040;
export * from './pins.js';
export * from './peripherals.js';

export const TypeCADManifest = {
  pinNames: ['GP0','GP1','GP2','GP3','GP4','GP5','GP6','GP7','GP8','GP9',
             'GP10','GP11','GP12','GP13','GP14','GP15','GP16','GP17','GP18','GP19',
             'GP20','GP21','GP22','GP23','GP24','GP25','GP26','GP27','GP28','GP29'] as const,
  peripheralNames: ['I2C0','I2C1','SPI0','SPI1','UART0','UART1'] as const,
} as const;

// Generic HAL re-exports — an MCU package is a superset of @typecad/hal
// (mirrors board packages), so code importing from '@typecad/board' resolves
// identically whether a board package is configured or bare silicon.
export * from '@typecad/hal';
