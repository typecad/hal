// ---------------------------------------------------------------------------
// @typehal/framework-arduino — SPI Arduino-compatible API interface
//
// Arduino SPI-compatible methods for SPI communication.
// ---------------------------------------------------------------------------

import type { SPIMode, SPIBitOrder, SPISettings } from '@typehal/core';

// ---------------------------------------------------------------------------
// Arduino SPI-compatible Interface
// ---------------------------------------------------------------------------

/**
 * Arduino SPI-compatible bus interface.
 *
 * Usage:
 * ```typescript
 * import { SPI0 } from '@typehal/framework-arduino/arduino';
 *
 * SPI0.begin();
 * SPI0.setMode(0);
 * SPI0.setBitOrder('msb');
 * SPI0.setFrequency(1_000_000);
 *
 * const response = SPI0.transfer(0xAA);
 * SPI0.transferBuffer(buffer);
 * ```
 */
export interface ISPIArduino {
  readonly isInitialized: boolean;

  // --- Initialization ---
  /** Initialize the SPI bus. */
  begin(): void;
  /** Disable the SPI bus. */
  end(): void;

  // --- Transactions ---
  /** Begin a transaction with specific settings. */
  beginTransaction(settings: SPISettings): void;
  /** End the current transaction. */
  endTransaction(): void;

  // --- Transfer ---
  /** Transfer a single byte (full-duplex). Returns received byte. */
  transfer(data: number): number;
  /** Transfer a buffer (full-duplex). Returns received bytes. */
  transferBuffer(buffer: Uint8Array): Uint8Array;

  // --- Write (transfer ignoring return) ---
  /** Write a single byte. */
  write(data: number): void;
  /** Write a 16-bit value. */
  write16(data: number): void;

  // --- Configuration ---
  /** Set clock frequency in Hz. */
  setFrequency(hz: number): void;
  /** Set SPI mode (0-3). */
  setMode(mode: SPIMode): void;
  /** Set bit order. */
  setBitOrder(order: SPIBitOrder): void;
}
