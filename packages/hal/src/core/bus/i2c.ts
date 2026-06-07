import type { BasePin } from '../pin';
import type { ErrorPolicy } from './error-policy';

export type I2CAddress = number;

export enum I2CStatus {
  SUCCESS = 0,
  DATA_TOO_LONG = 1,
  NACK_ON_ADDRESS = 2,
  NACK_ON_DATA = 3,
  OTHER_ERROR = 4,
  PARTIAL_READ = 5,
}

export interface II2CDeviceAccessor {
  readonly address: I2CAddress;
  readByte(register: number): number;
  readBytes(register: number, count: number): Uint8Array;
  writeByte(register: number, value: number): void;
  writeBytes(register: number, data: Uint8Array | number[]): void;
}

export interface IUninitializedI2CBus {
  readonly busNumber: number;
  readonly isEnabled: false;
  begin(): II2CBus;
  begin(address: I2CAddress): II2CBus;
  take(): IOwnedI2CBus | undefined;
}

export interface II2CBus {
  readonly busNumber: number;
  readonly isEnabled: boolean;
  begin(): void;
  begin(address: I2CAddress): void;
  end(): IUninitializedI2CBus;
  setClock(hz: number): void;
  device(address: I2CAddress): II2CDeviceAccessor;
  onError(handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void): void;
  errorPolicy: ErrorPolicy;
  recover(): boolean;
}

export interface IOwnedI2CBus extends II2CBus {
  release(): void;
}
