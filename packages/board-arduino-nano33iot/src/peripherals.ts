// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Peripheral instances
//
// Stub objects for the Arduino NANO 33 IoT's built-in buses.
// These carry full type information at design-time; the transpiler replaces
// method calls with the appropriate Arduino library calls (Wire, SPI, Serial).
// ---------------------------------------------------------------------------

import type { II2CBus, I2CConfig, I2CAddress } from '@typecode/core';
import { I2CSpeed } from '@typecode/core';
import type { ISPIBus, SPIConfig, SPITransferOptions } from '@typecode/core';
import { SPIMode, SPIBitOrder } from '@typecode/core';
import type { ISerialPort, UARTConfig, UARTStatus } from '@typecode/core';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0, pins A4=SDA / A5=SCL)
// ---------------------------------------------------------------------------

/** Arduino NANO 33 IoT I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). */
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
// SPI — SPI (bus 0, pins D11=MOSI / D12=MISO / D13=SCK / D10=SS)
// ---------------------------------------------------------------------------

/** Arduino NANO 33 IoT SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). */
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
// Serial — UART 0 (USB-CDC / pins D0=RX, D1=TX)
// ---------------------------------------------------------------------------

/**
 * Arduino NANO 33 IoT hardware serial (UART 0).
 * On the NANO 33 IoT the USB port is a native USB-CDC device; "Serial"
 * in Arduino sketches refers to SerialUSB which transparently wraps it.
 *
 * `makeSerialPort` must return `number` so the transpiler emits `int` in C++.
 * The `as unknown as ISerialPort` cast provides type info without affecting
 * code generation.
 */
function makeSerialPort(uartNum: number): number { return uartNum; }

/** USB-CDC serial (SerialUSB / UART 0). */
export const Serial = makeSerialPort(0) as unknown as ISerialPort;
