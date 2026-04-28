// ---------------------------------------------------------------------------
// @typehal/core — I2C Arduino-compatible API interface
//
// This interface provides Arduino Wire-compatible methods for I2C communication.
// Import from '@typehal/core/arduino' or '@typehal/board-arduino-uno/arduino'
// to use this API style.
// ---------------------------------------------------------------------------

import type { I2CAddress, I2CStatus } from './i2c';

// ---------------------------------------------------------------------------
// Arduino Wire-compatible Interface
// ---------------------------------------------------------------------------

/**
 * Arduino Wire-compatible I2C bus interface.
 * 
 * Usage:
 * ```typescript
 * import { I2C0 } from '@typehal/board-arduino-uno/arduino';
 * 
 * I2C0.begin();
 * I2C0.setClock(400000);
 * I2C0.beginTransmission(0x76);
 * I2C0.write(0xFA);
 * const status = I2C0.endTransmission();
 * const bytesAvailable = I2C0.requestFrom(0x76, 2);
 * const data = I2C0.read();
 * ```
 */
export interface II2CArduino {
  readonly busNumber: number;
  readonly isInitialized: boolean;

  // --- Initialization ---
  /** Initialize as I2C master. */
  begin(): void;
  /** Initialize as I2C slave with given address. */
  begin(address: I2CAddress): void;

  // --- Transactional write API ---
  /** Begin a transmission to the given address. */
  beginTransmission(address: I2CAddress): void;
  /** Write data to the transmission buffer. Returns number of bytes written. */
  write(data: number | Uint8Array | string): number;
  /** End the transmission and send data. Returns I2CStatus. */
  endTransmission(stop?: boolean): number;

  // --- Read API ---
  /** Request bytes from a slave. Returns number of bytes available. */
  requestFrom(address: I2CAddress, quantity: number, stop?: boolean): number;
  /** Number of bytes available to read. */
  available(): number;
  /** Read a single byte from the buffer. Returns -1 if no data available. */
  read(): number;

  // --- Clock control ---
  /** Set the I2C clock frequency in Hz. */
  setClock(clock: number): void;

  // --- Slave mode callbacks ---
  /** Register a callback for when data is received as slave. */
  onReceive(handler: (howMany: number) => void): void;
  /** Register a callback for when data is requested from slave. */
  onRequest(handler: () => void): void;

  // --- Cleanup ---
  /** Disable the Wire peripheral. */
  end(): void;

  // --- Bus recovery ---
  /** Attempt to recover a stuck bus (toggles SCL to release stuck slaves). */
  recover(): boolean;
}
