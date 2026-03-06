// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Peripheral instances (Fluent API only)
//
// Stub objects representing the Arduino Uno's built-in peripheral buses.
// These carry full type information at design-time so TypeScript prevents
// invalid usage.  The transpiler replaces method calls with the
// architecture-specific C++ (Wire, SPI, Serial libraries).
//
// For Arduino-compatible API, import from '@typecode/board-arduino-uno/arduino'
//
// NOTE: Arduino Uno only has ONE of each peripheral:
//   - I2C0 (Wire) on pins A4/A5
//   - SPI0 (SPI) on pins D11/D12/D13
//   - UART0 (Serial) on pins D0/D1 + USB
//
// Using I2C1, I2C2, SPI1, UART1, etc. will result in a transpile error.
// ---------------------------------------------------------------------------

import type {
  II2CBus,
  II2CConfigBuilder,
  II2CDeviceAccessor,
  II2CReadSource,
  II2CWriteTarget,
  II2CReadResult,
  II2CWriteResult,
  I2CAddress,
  I2CStatus,
} from '@typecode/core';
import type { IPin } from '@typecode/core';
import type {
  ISPIBus,
  ISPIFluentConfig,
  ISPIFluentDevice,
  ISPIFluentWrite,
  ISPIFluentRead,
  ISPIFluentTransfer,
  ISPIWriteResult,
  ISPIReadResult,
  ISPITransferResult,
  IDigitalPin,
} from '@typecode/core';
import { SPIMode, SPIBitOrder, SPIStatus } from '@typecode/core';
import type {
  ISerialPort,
  UARTStatusInfo,
  IUARTFluentConfig,
  IUARTFluentRead,
  IUARTFluentWrite,
  IUARTReadResult,
  IUARTWriteResult,
} from '@typecode/core';
import { UARTStatus, UARTParity, UARTStopBits, UARTFlowControl } from '@typecode/core';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0) - Fluent API only
// ---------------------------------------------------------------------------

// Stub result objects for fluent API
const stubReadResult: II2CReadResult = {
  ok: true,
  status: 0,
  value: new Uint8Array(0),
  bytesRead: 0,
  onSuccess(handler) { return this; },
  onError(handler) { return this; },
  asUint8() { return 0; },
  asUint16() { return 0; },
  asInt16() { return 0; },
  asUint32() { return 0; },
  asInt32() { return 0; },
};

const stubWriteResult: II2CWriteResult = {
  ok: true,
  status: 0,
  value: undefined as void,
  success: true,
  onSuccess(handler) { return this; },
  onError(handler) { return this; },
};

/** Arduino Uno I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). */
export const I2C0: II2CBus = {
  busNumber: 0,
  isInitialized: false,

  // --- Fluent Configuration API ---
  config: {
    sda(_pin: IPin) { return this; },
    scl(_pin: IPin) { return this; },
    speed(_hz: number) { return this; },
    begin() { /* transpiler: Wire.begin(); */ },
  } as II2CConfigBuilder,

  // --- Fluent Device Operations ---
  device(address: I2CAddress): II2CDeviceAccessor {
    const readBuilder: II2CReadSource = {
      from(_register: number): II2CReadResult {
        return stubReadResult;
      },
    };
    
    const writeTarget: II2CWriteTarget = {
      to(_register: number): II2CWriteResult {
        return stubWriteResult;
      },
    };
    
    return {
      address,
      read(_count: number) { return readBuilder; },
      write(_data: number | number[] | Uint8Array) { return writeTarget; },
    } as II2CDeviceAccessor;
  },

  // --- Error handling ---
  onError(_handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void) {},

  // --- Bus recovery ---
  recover(): boolean { return true; },
} as II2CBus;

// ---------------------------------------------------------------------------
// SPI — SPI (bus 0) - Fluent API only
// ---------------------------------------------------------------------------

// Stub result objects for fluent SPI API
const stubSPIWriteResult: ISPIWriteResult = {
  ok: true,
  status: SPIStatus.SUCCESS,
  bytesWritten: 0,
};

const stubSPIReadResult: ISPIReadResult = {
  ok: true,
  status: SPIStatus.SUCCESS,
  bytes: new Uint8Array(0),
  asUint8() { return 0; },
  asUint16(_endian) { return 0; },
  asInt8() { return 0; },
  asInt16(_endian) { return 0; },
};

const stubSPITransferResult: ISPITransferResult = {
  ok: true,
  status: SPIStatus.SUCCESS,
  bytes: new Uint8Array(0),
  asUint8() { return 0; },
  asUint16(_endian) { return 0; },
};

// Fluent config builder
const spiConfigBuilder: ISPIFluentConfig = {
  frequency(_hz: number) { return this; },
  mode(_mode: SPIMode) { return this; },
  bitOrder(_order: SPIBitOrder) { return this; },
  cpol(_level: 0 | 1) { return this; },
  cpha(_level: 0 | 1) { return this; },
  begin() { /* transpiler: SPI.begin(); */ },
};

// Fluent device factory
function createSPIDeviceAccessor(_csPin: IDigitalPin): ISPIFluentDevice {
  const writeBuilder: ISPIFluentWrite = {
    to(_register: number): ISPIWriteResult {
      // transpiler: digitalWrite(csPin, LOW); SPI.transfer(register); SPI.transfer(data); digitalWrite(csPin, HIGH);
      return stubSPIWriteResult;
    },
  };

  const readBuilder: ISPIFluentRead = {
    from(_register: number): ISPIReadResult {
      // transpiler: digitalWrite(csPin, LOW); SPI.transfer(register | 0x80); ...read bytes...; digitalWrite(csPin, HIGH);
      return stubSPIReadResult;
    },
  };

  const transferBuilder: ISPIFluentTransfer = {
    execute(): ISPITransferResult {
      // transpiler: digitalWrite(csPin, LOW); ...transfer...; digitalWrite(csPin, HIGH);
      return stubSPITransferResult;
    },
  };

  return {
    write(_data: number | Uint8Array) { return writeBuilder; },
    read(_count: number) { return readBuilder; },
    transfer(_data: number | Uint8Array) { return transferBuilder; },
  };
}

/** Arduino Uno SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). */
export const SPI0: ISPIBus = {
  isInitialized: false,

  // --- Fluent API ---
  config: spiConfigBuilder,
  device(chipSelect: IDigitalPin): ISPIFluentDevice {
    return createSPIDeviceAccessor(chipSelect);
  },
} as ISPIBus;

// ---------------------------------------------------------------------------
// Serial — UART 0 (USB / pins D0=RX, D1=TX) - Fluent API only
// ---------------------------------------------------------------------------

// Stub UART result objects
const stubUARTReadResult: IUARTReadResult = {
  ok: true,
  status: UARTStatus.SUCCESS,
  bytes: new Uint8Array(0),
  bytesRead: 0,
  timedOut: false,
  asString() { return ''; },
  asStringTrim() { return ''; },
  asInt() { return 0; },
  asFloat() { return 0; },
  asUint8() { return 0; },
  asInt8() { return 0; },
  asUint16(_endian) { return 0; },
  asInt16(_endian) { return 0; },
  asUint32(_endian) { return 0; },
  asInt32(_endian) { return 0; },
};

const stubUARTWriteResult: IUARTWriteResult = {
  ok: true,
  status: UARTStatus.SUCCESS,
  bytesWritten: 0,
};

// Fluent UART config builder
const uartConfigBuilder: IUARTFluentConfig = {
  baudRate(_bps: number) { return this; },
  dataBits(_bits: 5 | 6 | 7 | 8) { return this; },
  parity(_parity: UARTParity) { return this; },
  stopBits(_bits: UARTStopBits) { return this; },
  flowControl(_mode: UARTFlowControl) { return this; },
  tx(_pin: IPin) { return this; },
  rx(_pin: IPin) { return this; },
  rts(_pin: IPin) { return this; },
  cts(_pin: IPin) { return this; },
  rxBufferSize(_size: number) { return this; },
  txBufferSize(_size: number) { return this; },
  inverted(_invert: boolean) { return this; },
  defaultTimeout(_ms: number) { return this; },
  begin() { /* transpiler: Serial.begin(baud); */ },
} as IUARTFluentConfig;

// Fluent read builder
const uartFluentRead: IUARTFluentRead = Object.assign(
  function(): number { 
    /* transpiler: Serial.read() */
    return -1; 
  },
  {
    line(_timeout?: number): IUARTReadResult {
      return stubUARTReadResult;
    },
    until(_delimiter: number | string, _timeout?: number): IUARTReadResult {
      return stubUARTReadResult;
    },
    untilEnter(_timeout?: number): IUARTReadResult {
      return stubUARTReadResult;
    },
    untilSpace(_timeout?: number): IUARTReadResult {
      return stubUARTReadResult;
    },
    untilTab(_timeout?: number): IUARTReadResult {
      return stubUARTReadResult;
    },
    bytes(_count: number, _timeout?: number): IUARTReadResult {
      return stubUARTReadResult;
    },
    all(): IUARTReadResult {
      return stubUARTReadResult;
    },
    byte(): IUARTReadResult {
      return stubUARTReadResult;
    },
    char(): IUARTReadResult {
      return stubUARTReadResult;
    },
  }
) as IUARTFluentRead;

// Fluent write builder
const uartFluentWrite: IUARTFluentWrite = Object.assign(
  function(_data: number | Uint8Array | string): number { 
    /* transpiler: Serial.write(data) */
    return 0; 
  },
  {
    line(_text: string): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    ln(_text: string): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    char(_c: number | string): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    string(_text: string): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    bytes(_data: Uint8Array | number[]): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    format(_fmt: string, ..._args: unknown[]): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    formatln(_fmt: string, ..._args: unknown[]): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    byte(_value: number): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    uint16(_value: number, _endian: 'be' | 'le'): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    int16(_value: number, _endian: 'be' | 'le'): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    uint32(_value: number, _endian: 'be' | 'le'): IUARTWriteResult {
      return stubUARTWriteResult;
    },
    int32(_value: number, _endian: 'be' | 'le'): IUARTWriteResult {
      return stubUARTWriteResult;
    },
  }
) as IUARTFluentWrite;

/** Arduino Uno hardware serial (UART 0, pins D0/RX, D1/TX, + USB). */
export const UART0: ISerialPort = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,

  // --- Fluent Configuration API ---
  config: uartConfigBuilder,
  
  // --- Fluent Read/Write Operations ---
  read: uartFluentRead,
  write: uartFluentWrite,

  // --- Status ---
  getStatus(): UARTStatusInfo {
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

  // --- Callbacks ---
  onReceive(_callback: (bytesAvailable: number) => void) {},
  onTransmitComplete(_callback: () => void) {},
  onError(_callback: (error: Error) => void) {},

  // ISerialPort print helpers (fluent style)
  print(..._args: unknown[]) {},
  println(..._args: unknown[]) {},
  printf(_format: string, ..._args: unknown[]) {},
  isConnected(): boolean { return false; },
  waitForConnection(_timeout?: number): Promise<void> { return Promise.resolve(); },
} as ISerialPort;