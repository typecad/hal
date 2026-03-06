// ---------------------------------------------------------------------------
// @typecode/core/arduino — Arduino-compatible API interfaces
//
// Import from '@typecode/core/arduino' to use Arduino-style APIs:
// - I2C: begin(), beginTransmission(), write(), endTransmission(), requestFrom(), read()
// - SPI: begin(), transfer(), setMode(), setBitOrder(), setFrequency()
// - Serial: begin(), read(), write(), print(), println(), available()
// ---------------------------------------------------------------------------

// I2C Arduino-compatible interface
export type { II2CArduino } from '../bus/i2c-arduino';

// SPI Arduino-compatible interface
export type { ISPIArduino } from '../bus/spi-arduino';

// UART/Serial Arduino-compatible interface
export type { ISerialArduino } from '../bus/uart-arduino';

// Re-export types needed for Arduino API
export type { I2CAddress } from '../bus/i2c';
export { I2CStatus } from '../bus/i2c';
export type { SPIMode, SPIBitOrder, SPISettings } from '../bus/spi';
