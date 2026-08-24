// ---------------------------------------------------------------------------
// @typecad/mcu-rp2350 — MCU definition manifest
// Dual-core ARM Cortex-M33 @ 150 MHz. 48 GPIO. No wireless. No PSRAM.
// FPU present (M33 FPv5-SP).
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

export const RP2350: MCUDefinition = {
  id: 'rp2350',
  name: 'RP2350',
  architecture: 'rp2350',
  memory: {
    flash:    4 * 1024 * 1024,
    sram:     520 * 1024,
    eeprom:   0,
  },
  pins: {
    all: [
      { number: 0, gpio: 0, name: 'GP0', capabilities: FULL_GPIO, functions: [{ type: 'uart', instance: 0, role: 'tx' }], alternateFunctions: ['UART0 TX'] },
      { number: 1, gpio: 1, name: 'GP1', capabilities: FULL_GPIO, functions: [{ type: 'uart', instance: 0, role: 'rx' }], alternateFunctions: ['UART0 RX'] },
      { number: 2, gpio: 2, name: 'GP2', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 3, gpio: 3, name: 'GP3', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 4, gpio: 4, name: 'GP4', capabilities: FULL_GPIO, functions: [{ type: 'i2c', instance: 0, role: 'sda' }], alternateFunctions: ['I2C0 SDA'] },
      { number: 5, gpio: 5, name: 'GP5', capabilities: FULL_GPIO, functions: [{ type: 'i2c', instance: 0, role: 'scl' }], alternateFunctions: ['I2C0 SCL'] },
      { number: 6, gpio: 6, name: 'GP6', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 7, gpio: 7, name: 'GP7', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 8, gpio: 8, name: 'GP8', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 9, gpio: 9, name: 'GP9', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 10, gpio: 10, name: 'GP10', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 11, gpio: 11, name: 'GP11', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 12, gpio: 12, name: 'GP12', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 13, gpio: 13, name: 'GP13', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 14, gpio: 14, name: 'GP14', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 15, gpio: 15, name: 'GP15', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 16, gpio: 16, name: 'GP16', capabilities: FULL_GPIO, functions: [{ type: 'spi', instance: 0, role: 'miso' }], alternateFunctions: ['SPI0 MISO'] },
      { number: 17, gpio: 17, name: 'GP17', capabilities: FULL_GPIO, functions: [{ type: 'spi', instance: 0, role: 'cs' }], alternateFunctions: ['SPI0 CS'] },
      { number: 18, gpio: 18, name: 'GP18', capabilities: FULL_GPIO, functions: [{ type: 'spi', instance: 0, role: 'sck' }], alternateFunctions: ['SPI0 SCK'] },
      { number: 19, gpio: 19, name: 'GP19', capabilities: FULL_GPIO, functions: [{ type: 'spi', instance: 0, role: 'mosi' }], alternateFunctions: ['SPI0 MOSI'] },
      { number: 20, gpio: 20, name: 'GP20', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 21, gpio: 21, name: 'GP21', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 22, gpio: 22, name: 'GP22', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 23, gpio: 23, name: 'GP23', capabilities: FULL_GPIO, alternateFunctions: ['SMPS power-save'],
        warnings: ['GP23 is wired to the SMPS power-save control on the Pico 2 — do not use as GPIO'], unsafe: true, notes: 'SMPS power-save (Pico 2)' },
      { number: 24, gpio: 24, name: 'GP24', capabilities: FULL_GPIO, alternateFunctions: ['VBUS detect'],
        warnings: ['GP24 is the USB VBUS detect input on the Pico 2 — do not use as GPIO'], unsafe: true, notes: 'VBUS detect (Pico 2)' },
      { number: 25, gpio: 25, name: 'GP25', capabilities: FULL_GPIO, alternateFunctions: ['Onboard LED'],
        warnings: ['GP25 is the onboard LED on the Pico 2 — using as GPIO may interfere'], unsafe: true, notes: 'Onboard LED (Pico 2)' },
      { number: 26, gpio: 26, name: 'GP26', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }], alternateFunctions: ['ADC0'] },
      { number: 27, gpio: 27, name: 'GP27', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch1' }], alternateFunctions: ['ADC1'] },
      { number: 28, gpio: 28, name: 'GP28', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' }], alternateFunctions: ['ADC2'] },
      { number: 29, gpio: 29, name: 'GP29', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' }], alternateFunctions: ['ADC3'],
        warnings: ['GP29 is wired to the VSYS monitor divider on the Pico 2 — do not use as GPIO'], unsafe: true, notes: 'VSYS monitor / ADC3 (Pico 2)' },
      // GPIO30–GPIO33 exist on the RP2350B package only. The typecad board
      // target is the Pico 2 (RP2350A — 30 GPIOs), where these pads are not
      // bonded; the board package does not export them.
      { number: 30, gpio: 30, name: 'GP30', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch4' }], alternateFunctions: ['ADC4'] },
      { number: 31, gpio: 31, name: 'GP31', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch5' }], alternateFunctions: ['ADC5'] },
      { number: 32, gpio: 32, name: 'GP32', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch6' }], alternateFunctions: ['ADC6'] },
      { number: 33, gpio: 33, name: 'GP33', capabilities: FULL_GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch7' }], alternateFunctions: ['ADC7'] },
      { number: 34, gpio: 34, name: 'GP34', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 35, gpio: 35, name: 'GP35', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 36, gpio: 36, name: 'GP36', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 37, gpio: 37, name: 'GP37', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 38, gpio: 38, name: 'GP38', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 39, gpio: 39, name: 'GP39', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 40, gpio: 40, name: 'GP40', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 41, gpio: 41, name: 'GP41', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 42, gpio: 42, name: 'GP42', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 43, gpio: 43, name: 'GP43', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 44, gpio: 44, name: 'GP44', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 45, gpio: 45, name: 'GP45', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 46, gpio: 46, name: 'GP46', capabilities: FULL_GPIO, alternateFunctions: [] },
      { number: 47, gpio: 47, name: 'GP47', capabilities: FULL_GPIO, alternateFunctions: [] },
    ],

    digital: [
      'GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19', 'GP20', 'GP21', 'GP22', 'GP23', 'GP24', 'GP25', 'GP26', 'GP27', 'GP28', 'GP29', 'GP30', 'GP31', 'GP32', 'GP33', 'GP34', 'GP35', 'GP36', 'GP37', 'GP38', 'GP39', 'GP40', 'GP41', 'GP42', 'GP43', 'GP44', 'GP45', 'GP46', 'GP47', 
    ],
    analog: [
      'GP26', 'GP27', 'GP28', 'GP29', 'GP30', 'GP31', 'GP32', 'GP33', 
    ],
    pwm: [
      'GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9',
      'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19',
      'GP20', 'GP21', 'GP22', 'GP26', 'GP27', 'GP28', 'GP29', 'GP30', 'GP31', 'GP32',
      'GP33', 'GP34', 'GP35', 'GP36', 'GP37', 'GP38', 'GP39', 'GP40', 'GP41', 'GP42',
      'GP43', 'GP44', 'GP45', 'GP46', 'GP47',
    ],
    unsafe: ['GP23','GP24','GP25','GP29'],

    i2c:  { 0: { sda: 'GP4', scl: 'GP5' } },
    spi:  { 0: { mosi: 'GP19', miso: 'GP16', sck: 'GP18', cs: 'GP17' } },
    uart: { 0: { tx: 'GP0', rx: 'GP1' } },
  },

  peripherals: MCU_PERIPHERALS,

  features: {
    multicore: true, coreCount: 2, deepSleep: true, watchdog: true,
    externalInterrupts: true, hardwareRng: true, fpu: true,
  },
  build: { extraFlags: [] },
};

export default RP2350;
export * from './pins.js';
export * from './peripherals.js';

export const TypeCADManifest = {
  pinNames: [
    'GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19', 'GP20', 'GP21', 'GP22', 'GP23', 'GP24', 'GP25', 'GP26', 'GP27', 'GP28', 'GP29', 'GP30', 'GP31', 'GP32', 'GP33', 'GP34', 'GP35', 'GP36', 'GP37', 'GP38', 'GP39', 'GP40', 'GP41', 'GP42', 'GP43', 'GP44', 'GP45', 'GP46', 'GP47', 
  ] as const,
  peripheralNames: ['I2C0', 'I2C1', 'SPI0', 'SPI1', 'UART0', 'UART1'] as const,
} as const;
