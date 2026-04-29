// ---------------------------------------------------------------------------
// Symbol kind registry for Arduino/AVR/ESP32 boards
//
// Maps TypeHAL pin names and namespace symbols to their receiver kinds.
// Consumed by the transpiler's IR builder to categorize expressions.
// Registered via `registerSymbolKinds()` when the framework is loaded.
// ---------------------------------------------------------------------------

import type { TypehalReceiverKind } from '@typehal/core/shared';

/**
 * Symbol-to-kind mapping covering Arduino Uno, ESP32 DevKit, and
// common Arduino framework namespaces.
 */
export const SYMBOL_KINDS: Record<string, TypehalReceiverKind> = {
  // ---- Interrupt-capable digital pins (Arduino Uno) ----
  D0:  'interrupt',
  D1:  'interrupt',
  D2:  'interrupt',

  // ---- Digital-only pins (Arduino Uno) ----
  D4:  'digital',
  D7:  'digital',
  D8:  'digital',
  D12: 'digital',
  D13: 'digital',

  // ---- PWM-capable pins (Arduino Uno) ----
  D3:  'pwm',
  D5:  'pwm',
  D6:  'pwm',
  D9:  'pwm',
  D10: 'pwm',
  D11: 'pwm',

  // ---- ESP32 DevKit additional PWM-capable pins ----
  D14: 'pwm',
  D15: 'pwm',
  D16: 'pwm',
  D17: 'pwm',
  D18: 'pwm',
  D19: 'pwm',
  D21: 'pwm',
  D22: 'pwm',
  D23: 'pwm',
  D25: 'pwm',
  D26: 'pwm',
  D27: 'pwm',
  D32: 'pwm',
  D33: 'pwm',

  // ---- Analog input pins ----
  A0:  'analog-input',
  A1:  'analog-input',
  A2:  'analog-input',
  A3:  'analog-input',
  A4:  'analog-input',
  A5:  'analog-input',
  A6:  'analog-input',
  A7:  'analog-input',

  // ---- ESP32 DevKit input-only analog pins ----
  D34: 'analog-input',
  D35: 'analog-input',
  D36: 'analog-input',
  D39: 'analog-input',

  // ---- Named aliases ----
  LED:  'digital',
  SDA:  'analog-input',
  SCL:  'analog-input',
  MOSI: 'pwm',
  MISO: 'digital',
  SCK:  'digital',
  SS:   'pwm',
  TX:   'interrupt',
  RX:   'interrupt',
  TX2:  'pwm',
  RX2:  'pwm',
  DAC1: 'pwm',
  DAC2: 'pwm',

  // ---- Peripheral objects ----
  I2C0:    'i2c',
  I2C1:    'i2c',
  I2C2:    'i2c',
  SPI0:    'spi',
  SPI1:    'spi',
  UART2:   'serial',

  // ---- Utility namespaces ----
  Pulse:   'pulse',
  Shift:   'shift',
  Random:  'random',
  Num:     'num',

  // ---- Arduino peripheral namespaces ----
  EEPROM:  'eeprom',
  Timing:  'timing',
  WDT:     'wdt',
  Preferences: 'preferences',
};
