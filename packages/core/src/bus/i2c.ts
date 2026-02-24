// ---------------------------------------------------------------------------
// @typecode/core — I2C bus interface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Speed presets
// ---------------------------------------------------------------------------

export enum I2CSpeed {
  STANDARD   = 100_000,
  FAST       = 400_000,
  FAST_PLUS  = 1_000_000,
  HIGH_SPEED = 3_400_000,
}

// ---------------------------------------------------------------------------
// Address type
// ---------------------------------------------------------------------------

/** 7-bit or 10-bit I2C address. */
export type I2CAddress = number;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface I2CConfig {
  speed?: I2CSpeed | number;
  sda?: number;
  scl?: number;
  pullUp?: boolean;
  timeout?: number;
  bus?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class I2CError extends Error {
  constructor(
    message: string,
    public readonly address: I2CAddress,
    public readonly bus: number,
  ) {
    super(message);
    this.name = 'I2CError';
  }
}

export class I2CNackError extends I2CError {
  constructor(address: I2CAddress, bus: number) {
    super(`NACK from device 0x${address.toString(16)} on bus ${bus}`, address, bus);
    this.name = 'I2CNackError';
  }
}

export class I2CTimeoutError extends I2CError {
  constructor(address: I2CAddress, bus: number) {
    super(`Timeout communicating with 0x${address.toString(16)} on bus ${bus}`, address, bus);
    this.name = 'I2CTimeoutError';
  }
}

export class I2CArbitrationLostError extends I2CError {
  constructor(address: I2CAddress, bus: number) {
    super(`Arbitration lost on bus ${bus}`, address, bus);
    this.name = 'I2CArbitrationLostError';
  }
}

// ---------------------------------------------------------------------------
// Bus interface
// ---------------------------------------------------------------------------

export interface II2CBus {
  readonly busNumber: number;
  readonly speed: I2CSpeed | number;
  readonly isInitialized: boolean;

  initialize(config?: I2CConfig): void;
  deinitialize(): void;

  /** Scan the bus and return addresses that ACK. */
  scan(): I2CAddress[];
  /** Ping a single address; returns true on ACK. */
  ping(address: I2CAddress): boolean;

  // Raw transfers
  write(address: I2CAddress, data: Uint8Array): void;
  read(address: I2CAddress, length: number): Uint8Array;
  writeThenRead(address: I2CAddress, writeData: Uint8Array, readLength: number): Uint8Array;

  // Register-level helpers
  readRegister(address: I2CAddress, register: number, buffer: Uint8Array): number;
  writeRegister(address: I2CAddress, register: number, data: Uint8Array): void;
  readByte(address: I2CAddress, register: number): number;
  writeByte(address: I2CAddress, register: number, value: number): void;
  readWord(address: I2CAddress, register: number, littleEndian?: boolean): number;
  writeWord(address: I2CAddress, register: number, value: number, littleEndian?: boolean): void;

  setSpeed(speed: I2CSpeed | number): void;
  getSpeed(): I2CSpeed | number;
}

// ---------------------------------------------------------------------------
// Device abstraction
// ---------------------------------------------------------------------------

export interface II2CDevice {
  readonly address: I2CAddress;
  readonly bus: II2CBus;

  read(register: number, length: number): Uint8Array;
  write(register: number, data: Uint8Array): void;
  readByte(register: number): number;
  writeByte(register: number, value: number): void;
  updateBits(register: number, mask: number, value: number): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a device handle bound to a bus and address. */
export declare function createI2CDevice(bus: II2CBus, address: I2CAddress): II2CDevice;
