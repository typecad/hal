// ---------------------------------------------------------------------------
// @typecode/core — SPI bus interface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum SPIClockPolarity {
  LOW  = 0,
  HIGH = 1,
}

export enum SPIClockPhase {
  LEADING  = 0,
  TRAILING = 1,
}

export enum SPIBitOrder {
  MSB = 0,
  LSB = 1,
}

export enum SPIMode {
  MODE_0 = 0,  // CPOL=0  CPHA=0
  MODE_1 = 1,  // CPOL=0  CPHA=1
  MODE_2 = 2,  // CPOL=1  CPHA=0
  MODE_3 = 3,  // CPOL=1  CPHA=1
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SPIConfig {
  frequency: number;
  mode?: SPIMode;
  cpol?: SPIClockPolarity;
  cpha?: SPIClockPhase;
  bitOrder?: SPIBitOrder;
  dataBits?: number;
  csPin?: number;
  sckPin?: number;
  mosiPin?: number;
  misoPin?: number;
  bus?: number;
}

export interface SPITransferOptions {
  csPin?: number;
  frequency?: number;
  csSetupTime?: number;
  csHoldTime?: number;
  keepCsActive?: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SPIError extends Error {
  constructor(
    message: string,
    public readonly bus: number,
  ) {
    super(message);
    this.name = 'SPIError';
  }
}

export class SPITimeoutError extends SPIError {
  constructor(bus: number) {
    super(`SPI timeout on bus ${bus}`, bus);
    this.name = 'SPITimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Bus interface
// ---------------------------------------------------------------------------

export interface ISPIBus {
  readonly busNumber: number;
  readonly frequency: number;
  readonly mode: SPIMode;
  readonly isInitialized: boolean;

  initialize(config?: SPIConfig): void;
  deinitialize(): void;

  /** Full-duplex transfer: send txData, receive same-length buffer. */
  transfer(txData: Uint8Array, options?: SPITransferOptions): Uint8Array;
  write(data: Uint8Array, options?: SPITransferOptions): void;
  read(length: number, options?: SPITransferOptions): Uint8Array;

  writeRegister(csPin: number, register: number, data: Uint8Array): void;
  readRegister(csPin: number, register: number, length: number): Uint8Array;

  setFrequency(hz: number): void;
  setMode(mode: SPIMode): void;
  setBitOrder(order: SPIBitOrder): void;
}

// ---------------------------------------------------------------------------
// Device abstraction
// ---------------------------------------------------------------------------

export interface ISPIDevice {
  readonly csPin: number;
  readonly bus: ISPIBus;

  transfer(txData: Uint8Array): Uint8Array;
  write(data: Uint8Array): void;
  read(length: number): Uint8Array;
  readRegister(register: number, length: number): Uint8Array;
  writeRegister(register: number, data: Uint8Array): void;
  readByte(register: number): number;
  writeByte(register: number, value: number): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a device handle bound to a bus and chip-select pin. */
export declare function createSPIDevice(bus: ISPIBus, csPin: number): ISPIDevice;
