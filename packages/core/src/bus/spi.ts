// ---------------------------------------------------------------------------
// @typecode/core - SPI Bus Interfaces
//
// Provides TypeScript interfaces for SPI communication.
// Two API styles:
//   1. Arduino-compatible (SPI.begin, SPI.transfer, etc.)
//   2. Fluent chainable (SPI0.config.frequency().mode().begin())
// ---------------------------------------------------------------------------

import type { IDigitalPin } from '../types/pin';

/**
 * SPI clock polarity (CPOL) options
 */
export type SPIClockPolarity = 0 | 1;

/**
 * SPI clock phase (CPHA) options
 */
export type SPIClockPhase = 0 | 1;

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
 * SPI settings for transaction
 */
export interface SPISettings {
  frequency: number;
  mode: SPIMode;
  bitOrder: SPIBitOrder;
}

/**
 * Transfer options
 */
export interface SPITransferOptions {
  csPin?: IDigitalPin;
  csActiveLow?: boolean;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/**
 * Result of a SPI write operation
 */
export interface ISPIWriteResult {
  ok: boolean;
  status: SPIStatus;
  bytesWritten: number;
  /** Returns bytesWritten if ok, otherwise prints error to Serial and returns 0. */
  unwrap(): number;
  /** Returns bytesWritten if ok, otherwise returns the provided default. */
  unwrapOr(defaultValue: number): number;
}

/**
 * Result of a SPI read operation
 */
export interface ISPIReadResult {
  ok: boolean;
  status: SPIStatus;
  bytes: Uint8Array;
  asUint8(): number;
  asUint16(endian: 'be' | 'le'): number;
  asInt8(): number;
  asInt16(endian: 'be' | 'le'): number;
  /** Returns bytes if ok, otherwise prints error to Serial and returns empty array. */
  unwrap(): Uint8Array;
  /** Returns bytes if ok, otherwise returns the provided default. */
  unwrapOr(defaultValue: Uint8Array): Uint8Array;
}

/**
 * Result of a SPI transfer operation
 */
export interface ISPITransferResult {
  ok: boolean;
  status: SPIStatus;
  bytes: Uint8Array;
  asUint8(): number;
  asUint16(endian: 'be' | 'le'): number;
  /** Returns bytes if ok, otherwise prints error to Serial and returns empty array. */
  unwrap(): Uint8Array;
  /** Returns bytes if ok, otherwise returns the provided default. */
  unwrapOr(defaultValue: Uint8Array): Uint8Array;
}

// ---------------------------------------------------------------------------
// Fluent API Interfaces
// ---------------------------------------------------------------------------

/**
 * Fluent SPI configuration builder
 */
export interface ISPIFluentConfig {
  frequency(hz: number): this;
  mode(mode: SPIMode): this;
  bitOrder(order: SPIBitOrder): this;
  cpol(level: SPIClockPolarity): this;
  cpha(level: SPIClockPhase): this;
  begin(): void;
}

/**
 * Fluent write operation builder
 */
export interface ISPIFluentWrite {
  to(register: number): ISPIWriteResult;
}

/**
 * Fluent read operation builder
 */
export interface ISPIFluentRead {
  from(register: number): ISPIReadResult;
}

/**
 * Fluent transfer operation builder
 */
export interface ISPIFluentTransfer {
  execute(): ISPITransferResult;
}

/**
 * Fluent device operations
 */
export interface ISPIFluentDevice {
  write(data: number | Uint8Array): ISPIFluentWrite;
  read(count: number): ISPIFluentRead;
  transfer(data: number | Uint8Array): ISPIFluentTransfer;
}

// ---------------------------------------------------------------------------
// Fluent-Only Interface
//
// For Arduino SPI-compatible API, use ISPIArduino from '@typecode/core/arduino'
// ---------------------------------------------------------------------------

/**
 * Fluent SPI bus interface
 */
export interface ISPIBus {
  readonly isInitialized: boolean;
  
  // --- Fluent Configuration API ---
  readonly config: ISPIFluentConfig;
  
  // --- Fluent Device Operations ---
  device(chipSelect: IDigitalPin): ISPIFluentDevice;
  
  // --- Debug mode ---
  /** 
   * When enabled, failed operations print error details to Serial before returning.
   * Format: "[SPI ERROR] <message> (status=N)"
   */
  debugOnError: boolean;
}

// ---------------------------------------------------------------------------
// Legacy/Extended Interfaces (for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * SPI Device abstraction
 */
export interface ISPIDevice {
  readonly bus: ISPIBus;
  readonly chipSelect: IDigitalPin;
  transfer(data: number | Uint8Array, options?: SPITransferOptions): Uint8Array;
  write(data: number | Uint8Array, options?: SPITransferOptions): void;
  read(count: number, options?: SPITransferOptions): Uint8Array;
  writeRegister(register: number, data: number | Uint8Array): void;
  readRegister(register: number, count: number): Uint8Array;
}

/**
 * Create an SPI device wrapper using fluent API
 */
export function createSPIDevice(
  bus: ISPIBus,
  chipSelect: IDigitalPin
): ISPIDevice {
  return {
    bus,
    chipSelect,
    transfer(data: number | Uint8Array, _options?: SPITransferOptions): Uint8Array {
      const result = bus.device(chipSelect).transfer(data).execute();
      return result.bytes;
    },
    write(data: number | Uint8Array, _options?: SPITransferOptions): void {
      bus.device(chipSelect).write(data);
    },
    read(count: number, _options?: SPITransferOptions): Uint8Array {
      const result = bus.device(chipSelect).read(count).from(0);
      return result.bytes;
    },
    writeRegister(register: number, data: number | Uint8Array): void {
      bus.device(chipSelect).write(data).to(register);
    },
    readRegister(register: number, count: number): Uint8Array {
      const result = bus.device(chipSelect).read(count).from(register);
      return result.bytes;
    },
  };
}

/**
 * SPI Error class
 */
export class SPIError extends Error {
  constructor(
    message: string,
    public readonly status: SPIStatus
  ) {
    super(message);
    this.name = 'SPIError';
  }
}

/**
 * SPI Timeout Error
 */
export class SPITimeoutError extends SPIError {
  constructor(message: string = 'SPI operation timed out') {
    super(message, SPIStatus.TIMEOUT);
    this.name = 'SPITimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

export function spiModeToCpolCpha(mode: SPIMode): { cpol: SPIClockPolarity; cpha: SPIClockPhase } {
  switch (mode) {
    case 0: return { cpol: 0, cpha: 0 };
    case 1: return { cpol: 0, cpha: 1 };
    case 2: return { cpol: 1, cpha: 0 };
    case 3: return { cpol: 1, cpha: 1 };
  }
}

export function cpolCphaToSpiMode(cpol: SPIClockPolarity, cpha: SPIClockPhase): SPIMode {
  return (cpol * 2 + cpha) as SPIMode;
}