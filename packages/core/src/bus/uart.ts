// ---------------------------------------------------------------------------
// @typecode/core — UART / Serial interfaces
//
// Provides TypeScript interfaces for UART communication.
// Two API styles:
//   1. Arduino-compatible (Serial.begin, Serial.read, Serial.write, etc.)
//   2. Fluent chainable (Serial.config.baudRate().parity().begin())
// ---------------------------------------------------------------------------

import type { IPin } from '../types/pin';

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
// Configuration
// ---------------------------------------------------------------------------

export interface UARTConfig {
  baudRate: number;
  dataBits?: number;
  parity?: UARTParity;
  stopBits?: UARTStopBits;
  flowControl?: UARTFlowControl;
  txPin?: number;
  rxPin?: number;
  rtsPin?: number;
  ctsPin?: number;
  rxBufferSize?: number;
  txBufferSize?: number;
  uart?: number;
  inverted?: boolean;
  defaultTimeout?: number;
}

export interface UARTStatusInfo {
  available: number;
  writeAvailable: number;
  overrunError: boolean;
  parityError: boolean;
  framingError: boolean;
  breakDetected: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UARTError extends Error {
  constructor(
    message: string,
    public readonly uart: number,
    public readonly status: UARTStatus,
  ) {
    super(message);
    this.name = 'UARTError';
  }
}

export class UARTBufferOverflowError extends UARTError {
  constructor(uart: number) {
    super(`Buffer overflow on UART ${uart}`, uart, UARTStatus.BUFFER_OVERFLOW);
    this.name = 'UARTBufferOverflowError';
  }
}

export class UARTTimeoutError extends UARTError {
  constructor(uart: number) {
    super(`Timeout on UART ${uart}`, uart, UARTStatus.TIMEOUT);
    this.name = 'UARTTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/**
 * Result of a UART read operation
 */
export interface IUARTReadResult {
  /** True if operation succeeded */
  readonly ok: boolean;
  /** Status code indicating success or type of failure */
  readonly status: UARTStatus;
  /** Raw bytes read */
  readonly bytes: Uint8Array;
  /** Number of bytes actually read */
  readonly bytesRead: number;
  /** True if the operation timed out */
  readonly timedOut: boolean;
  
  // Type conversions
  /** Convert to string (UTF-8) */
  asString(): string;
  /** Convert to trimmed string */
  asStringTrim(): string;
  /** Parse as integer */
  asInt(): number;
  /** Parse as float */
  asFloat(): number;
  /** Get first byte as unsigned 8-bit integer */
  asUint8(): number;
  /** Get first byte as signed 8-bit integer */
  asInt8(): number;
  /** Get as unsigned 16-bit integer */
  asUint16(endian: 'be' | 'le'): number;
  /** Get as signed 16-bit integer */
  asInt16(endian: 'be' | 'le'): number;
  /** Get as unsigned 32-bit integer */
  asUint32(endian: 'be' | 'le'): number;
  /** Get as signed 32-bit integer */
  asInt32(endian: 'be' | 'le'): number;
}

/**
 * Result of a UART write operation
 */
export interface IUARTWriteResult {
  /** True if operation succeeded */
  readonly ok: boolean;
  /** Status code indicating success or type of failure */
  readonly status: UARTStatus;
  /** Number of bytes actually written */
  readonly bytesWritten: number;
}

// ---------------------------------------------------------------------------
// Fluent Configuration Builder
// ---------------------------------------------------------------------------

/**
 * Fluent UART configuration builder
 */
export interface IUARTFluentConfig {
  /** Set baud rate (e.g., 9600, 115200) */
  baudRate(bps: number): this;
  /** Set data bits (5, 6, 7, or 8) */
  dataBits(bits: 5 | 6 | 7 | 8): this;
  /** Set parity mode */
  parity(parity: UARTParity): this;
  /** Set stop bits */
  stopBits(bits: UARTStopBits): this;
  /** Set flow control mode */
  flowControl(mode: UARTFlowControl): this;
  /** Set TX pin */
  tx(pin: IPin): this;
  /** Set RX pin */
  rx(pin: IPin): this;
  /** Set RTS pin (for hardware flow control) */
  rts(pin: IPin): this;
  /** Set CTS pin (for hardware flow control) */
  cts(pin: IPin): this;
  /** Set RX buffer size */
  rxBufferSize(size: number): this;
  /** Set TX buffer size */
  txBufferSize(size: number): this;
  /** Enable inverted signal */
  inverted(invert: boolean): this;
  /** Set default timeout for read operations (milliseconds) */
  defaultTimeout(ms: number): this;
  /** Apply configuration and initialize the UART */
  begin(): void;
}

// ---------------------------------------------------------------------------
// Fluent Write Operations
// ---------------------------------------------------------------------------

/**
 * Fluent write operation builder - also callable as Serial.write(data)
 */
export interface IUARTFluentWrite {
  /** Write text followed by \r\n (CRLF) */
  line(text: string): IUARTWriteResult;
  /** Write text followed by \n (LF only) */
  ln(text: string): IUARTWriteResult;
  /** Write a single character/byte */
  char(c: number | string): IUARTWriteResult;
  /** Write raw string without line ending */
  string(text: string): IUARTWriteResult;
  /** Write raw bytes */
  bytes(data: Uint8Array | number[]): IUARTWriteResult;
  /** Printf-style formatted output (no line ending) */
  format(fmt: string, ...args: unknown[]): IUARTWriteResult;
  /** Printf-style formatted output with \r\n */
  formatln(fmt: string, ...args: unknown[]): IUARTWriteResult;
  /** Write a specific byte value (0-255) */
  byte(value: number): IUARTWriteResult;
  /** Write 16-bit unsigned value */
  uint16(value: number, endian: 'be' | 'le'): IUARTWriteResult;
  /** Write 16-bit signed value */
  int16(value: number, endian: 'be' | 'le'): IUARTWriteResult;
  /** Write 32-bit unsigned value */
  uint32(value: number, endian: 'be' | 'le'): IUARTWriteResult;
  /** Write 32-bit signed value */
  int32(value: number, endian: 'be' | 'le'): IUARTWriteResult;
  // Callable signature for Arduino compatibility: Serial.write(data)
  (data: number | Uint8Array | string): number;
}

// ---------------------------------------------------------------------------
// Fluent Read Operations
// ---------------------------------------------------------------------------

/**
 * Fluent read operation builder - also callable as Serial.read()
 */
export interface IUARTFluentRead {
  /** Read until newline (\n or \r\n) */
  line(timeout?: number): IUARTReadResult;
  /** Read until specific character/byte or string */
  until(delimiter: number | string, timeout?: number): IUARTReadResult;
  /** Read until Enter key (handles \r, \n, or \r\n) */
  untilEnter(timeout?: number): IUARTReadResult;
  /** Read until space character */
  untilSpace(timeout?: number): IUARTReadResult;
  /** Read until tab character */
  untilTab(timeout?: number): IUARTReadResult;
  /** Read exact number of bytes */
  bytes(count: number, timeout?: number): IUARTReadResult;
  /** Read all available bytes */
  all(): IUARTReadResult;
  /** Read a single byte */
  byte(): IUARTReadResult;
  /** Read a single character as string */
  char(): IUARTReadResult;
  // Callable signature for Arduino compatibility: Serial.read()
  (): number;
}

// ---------------------------------------------------------------------------
// UART Bus Interface
// ---------------------------------------------------------------------------

/**
 * UART bus interface with Arduino-compatible and fluent APIs
 */
export interface IUARTBus {
  readonly uartNumber: number;
  readonly baudRate: number;
  readonly isInitialized: boolean;

  // --- Fluent Configuration API ---
  readonly config: IUARTFluentConfig;
  
  // --- Fluent Read/Write Operations ---
  // These are callable (Arduino style) AND have fluent methods
  // Usage: Serial.read() or Serial.read.line() or Serial.write(data) or Serial.write.line("text")
  readonly read: IUARTFluentRead;
  readonly write: IUARTFluentWrite;

  // --- Arduino-Compatible API ---
  /** Initialize with baud rate (Arduino style) */
  begin(baud: number): void;
  /** Initialize with full config */
  begin(config: UARTConfig): void;
  /** Deinitialize the UART */
  end(): void;

  // Buffer info
  /** Number of bytes available to read */
  available(): number;
  /** Number of bytes that can be written */
  availableForWrite(): number;
  /** Peek at next byte without consuming */
  peek(): number;
  
  // Buffer control
  /** Wait for transmission to complete */
  flush(): void;

  // Status
  /** Get detailed status info */
  getStatus(): UARTStatusInfo;
  /** Clear error flags */
  clearErrors(): void;

  // Callbacks
  /** Register callback for when data is received */
  onReceive(callback: (bytesAvailable: number) => void): void;
  /** Register callback for when transmission completes */
  onTransmitComplete(callback: () => void): void;
  /** Register callback for errors */
  onError(callback: (error: UARTError) => void): void;
}

// ---------------------------------------------------------------------------
// Serial Port (extends UART with print helpers)
// ---------------------------------------------------------------------------

/**
 * Serial port interface with Arduino-style print methods
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
// Debug Serial (extends SerialPort with log levels)
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface IDebugSerial extends ISerialPort {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  logWithTimestamp(level: LogLevel, message: string): void;
  setEnabled(enabled: boolean): void;
  setLevel(level: LogLevel): void;
}