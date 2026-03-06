// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno/arduino — Arduino-compatible API implementations
//
// Import from '@typecode/board-arduino-uno/arduino' to use Arduino-style APIs:
// - I2C0.begin(), I2C0.beginTransmission(), I2C0.write(), etc.
// - SPI0.begin(), SPI0.transfer(), SPI0.setMode(), etc.
// - UART0.begin(), UART0.print(), UART0.read(), etc.
// ---------------------------------------------------------------------------

import type {
  II2CArduino,
  ISPIArduino,
  ISerialArduino,
  I2CAddress,
  SPIMode,
  SPIBitOrder,
  SPISettings,
} from '@typecode/core/arduino';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0) - Arduino API
// ---------------------------------------------------------------------------

/** Arduino Uno I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). */
export const I2C0: II2CArduino = {
  busNumber: 0,
  isInitialized: false,

  // --- Initialization ---
  begin(_address?: I2CAddress) { /* transpiler: Wire.begin(); or Wire.begin(addr); */ },
  
  // --- Transactional write API ---
  beginTransmission(_address: I2CAddress) { /* transpiler: Wire.beginTransmission(addr); */ },
  write(_data: number | Uint8Array | string): number { return 0; },
  endTransmission(_stop?: boolean): number { return 0; },

  // --- Read API ---
  requestFrom(_address: I2CAddress, _quantity: number, _stop?: boolean): number { return 0; },
  available(): number { return 0; },
  read(): number { return -1; },

  // --- Clock control ---
  setClock(_clock: number) { /* transpiler: Wire.setClock(hz); */ },

  // --- Slave mode callbacks ---
  onReceive(_handler: (howMany: number) => void) {},
  onRequest(_handler: () => void) {},

  // --- Cleanup ---
  end() { /* transpiler: Wire.end(); */ },

  // --- Bus recovery ---
  recover(): boolean { return true; },
} as II2CArduino;

// ---------------------------------------------------------------------------
// SPI — SPI (bus 0) - Arduino API
// ---------------------------------------------------------------------------

/** Arduino Uno SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). */
export const SPI0: ISPIArduino = {
  isInitialized: false,

  // --- Initialization ---
  begin() { /* transpiler: SPI.begin(); */ },
  end() { /* transpiler: SPI.end(); */ },

  // --- Transactions ---
  beginTransaction(_settings: SPISettings) { 
    /* transpiler: SPI.beginTransaction(SPISettings(freq, bitOrder, mode)); */ 
  },
  endTransaction() { /* transpiler: SPI.endTransaction(); */ },

  // --- Transfer ---
  transfer(_data: number): number { 
    /* transpiler: SPI.transfer(data) */
    return 0; 
  },
  transferBuffer(_buffer: Uint8Array): Uint8Array { 
    /* transpiler: SPI.transfer(buffer, len) */
    return new Uint8Array(0); 
  },

  // --- Write (transfer ignoring return) ---
  write(_data: number): void { 
    /* transpiler: SPI.transfer(data) - ignore return */ 
  },
  write16(_data: number): void { 
    /* transpiler: SPI.transfer16(data) */ 
  },

  // --- Configuration ---
  setFrequency(_hz: number): void { 
    /* transpiler: SPI.setClockDivider(calcDivider(hz)) */ 
  },
  setMode(_mode: SPIMode): void { 
    /* transpiler: SPI.setDataMode(mode) */ 
  },
  setBitOrder(_order: SPIBitOrder): void { 
    /* transpiler: SPI.setBitOrder(order) */ 
  },
} as ISPIArduino;

// ---------------------------------------------------------------------------
// UART0 — UART 0 (USB / pins D0=RX, D1=TX) - Arduino API
// ---------------------------------------------------------------------------

/** Arduino Uno hardware serial (UART 0, pins D0/RX, D1/TX, + USB). */
export const UART0: ISerialArduino = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,

  // --- Initialization ---
  begin(_baud: number) { /* transpiler: Serial.begin(baud); */ },
  end() { /* transpiler: Serial.end(); */ },

  // --- Read API ---
  available(): number { return 0; },
  peek(): number { return -1; },
  read(): number { return -1; },
  write(_data: number | Uint8Array | string): number { return 0; },

  // --- Buffer control ---
  flush() {},

  // --- Print helpers ---
  print(..._args: unknown[]) {},
  println(..._args: unknown[]) {},
  printf(_format: string, ..._args: unknown[]) {},
} as ISerialArduino;