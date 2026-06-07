import type { BasePin } from '../pin';
import type { ErrorPolicy } from './error-policy';

export type SPIBitOrder = 'msb' | 'lsb';
export type SPIMode = 0 | 1 | 2 | 3;

export enum SPIStatus {
  SUCCESS = 0,
  NOT_INITIALIZED = 1,
  TRANSFER_FAILED = 2,
  INVALID_CONFIG = 3,
  TIMEOUT = 4,
  DEVICE_ERROR = 5,
}

export interface SPISettings {
  frequency: number;
  mode: SPIMode;
  bitOrder: SPIBitOrder;
}

export interface ISPIDevice {
  readonly chipSelect: BasePin;
  transfer(data: number | Uint8Array): Uint8Array;
  write(data: number | Uint8Array): void;
  read(count: number): Uint8Array;
  writeRegister(register: number, data: number | Uint8Array): void;
  readRegister(register: number, count: number): Uint8Array;
}

export interface IUninitializedSPIBus {
  readonly isEnabled: false;
  begin(): ISPIBus;
  take(): IOwnedSPIBus | undefined;
}

export interface ISPIBus {
  readonly isEnabled: boolean;
  begin(): void;
  end(): IUninitializedSPIBus;
  setMode(mode: SPIMode): void;
  setBitOrder(order: SPIBitOrder): void;
  setFrequency(hz: number): void;
  beginTransaction(settings: SPISettings): void;
  endTransaction(): void;
  device(chipSelect: BasePin): ISPIDevice;
  onError(handler: (status: SPIStatus, operation: 'transfer' | 'read' | 'write') => void): void;
  errorPolicy: ErrorPolicy;
}

export interface IOwnedSPIBus extends ISPIBus {
  release(): void;
}
