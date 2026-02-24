// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Peripheral instances
//
// Stub objects representing the Arduino Uno's built-in peripheral buses.
// These carry full type information at design-time so TypeScript prevents
// invalid usage.  The transpiler replaces method calls with the
// architecture-specific C++ (Wire, SPI, Serial libraries).
// ---------------------------------------------------------------------------

import type { II2CBus, I2CConfig, I2CAddress } from '../core/bus/i2c';
import { I2CSpeed } from '../core/bus/i2c';
import type { ISPIBus, SPIConfig, SPITransferOptions } from '../core/bus/spi';
import { SPIMode, SPIBitOrder } from '../core/bus/spi';
import type { ISerialPort, UARTConfig, UARTStatus } from '../core/bus/uart';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0)
// ---------------------------------------------------------------------------

/** Arduino Uno I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). */
export const I2C0: II2CBus = {
  busNumber: 0,
  speed: I2CSpeed.STANDARD,
  isInitialized: false,

  initialize(_config?: I2CConfig) { /* transpiler: Wire.begin(); */ },
  deinitialize() { /* transpiler: Wire.end(); */ },

  scan(): I2CAddress[] { return []; },
  ping(_address: I2CAddress): boolean { return false; },

  write(_address: I2CAddress, _data: Uint8Array) {},
  read(_address: I2CAddress, _length: number): Uint8Array { return new Uint8Array(0); },
  writeThenRead(_address: I2CAddress, _writeData: Uint8Array, _readLength: number): Uint8Array {
    return new Uint8Array(0);
  },

  readRegister(_address: I2CAddress, _register: number, _buffer: Uint8Array): number { return 0; },
  writeRegister(_address: I2CAddress, _register: number, _data: Uint8Array) {},
  readByte(_address: I2CAddress, _register: number): number { return 0; },
  writeByte(_address: I2CAddress, _register: number, _value: number) {},
  readWord(_address: I2CAddress, _register: number, _littleEndian?: boolean): number { return 0; },
  writeWord(_address: I2CAddress, _register: number, _value: number, _littleEndian?: boolean) {},

  setSpeed(_speed: I2CSpeed | number) {},
  getSpeed(): I2CSpeed | number { return I2CSpeed.STANDARD; },
} as II2CBus;

// ---------------------------------------------------------------------------
// SPI — SPI (bus 0)
// ---------------------------------------------------------------------------

/** Arduino Uno SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). */
export const SPI0: ISPIBus = {
  busNumber: 0,
  frequency: 4_000_000,
  mode: SPIMode.MODE_0,
  isInitialized: false,

  initialize(_config?: SPIConfig) { /* transpiler: SPI.begin(); */ },
  deinitialize() { /* transpiler: SPI.end(); */ },

  transfer(_txData: Uint8Array, _options?: SPITransferOptions): Uint8Array {
    return new Uint8Array(0);
  },
  write(_data: Uint8Array, _options?: SPITransferOptions) {},
  read(_length: number, _options?: SPITransferOptions): Uint8Array {
    return new Uint8Array(0);
  },

  writeRegister(_csPin: number, _register: number, _data: Uint8Array) {},
  readRegister(_csPin: number, _register: number, _length: number): Uint8Array {
    return new Uint8Array(0);
  },

  setFrequency(_hz: number) {},
  setMode(_mode: SPIMode) {},
  setBitOrder(_order: SPIBitOrder) {},
} as ISPIBus;

// ---------------------------------------------------------------------------
// Serial — UART 0 (USB / pins D0=RX, D1=TX)
// ---------------------------------------------------------------------------

/** Arduino Uno hardware serial (UART 0, pins D0/RX, D1/TX, + USB). */
export const Serial: ISerialPort = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,

  initialize(_config?: UARTConfig) { /* transpiler: Serial.begin(baud); */ },
  deinitialize() { /* transpiler: Serial.end(); */ },

  write(_data: Uint8Array): number { return 0; },
  writeString(_text: string): number { return 0; },
  writeLine(_text: string): number { return 0; },

  read(_length?: number): Uint8Array { return new Uint8Array(0); },
  readString(_length?: number): string { return ''; },
  readLine(_timeout?: number): string { return ''; },
  readUntil(_delimiter: number, _timeout?: number): Uint8Array { return new Uint8Array(0); },
  peek(): number { return -1; },

  available(): number { return 0; },
  availableForWrite(): number { return 0; },
  flush() {},
  clearRxBuffer() {},
  clearTxBuffer() {},

  getStatus(): UARTStatus {
    return {
      available: 0,
      writeAvailable: 0,
      overrunError: false,
      parityError: false,
      framingError: false,
      breakDetected: false,
    };
  },
  clearErrors() {},
  setBaudRate(_baud: number) {},

  onReceive(_callback: (data: Uint8Array) => void) {},
  onTransmitComplete(_callback: () => void) {},
  onError(_callback: (error: Error) => void) {},

  // ISerialPort print helpers
  print(..._args: unknown[]) {},
  println(..._args: unknown[]) {},
  printf(_format: string, ..._args: unknown[]) {},
  isConnected(): boolean { return false; },
  waitForConnection(_timeout?: number): Promise<void> { return Promise.resolve(); },
} as ISerialPort;
