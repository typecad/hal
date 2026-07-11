// ---------------------------------------------------------------------------
// @typecad/simulator — Runtime contract interfaces
//
// These types define the runtime contracts that @typecad/simulator's simulated
// peripheral classes implement (SimDigitalPin, SimI2CBus, SimSPIBus,
// SimSerialPort, ...). They were relocated here from @typecad/hal so that HAL
// contains only its transpiler-shim surface, and the simulator owns the
// hierarchy that matches its job (real behavioral objects, not IR emitters).
//
// Primitive aliases that the contracts still reference (DigitalValue,
// AnalogValue, InterruptHandler) and the protocol-shape types (I2CAddress,
// SPIMode, SPIBitOrder, SPISettings) remain in @typecad/hal and are imported
// below. The dependency direction is simulator → hal (already established).
// ---------------------------------------------------------------------------

import type {
  DigitalValue,
  AnalogValue,
  InterruptHandler,
  I2CAddress,
} from '@typecad/hal';
import type {
  SPIMode,
  SPIBitOrder,
  SPISettings,
} from '@typecad/hal';

// ---------------------------------------------------------------------------
// Pin capability flags
// ---------------------------------------------------------------------------

export interface PinCapabilityFlags {
  digitalInput: boolean;
  digitalOutput: boolean;
  analogInput: boolean;
  /** DAC output */
  analogOutput: boolean;
  pwm: boolean;
  interrupt: boolean;
  pullUp: boolean;
  pullDown: boolean;
  touch: boolean;
  openDrain: boolean;
}

// ---------------------------------------------------------------------------
// Tone attachment (returned by tone() for chaining .for() duration)
// ---------------------------------------------------------------------------

export interface IToneAttachment {
  for(duration: number): void;
}

// ---------------------------------------------------------------------------
// Interrupt handler types
// ---------------------------------------------------------------------------

export interface InterruptOptions {
  debounce?: number;
}

// ---------------------------------------------------------------------------
// Pin interfaces (used by the simulator package)
// ---------------------------------------------------------------------------

export interface BasePin {
  readonly number: number;
  readonly gpio: number;
  readonly capabilities: PinCapabilityFlags;
  read(): DigitalValue;
  isHigh(): boolean;
  isLow(): boolean;
  write(value: DigitalValue): void;
  high(): void;
  low(): void;
  toggle(): void;
  pulse(duration: number): void;
  tone(frequency: number): IToneAttachment;
  noTone(): void;
  inputPullUp(): void;
  inputPullDown?(): void;
  outputOpenDrain(initial?: DigitalValue): void;
  asOutput(initial?: DigitalValue): IOutputModePin;
  asInput(): IInputModePin;
  asInputPullUp(): IInputModePin;
  pwm?(percent: number): void;
  getPwmFrequency?(): number;
  getPwmResolution?(): number;
  readAnalog?(): AnalogValue;
  readVoltage?(): number;
  setAnalogReference?(voltage: number): void;
  getAnalogResolution?(): number;
  onRising?(handler: InterruptHandler, options?: InterruptOptions): void;
  onFalling?(handler: InterruptHandler, options?: InterruptOptions): void;
  onChange?(handler: InterruptHandler, options?: InterruptOptions): void;
  offInterrupts?(): void;
  waitForRising(timeout?: number): Promise<void>;
  waitForFalling(timeout?: number): Promise<void>;
}

export interface IOutputModePin {
  readonly number: number;
  readonly gpio: number;
  readonly capabilities: PinCapabilityFlags;
  write(value: DigitalValue): void;
  high(): void;
  low(): void;
  toggle(): void;
  pulse(duration: number): void;
  tone(frequency: number): IToneAttachment;
  noTone(): void;
  pwm?(percent: number): void;
  getPwmFrequency?(): number;
  getPwmResolution?(): number;
  asOutput(initial?: DigitalValue): IOutputModePin;
  asInput(): IInputModePin;
  asInputPullUp(): IInputModePin;
  inputPullUp(): void;
  inputPullDown?(): void;
  outputOpenDrain(initial?: DigitalValue): void;
}

export interface IInputModePin {
  readonly number: number;
  readonly gpio: number;
  readonly capabilities: PinCapabilityFlags;
  read(): DigitalValue;
  isHigh(): boolean;
  isLow(): boolean;
  readAnalog?(): AnalogValue;
  readVoltage?(): number;
  setAnalogReference?(voltage: number): void;
  getAnalogResolution?(): number;
  onRising?(handler: InterruptHandler, options?: InterruptOptions): void;
  onFalling?(handler: InterruptHandler, options?: InterruptOptions): void;
  onChange?(handler: InterruptHandler, options?: InterruptOptions): void;
  offInterrupts?(): void;
  waitForRising(timeout?: number): Promise<void>;
  waitForFalling(timeout?: number): Promise<void>;
  asOutput(initial?: DigitalValue): IOutputModePin;
  asInput(): IInputModePin;
  asInputPullUp(): IInputModePin;
  inputPullUp(): void;
  inputPullDown?(): void;
  outputOpenDrain(initial?: DigitalValue): void;
}

/** Pin with PWM output capability. */
export type PWMPin = BasePin & { pwm: NonNullable<BasePin['pwm']> };

/** Pin with analog input capability. */
export type AnalogPin = BasePin & { readAnalog: NonNullable<BasePin['readAnalog']> };

/** Pin with interrupt capability. */
export type InterruptPin = BasePin & { onRising: NonNullable<BasePin['onRising']> };

// ---------------------------------------------------------------------------
// Capability type guards and assertions
// ---------------------------------------------------------------------------

function isBasePin(value: unknown): value is BasePin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'number' in value &&
    'gpio' in value
  );
}

export function hasPWM(pin: unknown): pin is PWMPin {
  return isBasePin(pin) && 'pwm' in pin && typeof pin.pwm === 'function';
}

export function hasAnalogInput(pin: unknown): pin is AnalogPin {
  return isBasePin(pin) && 'readAnalog' in pin && typeof pin.readAnalog === 'function';
}

export function hasInterrupt(pin: unknown): pin is InterruptPin {
  return isBasePin(pin) && 'onRising' in pin && typeof pin.onRising === 'function';
}

export function assertPWM(pin: BasePin, message?: string): asserts pin is PWMPin {
  if (!hasPWM(pin)) {
    throw new Error(message ?? 'Pin does not support PWM');
  }
}

export function assertAnalog(pin: BasePin, message?: string): asserts pin is AnalogPin {
  if (!hasAnalogInput(pin)) {
    throw new Error(message ?? 'Pin does not support analog input');
  }
}

export function assertInterrupt(pin: BasePin, message?: string): asserts pin is InterruptPin {
  if (!hasInterrupt(pin)) {
    throw new Error(message ?? 'Pin does not support interrupts');
  }
}

// ---------------------------------------------------------------------------
// Error policy
// ---------------------------------------------------------------------------

export type ErrorPolicy = 'throw' | 'callback' | 'silent';

// ---------------------------------------------------------------------------
// I2C types
// ---------------------------------------------------------------------------

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

export interface II2CBus {
  readonly busNumber: number;
  readonly isEnabled: boolean;
  begin(): void;
  begin(address: I2CAddress): void;
  end(): void;
  setClock(hz: number): void;
  device(address: I2CAddress): II2CDeviceAccessor;
  onError(handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void): void;
  errorPolicy: ErrorPolicy;
  recover(): boolean;
}

// ---------------------------------------------------------------------------
// SPI types
// ---------------------------------------------------------------------------

export enum SPIStatus {
  SUCCESS = 0,
  NOT_INITIALIZED = 1,
  TRANSFER_FAILED = 2,
  INVALID_CONFIG = 3,
  TIMEOUT = 4,
  DEVICE_ERROR = 5,
}

export interface ISPIDevice {
  readonly chipSelect: BasePin;
  transfer(data: number | Uint8Array): Uint8Array;
  write(data: number | Uint8Array): void;
  read(count: number): Uint8Array;
  writeRegister(register: number, data: number | Uint8Array): void;
  readRegister(register: number, count: number): Uint8Array;
}

export interface ISPIBus {
  readonly isEnabled: boolean;
  begin(): void;
  end(): void;
  setMode(mode: SPIMode): void;
  setBitOrder(order: SPIBitOrder): void;
  setFrequency(hz: number): void;
  beginTransaction(settings: SPISettings): void;
  endTransaction(): void;
  device(chipSelect: BasePin): ISPIDevice;
  onError(handler: (status: SPIStatus, operation: 'transfer' | 'read' | 'write') => void): void;
  errorPolicy: ErrorPolicy;
}

// ---------------------------------------------------------------------------
// UART types
// ---------------------------------------------------------------------------

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

export interface IUARTBus {
  readonly uartNumber: number;
  readonly baudRate: number;
  readonly isEnabled: boolean;
  begin(baud: number): void;
  end(): void;
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
