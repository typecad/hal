import type { ErrorPolicy } from './error-policy.js';

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

export interface UARTStatusInfo {
  available: number;
  writeAvailable: number;
  overrunError: boolean;
  parityError: boolean;
  framingError: boolean;
  breakDetected: boolean;
}

export interface IUninitializedUARTBus {
  readonly uartNumber: number;
  readonly isEnabled: false;
  begin(baud: number): ISerialPort;
  take(): IOwnedSerialPort | undefined;
}

export interface IUARTBus {
  readonly uartNumber: number;
  readonly baudRate: number;
  readonly isEnabled: boolean;
  begin(baud: number): void;
  end(): IUninitializedUARTBus;
  read(): number;
  peek(): number;
  readLine(): string;
  readBytes(count: number): Uint8Array;
  readString(): string;
  available(): number;
  write(data: number | Uint8Array | string): number;
  flush(): void;
  getStatus(): UARTStatusInfo;
  clearErrors(): void;
  onReceive(callback: (bytesAvailable: number) => void): void;
  onTransmitComplete(callback: () => void): void;
  onError(callback: (status: UARTStatus) => void): void;
  errorPolicy: ErrorPolicy;
}

export interface ISerialPort extends IUARTBus {
  print(...args: unknown[]): void;
  println(...args: unknown[]): void;
  printf(format: string, ...args: unknown[]): void;
  isConnected(): boolean;
  waitForConnection(timeout?: number): Promise<void>;
}

export interface IOwnedSerialPort extends ISerialPort {
  release(): void;
}
