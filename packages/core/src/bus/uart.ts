// ---------------------------------------------------------------------------
// @typehal/core — UART / Serial interfaces
//
// Modern API: const serial = UART0.begin(baud); serial.print(), serial.println()
// ---------------------------------------------------------------------------

import type { BasePin } from '../types/pin';
import type { ErrorPolicy } from './error-policy';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum UARTParity {
  NONE = 0,
  EVEN = 1,
  ODD  = 2,
}

export enum UARTStopBits {
  ONE            = 1,
  ONE_POINT_FIVE = 1.5,
  TWO            = 2,
}

export enum UARTFlowControl {
  NONE     = 0,
  HARDWARE = 1,
  SOFTWARE = 2,
}

/**
 * UART status codes
 */
export enum UARTStatus {
  SUCCESS = 0,
  NOT_INITIALIZED = 1,
  TIMEOUT = 2,
  BUFFER_OVERFLOW = 3,
  OVERRUN_ERROR = 4,
  PARITY_ERROR = 5,
  FRAMING_ERROR = 6,
  BREAK_DETECTED = 7,
  WRITE_FAILED = 8,
  READ_FAILED = 9,
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface UARTStatusInfo {
  available: number;
  writeAvailable: number;
  overrunError: boolean;
  parityError: boolean;
  framingError: boolean;
  breakDetected: boolean;
}

// ---------------------------------------------------------------------------
// UART Bus Interface — split by initialization state
// ---------------------------------------------------------------------------

/**
 * Uninitialized UART bus — available before .begin() is called.
 * Only allows initialization methods. Read/write operations
 * are not available until the bus is initialized.
 */
export interface IUninitializedUARTBus {
  readonly uartNumber: number;
  readonly isEnabled: false;

  // --- Initialization ---
  /** Initialize UART with the specified baud rate. Returns initialized bus. */
  begin(baud: number): ISerialPort;

  // --- Ownership (opt-in, for multi-threaded contention) ---
  /**
   * Acquire exclusive ownership of the UART bus.
   * Returns `undefined` if the bus is already owned by another task.
   *
   * This is opt-in — use `begin()` for single-threaded scenarios.
   * On single-threaded AVR, this is a boolean flag check.
   * On ESP32/FreeRTOS, this acquires a mutex.
   */
  take(): IOwnedSerialPort | undefined;
}

/**
 * UART bus interface.
 */
export interface IUARTBus {
  readonly uartNumber: number;
  readonly baudRate: number;
  readonly isEnabled: boolean;

  // --- Initialization ---
  /** Re-initialize UART with the specified baud rate (no-op if already initialized). */
  begin(baud: number): void;
  /** Disable the UART. Returns uninitialized bus. */
  end(): IUninitializedUARTBus;

  // --- Read operations ---
  /** Read a single byte (-1 if none available). */
  read(): number;
  /** Peek at the next byte without consuming it. */
  peek(): number;
  /** Read a line (until newline). */
  readLine(): string;
  /** Read exactly count bytes. */
  readBytes(count: number): Uint8Array;
  /** Read all available bytes as a string. */
  readString(): string;
  /** Number of bytes available to read. */
  available(): number;

  // --- Write operations ---
  /** Write data (byte, bytes, or string). Returns bytes written. */
  write(data: number | Uint8Array | string): number;

  // --- Buffer control ---
  /** Flush the transmit buffer. */
  flush(): void;

  // --- Status ---
  /** Get detailed status info. */
  getStatus(): UARTStatusInfo;
  /** Clear error flags. */
  clearErrors(): void;

  // --- Callbacks ---
  /** Register callback for when data is received. */
  onReceive(callback: (bytesAvailable: number) => void): void;
  /** Register callback for when transmission completes. */
  onTransmitComplete(callback: () => void): void;
  /** Register callback for errors. */
  onError(callback: (status: UARTStatus) => void): void;

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
// Serial Port (extends UART with print helpers)
// ---------------------------------------------------------------------------

/**
 * Serial port interface with print methods
 */
export interface ISerialPort extends IUARTBus {
  /** Print values without newline */
  print(...args: unknown[]): void;
  /** Print values with newline */
  println(...args: unknown[]): void;
  /** Printf-style formatted print */
  printf(format: string, ...args: unknown[]): void;
  /** Check if USB serial is connected (for USB-CDC serial) */
  isConnected(): boolean;
  /** Wait for USB connection */
  waitForConnection(timeout?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Owned Serial Port — exclusive access via take()
// ---------------------------------------------------------------------------

/**
 * Owned serial port — obtained via `UART0.take()`, released via `release()`.
 * Extends ISerialPort with ownership semantics for multi-threaded contention.
 */
interface IOwnedSerialPort extends ISerialPort {
  /** Release exclusive ownership. */
  release(): void;
}

