// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit/arduino — Arduino-compatible API implementations
//
// Import from '@typehal/board-esp32-devkit/arduino' to use Arduino-style APIs:
// - I2C0.begin(), I2C1.begin(), etc.
// - SPI0.begin(), SPI1.begin(), etc.
// - UART0.begin(), UART2.begin(), etc.
// ---------------------------------------------------------------------------

import type {
  II2CArduino,
  ISPIArduino,
  ISerialArduino,
  I2CAddress,
  SPIMode,
  SPIBitOrder,
  SPISettings,
} from '@typehal/core/arduino';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0) - Arduino API
// ---------------------------------------------------------------------------

/** ESP32 I2C bus 0 (Wire library, pins D21=SDA / D22=SCL). */
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

/** ESP32 I2C bus 1 (Wire1, no fixed pins — remap via Wire1.begin(SDA, SCL)). */
export const I2C1: II2CArduino = {
  busNumber: 1,
  isInitialized: false,

  begin(_address?: I2CAddress) { /* transpiler: Wire1.begin(SDA, SCL); */ },
  beginTransmission(_address: I2CAddress) { /* transpiler: Wire1.beginTransmission(addr); */ },
  write(_data: number | Uint8Array | string): number { return 0; },
  endTransmission(_stop?: boolean): number { return 0; },
  requestFrom(_address: I2CAddress, _quantity: number, _stop?: boolean): number { return 0; },
  available(): number { return 0; },
  read(): number { return -1; },
  setClock(_clock: number) { /* transpiler: Wire1.setClock(hz); */ },
  onReceive(_handler: (howMany: number) => void) {},
  onRequest(_handler: () => void) {},
  end() { /* transpiler: Wire1.end(); */ },
  recover(): boolean { return true; },
} as II2CArduino;

// ---------------------------------------------------------------------------
// SPI — HSPI (bus 0) - Arduino API
// ---------------------------------------------------------------------------

/** ESP32 SPI bus 0 / HSPI (pins D13=MOSI, D12=MISO, D14=SCK, D15=CS). */
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

/** ESP32 SPI bus 1 / VSPI (pins D23=MOSI, D19=MISO, D18=SCK, D5=CS). */
export const SPI1: ISPIArduino = {
  isInitialized: false,

  begin() { /* transpiler: SPI.begin(18, 19, 23, 5); */ },
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
// UART0 — Serial (USB / pins D1=TX, D3=RX) - Arduino API
// ---------------------------------------------------------------------------

/** ESP32 hardware serial 0 / UART0 (pins D1=TX, D3=RX + USB-CDC). */
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

// ---------------------------------------------------------------------------
// UART2 — Serial2 (pins D17=TX, D16=RX) - Arduino API
// ---------------------------------------------------------------------------

/** ESP32 hardware serial 2 / UART2 (pins D17=TX, D16=RX). */
export const UART2: ISerialArduino = {
  uartNumber: 2,
  baudRate: 9600,
  isInitialized: false,

  begin(_baud: number) { /* transpiler: Serial2.begin(baud, SERIAL_8N1, 16, 17); */ },
  end() { /* transpiler: Serial2.end(); */ },
  available(): number { return 0; },
  peek(): number { return -1; },
  read(): number { return -1; },
  write(_data: number | Uint8Array | string): number { return 0; },
  flush() {},
  print(..._args: unknown[]) {},
  println(..._args: unknown[]) {},
  printf(_format: string, ..._args: unknown[]) {},
} as ISerialArduino;
