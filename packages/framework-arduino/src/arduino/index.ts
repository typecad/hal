// ---------------------------------------------------------------------------
// @typehal/framework-arduino/arduino — Arduino-compatible API types and stubs
//
// Import from '@typehal/framework-arduino/arduino' to use Arduino-style APIs
// (Wire, SPI, Serial) with full TypeScript type checking.
// ---------------------------------------------------------------------------

// Interface definitions
export type { II2CArduino } from './i2c-arduino';
export type { ISPIArduino } from './spi-arduino';
export type { ISerialArduino } from './uart-arduino';

// Supporting types from core (re-exported for convenience)
export type { I2CAddress } from '@typehal/core';
export { I2CStatus } from '@typehal/core';
export type { SPIMode, SPIBitOrder, SPISettings } from '@typehal/core';

// Arduino Uno stubs
export { I2C0, SPI0, UART0 } from './stubs-uno';

// ESP32 DevKit stubs
export { I2C0 as I2C0_ESP32, I2C1, SPI0 as SPI0_ESP32, SPI1, UART0 as UART0_ESP32, UART2 } from './stubs-esp32';
