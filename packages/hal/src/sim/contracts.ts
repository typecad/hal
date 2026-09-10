// ---------------------------------------------------------------------------
// @typecad/hal/sim — Runtime contract interfaces
//
// These types define the runtime contracts that the simulator's simulated
// peripheral classes implement (SimDigitalPin, SimI2CBus, SimSPIBus,
// SimSerialPort, ...). They were relocated here from @typecad/hal so that HAL
// contains only its transpiler-shim surface, and the simulator owns the
// hierarchy that matches its job (real behavioral objects, not IR emitters).
//
// Primitive aliases that the contracts still reference (DigitalValue,
// AnalogValue, InterruptHandler) remain in @typecad/hal and are imported
// below. The legacy Wire/SPI protocol-shape types (I2CAddress, SPIMode,
// SPIBitOrder, SPISettings) now live here — they describe the simulated
// Arduino-style bus objects, not the HAL transpiler shims. The dependency
// direction is simulator → hal (already established).
// ---------------------------------------------------------------------------

import type {
  DigitalValue,
  AnalogValue,
  InterruptHandler,
} from '../index.js';

// ---------------------------------------------------------------------------
// Protocol-shape types (legacy Wire/SPI runtime surface)
// ---------------------------------------------------------------------------

export type I2CAddress = number;

export type SPIBitOrder = 'msb' | 'lsb';
export type SPIMode = 0 | 1 | 2 | 3;

export interface SPISettings {
  frequency: number;
  mode: SPIMode;
  bitOrder: SPIBitOrder;
}

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
// Interrupt handler types
// ---------------------------------------------------------------------------

export interface InterruptOptions {
  debounce?: number;
}

// ---------------------------------------------------------------------------
// Pin interfaces — mirror the HAL Pin / OutputPin / InputPin classes
// (packages/hal/src/gpio.ts). The HAL is the source of truth; these contracts
// carry no `capabilities` field (that lives in the simulator's own Sim*Pin
// classes, not on the HAL pin types).
// ---------------------------------------------------------------------------

/** Unconfigured pin — mirrors HAL `Pin`. Use asOutput/asInput to obtain a
 *  configured pin. Also exposes basic I/O (the HAL Pin is a superset). */
export interface BasePin {
  readonly number: number;
  readonly gpio: number;
  read(): DigitalValue;
  isHigh(): boolean;
  isLow(): boolean;
  write(value: DigitalValue): void;
  high(): void;
  low(): void;
  toggle(): void;
  pwm?(duty: number): void;
  asOutput(initial?: DigitalValue): IOutputModePin;
  asInput(): IInputModePin;
  asInputPullUp(): IInputModePin;
}

/** Configured output pin — mirrors HAL `OutputPin`. */
interface IOutputModePin {
  readonly number: number;
  readonly gpio: number;
  write(value: DigitalValue): void;
  high(): void;
  low(): void;
  toggle(): void;
  pulse(duration: number): void;
  pwm?(duty: number): void;
  getPwmFrequency?(): number;
  getPwmResolution?(): number;
}

/** Configured input pin — mirrors HAL `InputPin`. */
interface IInputModePin {
  readonly number: number;
  readonly gpio: number;
  read(): DigitalValue;
  isHigh(): boolean;
  isLow(): boolean;
  readAnalog?(): AnalogValue;
  readVoltage?(): number;
  setAnalogReference?(ref: string): void;
  getAnalogResolution?(): number;
  onRising?(handler: InterruptHandler, options?: InterruptOptions): void;
  onFalling?(handler: InterruptHandler, options?: InterruptOptions): void;
  onChange?(handler: InterruptHandler, options?: InterruptOptions): void;
  offInterrupts?(): void;
  waitForRising(timeout?: number): Promise<void>;
  waitForFalling(timeout?: number): Promise<void>;
}

/** Pin with PWM output capability. */
/** Pin with PWM output capability. */
export type PWMPin = BasePin & { pwm: NonNullable<BasePin['pwm']> };

/** Pin with analog input capability. */
export type AnalogPin = IInputModePin & { readAnalog: NonNullable<IInputModePin['readAnalog']> };

/** Pin with interrupt capability. */
export type InterruptPin = IInputModePin & { onRising: NonNullable<IInputModePin['onRising']> };

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
  return (
    typeof pin === 'object' && pin !== null &&
    'number' in pin && 'gpio' in pin &&
    'readAnalog' in pin && typeof (pin as { readAnalog: unknown }).readAnalog === 'function'
  );
}

export function hasInterrupt(pin: unknown): pin is InterruptPin {
  return (
    typeof pin === 'object' && pin !== null &&
    'number' in pin && 'gpio' in pin &&
    'onRising' in pin && typeof (pin as { onRising: unknown }).onRising === 'function'
  );
}

export function assertPWM(pin: BasePin, message?: string): asserts pin is PWMPin {
  if (!hasPWM(pin)) {
    throw new Error(message ?? 'Pin does not support PWM');
  }
}

export function assertAnalog(pin: IInputModePin, message?: string): asserts pin is AnalogPin {
  if (!hasAnalogInput(pin)) {
    throw new Error(message ?? 'Pin does not support analog input');
  }
}

export function assertInterrupt(pin: IInputModePin, message?: string): asserts pin is InterruptPin {
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
  begin(): this;
  beginSlave(address: I2CAddress): void;
  end(): void;
  setClock(hz: number): void;
  device(address: I2CAddress): II2CDeviceAccessor;
  recover(): void;
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
  transfer(data: number | Uint8Array): number;
  write(data: number | Uint8Array): void;
  writeRegister(register: number, value: number): void;
  readRegister(register: number, count: number): Uint8Array;
}

export interface ISPIBus {
  begin(): this;
  end(): void;
  setMode(mode: SPIMode): void;
  setBitOrder(order: SPIBitOrder): void;
  setFrequency(hz: number): void;
  beginTransaction(settings: SPISettings): void;
  endTransaction(): void;
  device(chipSelect: BasePin): ISPIDevice;
}

// ---------------------------------------------------------------------------
// UART types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UART types
//
// Host-side simulation contract for UART-shaped peripherals. This is the
// SIMULATOR's own surface (drivers typed against it run in plain Node); the
// device-side HAL UART (packages/hal/src/uart-port.ts) is Zephyr-shaped and
// lower separately.
// ---------------------------------------------------------------------------

export interface IUARTBus {
  begin(baud: number): this;
  end(): void;
  read(): number;
  peek(): number;
  readLine(): string;
  available(): number;
  write(data: number | Uint8Array | string): void;
  flush(): void;
}

export interface ISerialPort extends IUARTBus {
  print(...args: unknown[]): void;
  println(...args: unknown[]): void;
  printf(format: string, ...args: unknown[]): void;
  waitForConnection(timeout?: number): Promise<void>;
}
