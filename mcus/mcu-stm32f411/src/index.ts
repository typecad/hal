// ---------------------------------------------------------------------------
// @typecad/mcu-stm32f411 — MCU definition manifest
//
// STMicroelectronics STM32F411: ARM Cortex-M4F, 512 KB flash, 128 KB SRAM,
// USB OTG_FS. Silicon-level facts only — board overlays live in the
// board-* packages.
//
// Pin numbers use port-block numbering (PA<bit> → bit, PB<bit> → 16+bit,
// PC<bit> → 32+bit) matching the Zephyr per-port gpioa/gpiob/gpioc
// controller split. Bonded pins verified against the STM32F411xC/xE UFQFPN48
// package (stm32duino variant_BLACKPILL_F411CE + hal_stm32's
// stm32f411c(c-e)ux-pinctrl.dtsi).
// ---------------------------------------------------------------------------

import type { MCUDefinition } from '@typecad/cuttlefish/api/schema';
import {
  I2C_INSTANCES,
  SPI_INSTANCES,
  UART_INSTANCES,
  ADC_INSTANCES,
  TIMER_INSTANCES,
} from './peripherals.js';

// ---------------------------------------------------------------------------
// Default capability flags for STM32F411
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Full GPIO: digital I/O + pull-up + pull-down + interrupt + timer PWM. No DAC. */
const FULL_GPIO = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: YES,           interrupt: YES,
  pullUp: YES,        pullDown: YES,
  touch: NO,          openDrain: YES,
} as const;

/** Full GPIO + ADC input (5V-tolerant digital, 3.3V max analog). */
const GPIO_ANALOG = { ...FULL_GPIO, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// MCU definition
// ---------------------------------------------------------------------------

export const STM32F411: MCUDefinition = {
  id: 'stm32f411',
  name: 'STM32F411',
  architecture: 'stm32f411',
  memory: {
    flash:   524_288, // 512 KB
    sram:    131_072, // 128 KB
    eeprom:        0,
  },
  pins: {
    all: [
      // ---- Port A (numbers 0–15) --------------------------------------------
      // PA0 — Black Pill KEY button (active-low); ADC1_IN0; TIM2 ch1/ETR.
      { number:  0, gpio:  0, name: 'PA0', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch0' }],
        alternateFunctions: ['KEY button', 'ADC1_IN0', 'TIM2_CH1', 'USART2_CTS'] },
      { number:  1, gpio:  1, name: 'PA1', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch1' }],
        alternateFunctions: ['ADC1_IN1', 'TIM2_CH2', 'USART2_RTS'] },
      { number:  2, gpio:  2, name: 'PA2', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch2' },
                    { type: 'uart', instance: 1, role: 'tx' }],
        alternateFunctions: ['ADC1_IN2', 'TIM2_CH3', 'USART2_TX'] },
      { number:  3, gpio:  3, name: 'PA3', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch3' },
                    { type: 'uart', instance: 1, role: 'rx' }],
        alternateFunctions: ['ADC1_IN3', 'TIM2_CH4', 'USART2_RX'] },
      { number:  4, gpio:  4, name: 'PA4', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch4' },
                    { type: 'spi', instance: 0, role: 'cs' }],
        alternateFunctions: ['ADC1_IN4', 'SPI1_NSS', 'USART2_CK'] },
      { number:  5, gpio:  5, name: 'PA5', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch5' },
                    { type: 'spi', instance: 0, role: 'sck' }],
        alternateFunctions: ['ADC1_IN5', 'SPI1_SCK'] },
      { number:  6, gpio:  6, name: 'PA6', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch6' },
                    { type: 'spi', instance: 0, role: 'miso' }],
        alternateFunctions: ['ADC1_IN6', 'SPI1_MISO', 'TIM3_CH1'] },
      { number:  7, gpio:  7, name: 'PA7', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch7' },
                    { type: 'spi', instance: 0, role: 'mosi' }],
        alternateFunctions: ['ADC1_IN7', 'SPI1_MOSI', 'TIM3_CH2'] },
      { number:  8, gpio:  8, name: 'PA8', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 2, role: 'scl' }],
        alternateFunctions: ['I2C3_SCL', 'TIM1_CH1', 'USB_SOF'] },
      { number:  9, gpio:  9, name: 'PA9', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'tx' }],
        alternateFunctions: ['USART1_TX'] },
      { number: 10, gpio: 10, name: 'PA10', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 0, role: 'rx' }],
        alternateFunctions: ['USART1_RX'] },
      // PA11/PA12 — the Black Pill's USB-C data lines (OTG_FS DM/DP).
      { number: 11, gpio: 11, name: 'PA11', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 2, role: 'tx' }],
        alternateFunctions: ['USB_DM', 'USART6_TX', 'TIM1_CH4'],
        warnings: ['PA11 is the USB D- line on the Black Pill — using it as GPIO breaks USB (DFU flashing, console)'] },
      { number: 12, gpio: 12, name: 'PA12', capabilities: FULL_GPIO,
        functions: [{ type: 'uart', instance: 2, role: 'rx' }],
        alternateFunctions: ['USB_DP', 'USART6_RX'],
        warnings: ['PA12 is the USB D+ line on the Black Pill — using it as GPIO breaks USB (DFU flashing, console)'] },
      // PA13/PA14 — SWDIO/SWCLK; held by the debugger on a Black Pill.
      { number: 13, gpio: 13, name: 'PA13', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['SWDIO'],
        warnings: ['PA13 is the SWDIO debug line — using it as GPIO breaks SWD debugging'] },
      { number: 14, gpio: 14, name: 'PA14', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['SWCLK'],
        warnings: ['PA14 is the SWCLK debug line — using it as GPIO breaks SWD debugging'] },
      { number: 15, gpio: 15, name: 'PA15', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 2, role: 'cs' }],
        alternateFunctions: ['SPI3_NSS', 'TIM2_CH1', 'SPI1_NSS'] },

      // ---- Port B (numbers 16–31; PB11 not bonded on UFQFPN48) -------------
      { number: 16, gpio: 16, name: 'PB0', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch8' }],
        alternateFunctions: ['ADC1_IN8', 'TIM3_CH3', 'TIM1_CH2N'] },
      { number: 17, gpio: 17, name: 'PB1', capabilities: GPIO_ANALOG,
        functions: [{ type: 'adc', instance: 0, role: 'ch9' }],
        alternateFunctions: ['ADC1_IN9', 'TIM3_CH4', 'TIM1_CH3N'] },
      // PB2 — doubles as the BOOT1 strap (must read low at reset for flash
      // boot; check the module's wiring before relying on it as GPIO).
      { number: 18, gpio: 18, name: 'PB2', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['BOOT1'] },
      { number: 19, gpio: 19, name: 'PB3', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 1, role: 'sda' },
                    { type: 'spi', instance: 2, role: 'sck' }],
        alternateFunctions: ['I2C2_SDA', 'SPI3_SCK', 'TIM2_CH2'] },
      { number: 20, gpio: 20, name: 'PB4', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 2, role: 'sda' },
                    { type: 'spi', instance: 2, role: 'miso' }],
        alternateFunctions: ['I2C3_SDA', 'SPI3_MISO', 'TIM3_CH1'] },
      { number: 21, gpio: 21, name: 'PB5', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 2, role: 'mosi' }],
        alternateFunctions: ['SPI3_MOSI', 'TIM3_CH2', 'I2C1_SMBA'] },
      // PB6/PB7 — the Black Pill's board-enabled PWM channels (TIM4 ch1/ch2,
      // enabled by Zephyr's blackpill_f411ce DTS as `pwm4`).
      { number: 22, gpio: 22, name: 'PB6', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['TIM4_CH1', 'I2C1_SCL', 'USART1_TX'] },
      { number: 23, gpio: 23, name: 'PB7', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['TIM4_CH2', 'I2C1_SDA', 'USART1_RX'] },
      { number: 24, gpio: 24, name: 'PB8', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'scl' }],
        alternateFunctions: ['I2C1_SCL', 'TIM4_CH3'] },
      { number: 25, gpio: 25, name: 'PB9', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 0, role: 'sda' }],
        alternateFunctions: ['I2C1_SDA', 'TIM4_CH4'] },
      { number: 26, gpio: 26, name: 'PB10', capabilities: FULL_GPIO,
        functions: [{ type: 'i2c', instance: 1, role: 'scl' },
                    { type: 'spi', instance: 1, role: 'sck' }],
        alternateFunctions: ['I2C2_SCL', 'SPI2_SCK', 'TIM2_CH3'] },
      { number: 28, gpio: 28, name: 'PB12', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'cs' }],
        alternateFunctions: ['SPI2_NSS'] },
      { number: 29, gpio: 29, name: 'PB13', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'sck' }],
        alternateFunctions: ['SPI2_SCK', 'TIM1_CH1N'] },
      { number: 30, gpio: 30, name: 'PB14', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'miso' }],
        alternateFunctions: ['SPI2_MISO', 'TIM1_CH2N'] },
      { number: 31, gpio: 31, name: 'PB15', capabilities: FULL_GPIO,
        functions: [{ type: 'spi', instance: 1, role: 'mosi' }],
        alternateFunctions: ['SPI2_MOSI', 'TIM1_CH3N'] },

      // ---- Port C (numbers 32–47; only PC13–PC15 on UFQFPN48) --------------
      // PC13 — the Black Pill onboard LED (active-low).
      { number: 45, gpio: 45, name: 'PC13', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['User LED (active-low)'],
        notes: 'Active-low: logic 0 = LED on. Zephyr DT honors GPIO_ACTIVE_LOW.' },
      // PC14/PC15 — the 32.768 kHz LSE crystal pads on the Black Pill.
      { number: 46, gpio: 46, name: 'PC14', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['LSE OSC32_IN'],
        warnings: ['PC14 is the 32.768 kHz crystal pad on the Black Pill — using it as GPIO requires removing the LSE'] },
      { number: 47, gpio: 47, name: 'PC15', capabilities: FULL_GPIO,
        functions: [], alternateFunctions: ['LSE OSC32_OUT'],
        warnings: ['PC15 is the 32.768 kHz crystal pad on the Black Pill — using it as GPIO requires removing the LSE'] },
    ],

    digital: [
      'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7',
      'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA13', 'PA14', 'PA15',
      'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7',
      'PB8', 'PB9', 'PB10', 'PB12', 'PB13', 'PB14', 'PB15',
      'PC13', 'PC14', 'PC15',
    ],
    analog: ['PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PB0', 'PB1'],
    pwm: [
      'PA0', 'PA1', 'PA2', 'PA3', 'PA5', 'PA6', 'PA7', 'PA8', 'PA15',
      'PB0', 'PB1', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9',
      'PB10', 'PB13', 'PB14', 'PB15',
    ],
    unsafe: ['PA11', 'PA12', 'PA13', 'PA14', 'PC14', 'PC15'], // USB/SWD/LSE-shared

    i2c: {
      0: { sda: 'PB9', scl: 'PB8' },
      1: { sda: 'PB3', scl: 'PB10' },
      2: { sda: 'PB4', scl: 'PA8' },
    },
    spi: {
      0: { mosi: 'PA7', miso: 'PA6', sck: 'PA5', cs: 'PA4' },
      1: { mosi: 'PB15', miso: 'PB14', sck: 'PB13', cs: 'PB12' },
      2: { mosi: 'PB5', miso: 'PB4', sck: 'PB3', cs: 'PA15' },
    },
    uart: {
      0: { tx: 'PA9', rx: 'PA10' },
      1: { tx: 'PA2', rx: 'PA3' },
      2: { tx: 'PA11', rx: 'PA12' },
    },
  },

  peripherals: {
    i2c: I2C_INSTANCES,
    spi: SPI_INSTANCES,
    uart: UART_INSTANCES,
    adc: ADC_INSTANCES,
    timers: TIMER_INSTANCES,
    pwm: { channels: 20, resolution: 16, maxFrequency: 50_000_000 },
    aliases: {},
  },

  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: true,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: false, // no hardware RNG on STM32F411
    fpu: true,
  },

  build: {
    extraFlags: [],
  },
};

export default STM32F411;

// ---------------------------------------------------------------------------
// Pin + peripheral re-exports
// ---------------------------------------------------------------------------

export * from './pins.js';
export * from './peripherals.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  /** All MCU port-level pin names (e.g. 'PA5', 'PC13'). */
  pinNames: [
    'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7',
    'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA13', 'PA14', 'PA15',
    'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7',
    'PB8', 'PB9', 'PB10', 'PB12', 'PB13', 'PB14', 'PB15',
    'PC13', 'PC14', 'PC15',
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: [] as const,
} as const;
