// ---------------------------------------------------------------------------
// @typecad/mcu-atmega328p — Hardware peripheral descriptions
//
// Describes the peripherals built into the ATmega328P silicon.
// These are properties of the chip, not the board — every ATmega328P has
// exactly the same peripheral count regardless of what board it's on.
//
// Source: ATmega328P datasheet, Section 2 — Block Diagram / Peripheral Summary
// ---------------------------------------------------------------------------

import type {
  PeripheralInstance,
  ADCDefinition,
  PWMDefinition,
  TimerDefinition,
} from '@typecad/cuttlefish/api/schema';
import {
  I2CBus,
  SPIBus,
  SerialPort,
  i2cName,
  spiName,
  serialName,
  createHALInstances,
} from '@typecad/hal';

// ---------------------------------------------------------------------------
// UART — 1 USART peripheral
// ---------------------------------------------------------------------------

/**
 * USART peripherals on the ATmega328P.
 * The ATmega328P has a single USART with full-duplex TX/RX.
 */
export const UART_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { tx: 'PD1', rx: 'PD0' } },
] as const;

// ---------------------------------------------------------------------------
// I2C (TWI) — 1 Two-Wire Interface
// ---------------------------------------------------------------------------

/**
 * I2C/TWI peripherals on the ATmega328P.
 * Single TWI peripheral with SDA/SCL on Port C.
 */
export const I2C_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { sda: 'PC4', scl: 'PC5' } },
] as const;

// ---------------------------------------------------------------------------
// SPI — 1 SPI peripheral
// ---------------------------------------------------------------------------

/**
 * SPI peripherals on the ATmega328P.
 * Single SPI peripheral in Master/Slave mode.
 */
export const SPI_INSTANCES: readonly PeripheralInstance[] = [
  { instance: 0, defaultPins: { mosi: 'PB3', miso: 'PB4', sck: 'PB5', cs: 'PB2' } },
] as const;

// ---------------------------------------------------------------------------
// ADC — 1 ADC with 6 (single-ended) channels on Port C
// ---------------------------------------------------------------------------

/**
 * ADC peripheral on the ATmega328P.
 * 10-bit successive approximation ADC with 6 single-ended channels on PC0–PC5,
 * plus internal channels for temperature sensor and bandgap reference.
 *
 * Note: referenceVoltage and referenceVoltages are board-dependent (determined
 * by the board's power supply voltage). They are provided as chip-typical
 * defaults (5V) and should be overridden by the board package if the board
 * runs at a different voltage (e.g. 3.3V Pro Mini).
 */
export const ADC_INSTANCES: readonly ADCDefinition[] = [
  {
    instance: 0,
    channels: 6,
    resolution: 10,
    maxValue: 1023,  // (1 << 10) - 1
    referenceVoltage: 5.0,  // chip-typical default; board may override
    referenceVoltages: {
      DEFAULT: 5.0,    // VCC — board-dependent
      INTERNAL: 1.1,   // internal 1.1V bandgap reference
    },
  },
] as const;

// ---------------------------------------------------------------------------
// PWM — 6 channels from 3 timers
// ---------------------------------------------------------------------------

/**
 * PWM capabilities on the ATmega328P.
 * 6 PWM channels derived from Timer0 (2 ch), Timer1 (2 ch), Timer2 (2 ch).
 * 8-bit resolution on Timer0/Timer2, up to 16-bit on Timer1 (but framework
 * defaults often use 8-bit for all).
 */
export const PWM_CAPABILITIES: PWMDefinition = {
  channels: 6,
  resolution: 8,
  maxFrequency: 62_500,  // at 16 MHz with default prescaler
} as const;

/**
 * PWM output pin assignments.
 * Maps each PWM output compare channel to its physical pin.
 */
export const PWM_PIN_MAP = {
  /** Timer0 Channel A — PD6 */
  OC0A: 'PD6',
  /** Timer0 Channel B — PD5 */
  OC0B: 'PD5',
  /** Timer1 Channel A — PB1 */
  OC1A: 'PB1',
  /** Timer1 Channel B — PB2 */
  OC1B: 'PB2',
  /** Timer2 Channel A — PB3 */
  OC2A: 'PB3',
  /** Timer2 Channel B — PD3 */
  OC2B: 'PD3',
} as const;

// ---------------------------------------------------------------------------
// Timers — 3 hardware timers
// ---------------------------------------------------------------------------

/**
 * Hardware timers on the ATmega328P.
 * Timer0 is typically reserved for system timing functions (millis/delay)
 * (type: 'sys'). Timer1 and Timer2 are available for general application use.
 */
export const TIMER_INSTANCES: readonly TimerDefinition[] = [
  {
    instance: 0,
    type: 'sys',
    bits: 8,
    frequency: 16_000_000,
    features: ['pwm', 'interrupt'],
  },
  {
    instance: 1,
    type: 'general',
    bits: 16,
    frequency: 16_000_000,
    features: ['pwm', 'interrupt', 'capture', 'compare'],
  },
  {
    instance: 2,
    type: 'general',
    bits: 8,
    frequency: 16_000_000,
    features: ['pwm', 'interrupt'],
  },
] as const;

// ---------------------------------------------------------------------------
// External interrupts
// ---------------------------------------------------------------------------

/**
 * External interrupt pins on the ATmega328P.
 * Only PD2 (INT0) and PD3 (INT1) support hardware external interrupts.
 * Pin-change interrupts are available on all pins but are handled separately.
 */
export const EXTERNAL_INTERRUPTS = [
  { instance: 0, pin: 'PD2' },  // INT0
  { instance: 1, pin: 'PD3' },  // INT1
] as const;

// ---------------------------------------------------------------------------
// Aggregate MCU peripheral description
// ---------------------------------------------------------------------------

/**
 * Complete hardware peripheral description for the ATmega328P.
 * Board packages can import this and spread it into their BoardDefinition,
 * overriding board-specific fields (aliases, reference voltages, etc.).
 *
 * @example
 * ```typescript
 * // In a board package:
 * import { MCU_PERIPHERALS } from '@typecad/mcu-atmega328p';
 *
 * export const MyBoard: BoardDefinition = {
 *   // ...
 *   peripherals: {
 *     ...MCU_PERIPHERALS,
 *     aliases: { UART0: 'Serial', I2C0: 'Wire', SPI0: 'SPI' },
 *   },
 * };
 * ```
 */
export const MCU_PERIPHERALS = {
  i2c: [...I2C_INSTANCES],
  spi: [...SPI_INSTANCES],
  uart: [...UART_INSTANCES],
  adc: [...ADC_INSTANCES],
  pwm: PWM_CAPABILITIES,
  timers: [...TIMER_INSTANCES],
} as const;

// ---------------------------------------------------------------------------
// HAL object instances — auto-generated from peripheral definitions
// ---------------------------------------------------------------------------

/** I2C bus instances */
export const [I2C0] = createHALInstances(I2C_INSTANCES, i => new I2CBus(i2cName(i)));

/** SPI bus instances */
export const [SPI0] = createHALInstances(SPI_INSTANCES, i => new SPIBus(spiName(i)));

/** UART/Serial instances */
export const [UART0] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
