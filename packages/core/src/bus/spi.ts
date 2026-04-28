// ---------------------------------------------------------------------------
// @typehal/core - SPI Bus Interfaces
//
// Modern API: SPI0.enable(), SPI0.device(CS).transfer(data)
// CS is managed automatically by .device().
// ---------------------------------------------------------------------------

import type { BasePin } from '../types/pin';
import type { ErrorPolicy } from './error-policy';

/**
 * SPI mode (combination of CPOL and CPHA)
 * - Mode 0: CPOL=0, CPHA=0 (most common)
 * - Mode 1: CPOL=0, CPHA=1
 * - Mode 2: CPOL=1, CPHA=0
 * - Mode 3: CPOL=1, CPHA=1
 */
export type SPIMode = 0 | 1 | 2 | 3;

/**
 * Bit transmission order
 */
export type SPIBitOrder = 'msb' | 'lsb';

/**
 * SPI status codes
 */
export enum SPIStatus {
  SUCCESS = 0,
  NOT_INITIALIZED = 1,
  TRANSFER_FAILED = 2,
  INVALID_CONFIG = 3,
  TIMEOUT = 4,
  DEVICE_ERROR = 5,
}

/**
 * How the bus handles errors at runtime.
 * - 'throw': Assert-style — throws on error (good for development)
 * - 'callback': Calls registered onError handlers
 * - 'silent': Returns status codes only (good for production)
 */
export type { ErrorPolicy } from './error-policy';

/**
 * SPI settings for transaction
 */
export interface SPISettings {
  frequency: number;
  mode: SPIMode;
  bitOrder: SPIBitOrder;
}

// ---------------------------------------------------------------------------
// SPI Device abstraction
// ---------------------------------------------------------------------------

/**
 * SPI device handle. CS is asserted before each operation and deasserted after.
 * Use SPI0.device(CS) to create — do not manage CS manually when using this.
 */
export interface ISPIDevice {
  readonly chipSelect: BasePin;
  /** Transfer data (full-duplex) and return received bytes. CS asserted automatically. */
  transfer(data: number | Uint8Array): Uint8Array;
  /** Write data (ignore received bytes). CS asserted automatically. */
  write(data: number | Uint8Array): void;
  /** Read count bytes (send dummy 0xFF). CS asserted automatically. */
  read(count: number): Uint8Array;
  /** Write data to a register. CS asserted automatically. */
  writeRegister(register: number, data: number | Uint8Array): void;
  /** Read count bytes from a register. CS asserted automatically. */
  readRegister(register: number, count: number): Uint8Array;
}

// ---------------------------------------------------------------------------
// SPI Bus Interface — split by initialization state
// ---------------------------------------------------------------------------

/**
 * Uninitialized SPI bus — available before .begin() is called.
 * Only allows initialization methods. Device operations (.device())
 * are not available until the bus is initialized.
 */
export interface IUninitializedSPIBus {
  readonly isEnabled: false;

  // --- Initialization ---
  /** Initialize the SPI bus. Returns initialized bus. */
  begin(): ISPIBus;

  // --- Ownership (opt-in, for multi-threaded contention) ---
  /**
   * Acquire exclusive ownership of the SPI bus.
   * Returns `undefined` if the bus is already owned by another task.
   *
   * This is opt-in — use `begin()` for single-threaded scenarios.
   * On single-threaded AVR, this is a boolean flag check.
   * On ESP32/FreeRTOS, this acquires a mutex.
   */
  take(): IOwnedSPIBus | undefined;
}

/**
 * SPI bus interface.
 */
export interface ISPIBus {
  readonly isEnabled: boolean;

  // --- Initialization ---
  /** Re-initialize the SPI bus (no-op if already initialized). */
  begin(): void;
  /** Disable the SPI bus. Returns uninitialized bus. */
  end(): IUninitializedSPIBus;

  // --- Configuration ---
  /** Set SPI mode (0-3). */
  setMode(mode: SPIMode): void;
  /** Set bit transmission order. */
  setBitOrder(order: SPIBitOrder): void;
  /** Set clock frequency in Hz. */
  setFrequency(hz: number): void;

  // --- Transactions ---
  /** Begin a transaction with the given settings. */
  beginTransaction(settings: SPISettings): void;
  /** End the current transaction. */
  endTransaction(): void;

  // --- Device accessor (automatic CS) ---
  /** Get a device handle for the given chip-select pin alias from the board package. CS is managed automatically. */
  device(chipSelect: BasePin): ISPIDevice;

  // --- Error handling ---
  /** Register a global error handler for all operations. */
  onError(handler: (status: SPIStatus, operation: 'transfer' | 'read' | 'write') => void): void;

  // --- Error policy ---
  /**
   * How errors are handled on this bus.
   * - 'throw': Assert-style — throws on error (good for development)
   * - 'callback': Calls registered onError handlers
   * - 'silent': Returns status codes only (good for production)
   * @default 'callback'
   */
  errorPolicy: ErrorPolicy;
}

// ---------------------------------------------------------------------------
// Owned SPI Bus — exclusive access via take()
// ---------------------------------------------------------------------------

/**
 * Owned SPI bus — obtained via `SPI0.take()`, released via `release()`.
 * Extends ISPIBus with ownership semantics for multi-threaded contention.
 */
export interface IOwnedSPIBus extends ISPIBus {
  /** Release exclusive ownership back to the free bus. */
  release(): void;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

export function spiModeToCpolCpha(mode: SPIMode): { cpol: 0 | 1; cpha: 0 | 1 } {
  switch (mode) {
    case 0: return { cpol: 0, cpha: 0 };
    case 1: return { cpol: 0, cpha: 1 };
    case 2: return { cpol: 1, cpha: 0 };
    case 3: return { cpol: 1, cpha: 1 };
  }
}

export function cpolCphaToSpiMode(cpol: 0 | 1, cpha: 0 | 1): SPIMode {
  return (cpol * 2 + cpha) as SPIMode;
}
