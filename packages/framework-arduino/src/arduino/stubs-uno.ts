// ---------------------------------------------------------------------------
// Arduino Uno — Arduino-compatible API stub implementations
//
// Empty stubs for type checking. The transpiler replaces these with Arduino
// C++ calls via framework-arduino handlers.
// ---------------------------------------------------------------------------

import type { II2CArduino } from './i2c-arduino';
import type { I2CAddress } from '@typecad/hal';
import type { ISPIArduino } from './spi-arduino';
import type { SPIMode, SPIBitOrder, SPISettings } from '@typecad/hal';
import type { ISerialArduino } from './uart-arduino';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0) - Arduino API
// ---------------------------------------------------------------------------

/** Arduino Uno I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). */
export const I2C0: II2CArduino = {
  busNumber: 0,
  isInitialized: false,

  begin(_address?: I2CAddress) { /* transpiler: Wire.begin(); or Wire.begin(addr); */ },
  beginTransmission(_address: I2CAddress) { /* transpiler: Wire.beginTransmission(addr); */ },
  write(_data: number | Uint8Array | string): number { return 0; },
  endTransmission(_stop?: boolean): number { return 0; },
  requestFrom(_address: I2CAddress, _quantity: number, _stop?: boolean): number { return 0; },
  available(): number { return 0; },
  read(): number { return -1; },
  setClock(_clock: number) { /* transpiler: Wire.setClock(hz); */ },
  onReceive(_handler: (howMany: number) => void) {},
  onRequest(_handler: () => void) {},
  end() { /* transpiler: Wire.end(); */ },
  recover(): boolean { return true; },
} as II2CArduino;

// ---------------------------------------------------------------------------
// SPI — SPI (bus 0) - Arduino API
// ---------------------------------------------------------------------------

/** Arduino Uno SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). */
export const SPI0: ISPIArduino = {
  isInitialized: false,

  begin() { /* transpiler: SPI.begin(); */ },
  end() { /* transpiler: SPI.end(); */ },
  beginTransaction(_settings: SPISettings) {
    /* transpiler: SPI.beginTransaction(SPISettings(freq, bitOrder, mode)); */
  },
  endTransaction() { /* transpiler: SPI.endTransaction(); */ },
  transfer(_data: number): number { return 0; },
  transferBuffer(_buffer: Uint8Array): Uint8Array { return new Uint8Array(0); },
  write(_data: number): void {},
  write16(_data: number): void {},
  setFrequency(_hz: number): void {},
  setMode(_mode: SPIMode): void {},
  setBitOrder(_order: SPIBitOrder): void {},
} as ISPIArduino;

// ---------------------------------------------------------------------------
// UART0 — UART 0 (USB / pins D0=RX, D1=TX) - Arduino API
// ---------------------------------------------------------------------------

/** Arduino Uno hardware serial (UART 0, pins D0/RX, D1/TX, + USB). */
export const UART0: ISerialArduino = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,

  begin(_baud: number) { /* transpiler: Serial.begin(baud); */ },
  end() { /* transpiler: Serial.end(); */ },
  available(): number { return 0; },
  peek(): number { return -1; },
  read(): number { return -1; },
  write(_data: number | Uint8Array | string): number { return 0; },
  flush() {},
  print(..._args: unknown[]) {},
  println(..._args: unknown[]) {},
  printf(_format: string, ..._args: unknown[]) {},
} as ISerialArduino;
