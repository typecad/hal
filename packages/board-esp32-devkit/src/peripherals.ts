// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Peripheral instances
//
// Wire (I2C), VSPI, Serial (UART0), and Serial2 (UART2) peripheral stubs.
// The transpiler maps method calls to the corresponding Arduino-ESP32
// library calls.
// ---------------------------------------------------------------------------

import type { II2CBus, I2CConfig, I2CAddress } from '@typecode/core';
import { I2CSpeed } from '@typecode/core';
import type { ISPIBus, SPIConfig, SPITransferOptions } from '@typecode/core';
import { SPIMode, SPIBitOrder } from '@typecode/core';
import type { ISerialPort, UARTConfig, UARTStatus } from '@typecode/core';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0, default pins SDA=GPIO21 / SCL=GPIO22)
// ---------------------------------------------------------------------------

/** ESP32 I2C bus 0 (Wire library, default pins GPIO21=SDA / GPIO22=SCL). */
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
// SPI — VSPI (bus 0, default pins MOSI=GPIO23, MISO=GPIO19, SCK=GPIO18, CS=GPIO5)
// ---------------------------------------------------------------------------

/** ESP32 VSPI bus (SPI class, default pins GPIO23=MOSI, GPIO19=MISO, GPIO18=SCK, GPIO5=CS). */
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
// Serial — UART0 (USB / pins GPIO1=TX, GPIO3=RX)
// ---------------------------------------------------------------------------

function makeSerialPort(uartNum: number): number {
  return uartNum;
}

function _makeSerialPortSpec(uartNum: number): ISerialPort {
  return {
    uartNumber: uartNum,
    baudRate: 115200,
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

    print(..._args: unknown[]) {},
    println(..._args: unknown[]) {},
    printf(_format: string, ..._args: unknown[]) {},
    isConnected(): boolean { return false; },
    waitForConnection(_timeout?: number): Promise<void> { return Promise.resolve(); },
  } as ISerialPort;
}

/**
 * ESP32 hardware serial UART0 (USB-UART bridge, pins GPIO1=TX / GPIO3=RX).
 * Default baud rate 115200 — typical for ESP32 sketches.
 * The transpiler maps calls on this symbol to Arduino's built-in `Serial` object.
 */
export const Serial  = makeSerialPort(0)  as unknown as ISerialPort;

/**
 * ESP32 hardware serial UART2 (pins GPIO17=TX / GPIO16=RX).
 * Useful for external peripherals without occupying the USB serial.
 * The transpiler maps calls on this symbol to Arduino's built-in `Serial2` object.
 */
export const Serial2 = makeSerialPort(2)  as unknown as ISerialPort;
