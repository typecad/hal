// ---------------------------------------------------------------------------
// @typecode/core — UART / Serial interfaces
// ---------------------------------------------------------------------------

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
}

export interface UARTStatus {
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
  ) {
    super(message);
    this.name = 'UARTError';
  }
}

export class UARTBufferOverflowError extends UARTError {
  constructor(uart: number) {
    super(`Buffer overflow on UART ${uart}`, uart);
    this.name = 'UARTBufferOverflowError';
  }
}

// ---------------------------------------------------------------------------
// UART interface
// ---------------------------------------------------------------------------

export interface IUART {
  readonly uartNumber: number;
  readonly baudRate: number;
  readonly isInitialized: boolean;

  initialize(config?: UARTConfig): void;
  deinitialize(): void;

  // Write
  write(data: Uint8Array): number;
  writeString(text: string): number;
  writeLine(text: string): number;

  // Read
  read(length?: number): Uint8Array;
  readString(length?: number): string;
  readLine(timeout?: number): string;
  readUntil(delimiter: number, timeout?: number): Uint8Array;
  peek(): number;

  // Buffer info
  available(): number;
  availableForWrite(): number;
  flush(): void;
  clearRxBuffer(): void;
  clearTxBuffer(): void;

  // Status
  getStatus(): UARTStatus;
  clearErrors(): void;
  setBaudRate(baud: number): void;

  // Callbacks
  onReceive(callback: (data: Uint8Array) => void): void;
  onTransmitComplete(callback: () => void): void;
  onError(callback: (error: UARTError) => void): void;
}

// ---------------------------------------------------------------------------
// Serial port (extends UART with print helpers)
// ---------------------------------------------------------------------------

export interface ISerialPort extends IUART {
  print(...args: unknown[]): void;
  println(...args: unknown[]): void;
  printf(format: string, ...args: unknown[]): void;
  isConnected(): boolean;
  waitForConnection(timeout?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Debug serial (extends SerialPort with log levels)
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
