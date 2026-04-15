// ---------------------------------------------------------------------------
// @typecode/core — I2C bus interface
//
// Modern API: I2C0.begin(), I2C0.device(addr).readByte(reg), etc.
//
// BRANDED INITIALIZATION STATE:
//   - I2C0 is UninitializedI2CBus until .begin() is called
//   - .begin() returns II2CBus (initialized) with full device access
//   - TypeScript prevents .device() calls before .begin() at compile time
// ---------------------------------------------------------------------------

import type { BasePin } from '../types/pin';

// ---------------------------------------------------------------------------
// Address type
// ---------------------------------------------------------------------------

/** 7-bit or 10-bit I2C address. */
export type I2CAddress = number;

// ---------------------------------------------------------------------------
// End transmission return codes
// ---------------------------------------------------------------------------

/** Return codes for I2C operations */
export enum I2CStatus {
  SUCCESS = 0,
  DATA_TOO_LONG = 1,
  NACK_ON_ADDRESS = 2,
  NACK_ON_DATA = 3,
  OTHER_ERROR = 4,
  PARTIAL_READ = 5,
}

// ---------------------------------------------------------------------------
// Error policy
// ---------------------------------------------------------------------------

/**
 * How the bus handles errors at runtime.
 * - 'throw': Assert-style — throws on error (good for development)
 * - 'callback': Calls registered onError handlers
 * - 'silent': Returns status codes only (good for production)
 */
export type ErrorPolicy = 'throw' | 'callback' | 'silent';

// ---------------------------------------------------------------------------
// Branded types for initialization state
// ---------------------------------------------------------------------------

declare const I2CInitializedBrand: unique symbol;

/** Marker type for an initialized I2C bus. */
export type InitializedI2CBus = { readonly [I2CInitializedBrand]: true };

// ---------------------------------------------------------------------------
// Device accessor
// ---------------------------------------------------------------------------

/** Device accessor with direct read/write methods. */
export interface II2CDeviceAccessor {
  /** Device address this accessor targets. */
  readonly address: I2CAddress;

  /** Read a single byte from a register. */
  readByte(register: number): number;
  /** Read multiple bytes from a register. */
  readBytes(register: number, count: number): Uint8Array;
  /** Write a single byte to a register. */
  writeByte(register: number, value: number): void;
  /** Write multiple bytes to a register. */
  writeBytes(register: number, data: Uint8Array | number[]): void;
}

// ---------------------------------------------------------------------------
// Bus interface — split by initialization state
// ---------------------------------------------------------------------------

/**
 * Uninitialized I2C bus — available before .begin() is called.
 * Only allows initialization methods. Device operations (.device())
 * are not available until the bus is initialized.
 */
export interface IUninitializedI2CBus {
  readonly busNumber: number;
  readonly isEnabled: false;

  // --- Initialization ---
  /** Initialize I2C as master. Returns initialized bus. */
  begin(): II2CBus;
  /** Initialize I2C as slave with the given address. Returns initialized bus. */
  begin(address: I2CAddress): II2CBus;

  // --- Ownership (opt-in, for multi-threaded contention) ---
  /**
   * Acquire exclusive ownership of the I2C bus.
   * Returns `undefined` if the bus is already owned by another task.
   *
   * This is opt-in — use `begin()` for single-threaded scenarios.
   * On single-threaded AVR, this is a boolean flag check.
   * On ESP32/FreeRTOS, this acquires a mutex.
   */
  take(): IOwnedI2CBus | undefined;
}

/**
 * Initialized I2C bus — available after .begin() is called.
 * Provides full device access and configuration.
 */
export interface II2CBus {
  readonly busNumber: number;
  readonly isEnabled: boolean;

  // --- Initialization ---
  /** Re-initialize I2C as master (no-op if already initialized). */
  begin(): void;
  /** Re-initialize I2C as slave with the given address. */
  begin(address: I2CAddress): void;
  /** Disable the bus. Returns uninitialized bus. */
  end(): IUninitializedI2CBus;
  /** Set clock speed in Hz (e.g., 100000 for standard, 400000 for fast mode). */
  setClock(hz: number): void;

  // --- Device operations ---
  /** Access device at address for read/write operations. */
  device(address: I2CAddress): II2CDeviceAccessor;

  // --- Error handling ---
  /** Register a global error handler for all operations. */
  onError(handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void): void;

  // --- Error policy ---
  /**
   * How errors are handled on this bus.
   * - 'throw': Assert-style — throws on error (good for development)
   * - 'callback': Calls registered onError handlers
   * - 'silent': Returns status codes only (good for production)
   * @default 'callback'
   */
  errorPolicy: ErrorPolicy;

  // --- Bus recovery ---
  /** Attempt to recover a stuck bus (toggles SCL to release stuck slaves). */
  recover(): boolean;
}

// ---------------------------------------------------------------------------
// Owned I2C Bus — exclusive access via take()
// ---------------------------------------------------------------------------

/**
 * Owned I2C bus — obtained via `I2C0.take()`, released via `release()`.
 * Extends II2CBus with ownership semantics for multi-threaded contention.
 */
export interface IOwnedI2CBus extends II2CBus {
  /** Release exclusive ownership back to the free bus. */
  release(): void;
}
