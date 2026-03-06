// ---------------------------------------------------------------------------
// @typecode/core — I2C bus interface (Arduino Wire-compatible + Fluent API)
// ---------------------------------------------------------------------------

import type { IPin } from '../types/pin';

// ---------------------------------------------------------------------------
// Address type
// ---------------------------------------------------------------------------

/** 7-bit or 10-bit I2C address. */
export type I2CAddress = number;

// ---------------------------------------------------------------------------
// End transmission return codes
// ---------------------------------------------------------------------------

/** Return codes for endTransmission() */
export enum I2CStatus {
  SUCCESS = 0,
  DATA_TOO_LONG = 1,
  NACK_ON_ADDRESS = 2,
  NACK_ON_DATA = 3,
  OTHER_ERROR = 4,
  PARTIAL_READ = 5,  // Fewer bytes read than requested
}

// ---------------------------------------------------------------------------
// Result types for fluent API
// ---------------------------------------------------------------------------

/** Result wrapper for I2C operations with status checking. */
export interface II2CResult<T> {
  /** True if operation succeeded. */
  readonly ok: boolean;
  /** Status code indicating success or type of failure. */
  readonly status: I2CStatus;
  /** The result value (may be default/empty on error). */
  readonly value: T;
  /** Number of bytes actually read (for read operations). */
  readonly bytesRead?: number;
  /** Chain success handler. */
  onSuccess(handler: (value: T) => void): this;
  /** Chain error handler. */
  onError(handler: (status: I2CStatus, bytesRead?: number) => void): this;
}

/** Result of a read operation with type conversion methods. */
export interface II2CReadResult extends II2CResult<Uint8Array> {
  /** Read as unsigned 8-bit integer. */
  asUint8(): number;
  /** Read as unsigned 16-bit integer. */
  asUint16(endian: 'be' | 'le'): number;
  /** Read as signed 16-bit integer. */
  asInt16(endian: 'be' | 'le'): number;
  /** Read as unsigned 32-bit integer. */
  asUint32(endian: 'be' | 'le'): number;
  /** Read as signed 32-bit integer. */
  asInt32(endian: 'be' | 'le'): number;
}

/** Result of a write operation. */
export interface II2CWriteResult extends II2CResult<void> {
  /** Alias for ok - true if write succeeded. */
  readonly success: boolean;
}

// ---------------------------------------------------------------------------
// Fluent configuration builder
// ---------------------------------------------------------------------------

/** Fluent I2C bus configuration builder. */
export interface II2CConfigBuilder {
  /** Set SDA pin (platform-specific, usually fixed). */
  sda(pin: IPin): this;
  /** Set SCL pin (platform-specific, usually fixed). */
  scl(pin: IPin): this;
  /** Set clock speed in Hz (e.g., 100000 for standard, 400000 for fast mode). */
  speed(hz: number): this;
  /** Apply configuration and initialize the bus. */
  begin(): void;
}

// ---------------------------------------------------------------------------
// Fluent device operations
// ---------------------------------------------------------------------------

/** Target for a write operation (specifies register). */
export interface II2CWriteTarget {
  /** Write to the specified register address. */
  to(register: number): II2CWriteResult;
}

/** Source for a read operation (specifies register). */
export interface II2CReadSource {
  /** Read from the specified register address. */
  from(register: number): II2CReadResult;
}

/** Builder for device read operations. */
export interface II2CReadBuilder {
  /** Specify number of bytes to read. */
  read(count: number): II2CReadSource;
}

/** Builder for device write operations. */
export interface II2CWriteBuilder {
  /** Write a single byte. */
  write(data: number): II2CWriteTarget;
  /** Write multiple bytes from array. */
  write(data: number[] | Uint8Array): II2CWriteTarget;
}

/** Device accessor for fluent operations. */
export interface II2CDeviceAccessor extends II2CReadBuilder, II2CWriteBuilder {
  /** Device address this accessor targets. */
  readonly address: I2CAddress;
}

// ---------------------------------------------------------------------------
// Bus interface (Arduino Wire-compatible + Fluent)
// ---------------------------------------------------------------------------

export interface II2CBus {
  readonly busNumber: number;
  readonly isInitialized: boolean;

  // --- Fluent Configuration API ---
  /** Get configuration builder for fluent setup. */
  readonly config: II2CConfigBuilder;
  
  // --- Fluent Device Operations ---
  /** Access device at address for fluent read/write operations. */
  device(address: I2CAddress): II2CDeviceAccessor;

  // --- Arduino Wire-compatible API ---
  /** Initialize as I2C master. */
  begin(): void;
  /** Initialize as I2C slave with given address. */
  begin(address: I2CAddress): void;

  // Transactional write API
  /** Begin a transmission to the given address. */
  beginTransmission(address: I2CAddress): void;
  /** Write data to the transmission buffer. Returns number of bytes written. */
  write(data: number | Uint8Array | string): number;
  /** End the transmission and send data. Returns I2CStatus. */
  endTransmission(stop?: boolean): number;

  // Read API
  /** Request bytes from a slave. Returns number of bytes available. */
  requestFrom(address: I2CAddress, quantity: number, stop?: boolean): number;
  /** Number of bytes available to read. */
  available(): number;
  /** Read a single byte from the buffer. Returns -1 if no data available. */
  read(): number;

  // Clock control
  /** Set the I2C clock frequency in Hz. */
  setClock(clock: number): void;

  // Slave mode callbacks
  /** Register a callback for when data is received as slave. */
  onReceive(handler: (howMany: number) => void): void;
  /** Register a callback for when data is requested from slave. */
  onRequest(handler: () => void): void;

  // Error handling
  /** Register a global error handler for all operations. */
  onError(handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void): void;

  // Bus recovery
  /** Attempt to recover a stuck bus (toggles SCL to release stuck slaves). */
  recover(): boolean;

  // Cleanup
  /** Disable the Wire peripheral. */
  end(): void;
}

// ---------------------------------------------------------------------------
// Device abstraction (convenience wrapper)
// ---------------------------------------------------------------------------

export interface II2CDevice {
  readonly address: I2CAddress;
  readonly bus: II2CBus;

  /** Read multiple bytes from a register. */
  read(register: number, length: number): Uint8Array;
  /** Write data to a register. */
  write(register: number, data: Uint8Array): void;
  /** Read a single byte from a register. */
  readByte(register: number): number;
  /** Write a single byte to a register. */
  writeByte(register: number, value: number): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a device handle bound to a bus and address. */
export declare function createI2CDevice(bus: II2CBus, address: I2CAddress): II2CDevice;