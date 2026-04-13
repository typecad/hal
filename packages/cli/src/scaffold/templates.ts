// ---------------------------------------------------------------------------
// Board package templates for scaffolding
// ---------------------------------------------------------------------------

import type { ArchitectureIdentifier } from '@typecode/core';
import { toPascalCase } from '../utils/strings';

export interface BoardTemplateOptions {
  name: string;              // e.g., 'my-custom-board'
  displayName: string;       // e.g., 'My Custom Board'
  vendor: string;            // e.g., 'My Company'
  architecture: ArchitectureIdentifier;
  mcu: string;
  clockSpeedMhz: number;
  flashKb: number;
  sramKb: number;
  eepromKb: number;
  fqbn: string;
  minimal: boolean;
}

// ---------------------------------------------------------------------------
// package.json template
// ---------------------------------------------------------------------------

export function generatePackageJson(options: BoardTemplateOptions): string {
  const { name, displayName, vendor } = options;
  
  return `{
  "name": "@typecode/board-${name}",
  "version": "0.1.0",
  "description": "TypeCode ${displayName} board definition",
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@typecode/core": "^0.1.0"
  },
  "peerDependencies": {
    "typecode": "^0.1.0"
  },
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
`;
}

// ---------------------------------------------------------------------------
// tsconfig.json template
// ---------------------------------------------------------------------------

export function generateTsConfig(): string {
  return `{
  "compilerOptions": {
    "composite": true,
    "target": "ES2021",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"]
}
`;
}

// ---------------------------------------------------------------------------
// src/index.ts template - Board definition manifest
// ---------------------------------------------------------------------------

export function generateIndexTs(options: BoardTemplateOptions): string {
  const { name, displayName, vendor, architecture, mcu, clockSpeedMhz, flashKb, sramKb, eepromKb, fqbn } = options;
  const clockSpeed = clockSpeedMhz * 1_000_000;
  const className = toPascalCase(name);
  
  return `// ---------------------------------------------------------------------------
// @typecode/board-${name} — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecode/core';

// Re-export the platform strategy so the CLI can resolve it automatically
export { BoardStrategy } from './strategy';

// ---------------------------------------------------------------------------
// Default capability flags (customize based on your board's pins)
// ---------------------------------------------------------------------------

const NO  = false as const;
const YES = true  as const;

/** Shorthand: digital I/O only, with internal pull-up. */
const DIGITAL = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: NO,
  pullUp: YES,       pullDown: NO,
  touch: NO,         openDrain: NO,
} as const;

/** Shorthand: digital I/O + external-interrupt capable. */
const DIGITAL_INT = { ...DIGITAL, interrupt: YES } as const;

/** Shorthand: digital I/O + PWM. */
const DIGITAL_PWM = { ...DIGITAL, pwm: YES } as const;

/** Shorthand: digital I/O + analog input. */
const ANALOG_IN = { ...DIGITAL, analogInput: YES } as const;

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ${className}: BoardDefinition = {
  id: '${name}',
  name: '${displayName}',
  vendor: '${vendor}',
  description: '${displayName} — ${mcu}',
  architecture: '${architecture}',
  mcu: '${mcu}',
  clockSpeed: ${clockSpeed},

  // ----- Memory ------------------------------------------------------------
  memory: {
    flash:  ${flashKb * 1024},
    sram:   ${sramKb * 1024},
    eeprom: ${eepromKb * 1024},
  },

  // ----- Pins --------------------------------------------------------------
  // TODO: Fill in your board's pin definitions
  pins: {
    all: [
      // Example pin definitions (customize for your board):
      // { number: 0, gpio: 0, name: 'D0', capabilities: DIGITAL_INT,
      //   functions: [{ type: 'uart', instance: 0, role: 'rx' }] },
      // { number: 1, gpio: 1, name: 'D1', capabilities: DIGITAL_INT,
      //   functions: [{ type: 'uart', instance: 0, role: 'tx' }] },
      // { number: 13, gpio: 13, name: 'D13', aliases: ['LED'], capabilities: DIGITAL,
      //   onboardLed: true },
    ],

    digital: [
      // 'D0', 'D1', ...
    ],
    analog: [
      // 'A0', 'A1', ...
    ],
    pwm: [
      // 'D3', 'D5', ...
    ],

    i2c:  { 0: { sda: 'TODO', scl: 'TODO' } },
    spi:  { 0: { mosi: 'TODO', miso: 'TODO', sck: 'TODO', cs: 'TODO' } },
    uart: { 0: { tx: 'TODO', rx: 'TODO' } },

    led: 'TODO',  // On-board LED pin name
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    i2c:  [{ instance: 0, defaultPins: { sda: 'TODO', scl: 'TODO' } }],
    spi:  [{ instance: 0, defaultPins: { mosi: 'TODO', miso: 'TODO', sck: 'TODO', cs: 'TODO' } }],
    uart: [{ instance: 0, defaultPins: { tx: 'TODO', rx: 'TODO' } }],
    adc:  [{ instance: 0, channels: 0, resolution: 10, referenceVoltage: 3.3 }],
    pwm:  { channels: 0, resolution: 8, maxFrequency: 1000 },
  },

  // ----- Features ----------------------------------------------------------
  features: {
    multicore: false,
    coreCount: 1,
    deepSleep: false,
    watchdog: true,
    externalInterrupts: true,
    hardwareRng: false,
    fpu: false,
  },

  // ----- Build config ------------------------------------------------------
  build: {
    arduino: '${fqbn}',
    extraFlags: [],
    defines: {
      F_CPU: '${clockSpeed}UL',
      ARDUINO: '10819',
    },
  },
};

export default ${className};

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Typed pins (individual + aliases)
export {
  // D0, D1, D2, ...
  // A0, A1, A2, ...
  // LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

// Re-export HIGH/LOW constants from core
export { HIGH, LOW } from '@typecode/core';

// Peripheral bus instances
export { I2C0, SPI0, UART0 } from './peripherals';

// Timing / utility functions
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';

// Analog helpers
export { AnalogReference, analogReference } from './analog';

// Interrupt helpers
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';

// Board namespace (single-import convenience)
export { Board } from './board';
export type { IBoard, DigitalPins, AnalogPins } from './board';
`;
}

// ---------------------------------------------------------------------------
// src/pins.ts template
// ---------------------------------------------------------------------------

export function generatePinsTs(options: BoardTemplateOptions): string {
  const { name } = options;
  
  return `// ---------------------------------------------------------------------------
// @typecode/board-${name} — Typed pin exports
//
// Each pin is exported with the narrowest interface that matches its
// capabilities so that TypeScript prevents invalid operations at compile
// time (e.g. calling analogWrite on a digital-only pin).
//
// The factory stubs below capture pin/gpio numbers as plain data.  The
// transpiler replaces them with architecture-specific C++ during code-gen.
// ---------------------------------------------------------------------------

import type {
  IDigitalPin,
  IPWMPin,
  IAnalogInput,
  IInterruptPin,
} from '@typecode/core';
import { pinNumber } from '@typecode/core';

// ---------------------------------------------------------------------------
// Internal stub factories (no-op at runtime; consumed by transpiler)
// ---------------------------------------------------------------------------

function createDigitalPin(pin: number, gpio: number): IDigitalPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin;
}

function createPWMPin(pin: number, gpio: number): IPWMPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IPWMPin;
}

function createAnalogPin(pin: number, gpio: number): IAnalogInput {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IAnalogInput;
}

function createInterruptPin(pin: number, gpio: number): IDigitalPin & IInterruptPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin & IInterruptPin;
}

// ---------------------------------------------------------------------------
// TODO: Define your board's pins below
// ---------------------------------------------------------------------------

// Example digital-only pins:
// export const D0: IDigitalPin = createDigitalPin(0, 0);
// export const D1: IDigitalPin = createDigitalPin(1, 1);

// Example PWM pins:
// export const D3: IPWMPin = createPWMPin(3, 3);

// Example analog input pins:
// export const A0: IAnalogInput = createAnalogPin(14, 14);

// Example interrupt-capable pins:
// export const D2: IDigitalPin & IInterruptPin = createInterruptPin(2, 2);

// ---------------------------------------------------------------------------
// Convenience aliases (uncomment and customize for your board)
// ---------------------------------------------------------------------------

// /** On-board LED. */
// export const LED = D13;

// /** I2C data line. */
// export const SDA = A4;
// /** I2C clock line. */
// export const SCL = A5;

// /** SPI master-out / slave-in. */
// export const MOSI = D11;
// /** SPI master-in / slave-out. */
// export const MISO = D12;
// /** SPI clock. */
// export const SCK = D13;
// /** SPI slave select. */
// export const SS = D10;

// /** UART transmit. */
// export const TX = D1;
// /** UART receive. */
// export const RX = D0;
`;
}

// ---------------------------------------------------------------------------
// src/peripherals.ts template
// ---------------------------------------------------------------------------

export function generatePeripheralsTs(options: BoardTemplateOptions): string {
  const { name } = options;
  
  return `// ---------------------------------------------------------------------------
// @typecode/board-${name} — Peripheral instances (Fluent API only)
//
// Stub objects representing the board's built-in peripheral buses.
// These carry full type information at design-time so TypeScript prevents
// invalid usage.  The transpiler replaces method calls with the
// architecture-specific C++ (Wire, SPI, Serial libraries).
// ---------------------------------------------------------------------------

import type {
  II2CBus,
  II2CConfigBuilder,
  II2CDeviceAccessor,
  II2CReadSource,
  II2CWriteTarget,
  II2CReadResult,
  II2CWriteResult,
  I2CAddress,
  I2CStatus,
} from '@typecode/core';
import type { IPin } from '@typecode/core';
import type {
  ISPIBus,
  ISPIFluentConfig,
  ISPIFluentDevice,
  ISPIFluentWrite,
  ISPIFluentRead,
  ISPIFluentTransfer,
  ISPIWriteResult,
  ISPIReadResult,
  ISPITransferResult,
  IDigitalPin,
} from '@typecode/core';
import { SPIMode, SPIBitOrder, SPIStatus } from '@typecode/core';
import type {
  ISerialPort,
  UARTStatusInfo,
  IUARTFluentConfig,
  IUARTFluentRead,
  IUARTFluentWrite,
  IUARTReadResult,
  IUARTWriteResult,
} from '@typecode/core';
import { UARTStatus, UARTParity, UARTStopBits, UARTFlowControl } from '@typecode/core';

// ---------------------------------------------------------------------------
// I2C — Wire (bus 0) - Fluent API only
// ---------------------------------------------------------------------------

const stubI2CReadResult: II2CReadResult = {
  ok: true,
  status: 0,
  value: new Uint8Array(0),
  bytesRead: 0,
  onSuccess(handler) { return this; },
  onError(handler) { return this; },
  asUint8() { return 0; },
  asUint16() { return 0; },
  asInt16() { return 0; },
  asUint32() { return 0; },
  asInt32() { return 0; },
};

const stubI2CWriteResult: II2CWriteResult = {
  ok: true,
  status: 0,
  value: undefined as void,
  success: true,
  onSuccess(handler) { return this; },
  onError(handler) { return this; },
};

/** I2C bus 0 (Wire library). */
export const I2C0: II2CBus = {
  busNumber: 0,
  isInitialized: false,

  config: {
    sda(_pin: IPin) { return this; },
    scl(_pin: IPin) { return this; },
    speed(_hz: number) { return this; },
    begin() { /* transpiler: Wire.begin(); */ },
  } as II2CConfigBuilder,

  device(address: I2CAddress): II2CDeviceAccessor {
    const readBuilder: II2CReadSource = {
      from(_register: number): II2CReadResult {
        return stubI2CReadResult;
      },
    };
    
    const writeTarget: II2CWriteTarget = {
      to(_register: number): II2CWriteResult {
        return stubI2CWriteResult;
      },
    };
    
    return {
      address,
      read(_count: number) { return readBuilder; },
      write(_data: number | number[] | Uint8Array) { return writeTarget; },
    } as II2CDeviceAccessor;
  },

  onError(_handler: (status: I2CStatus, address: I2CAddress, operation: 'read' | 'write') => void) {},
  recover(): boolean { return true; },
} as II2CBus;

// ---------------------------------------------------------------------------
// SPI — SPI (bus 0) - Fluent API only
// ---------------------------------------------------------------------------

const stubSPIWriteResult: ISPIWriteResult = {
  ok: true,
  status: SPIStatus.SUCCESS,
  bytesWritten: 0,
};

const stubSPIReadResult: ISPIReadResult = {
  ok: true,
  status: SPIStatus.SUCCESS,
  bytes: new Uint8Array(0),
  asUint8() { return 0; },
  asUint16(_endian) { return 0; },
  asInt8() { return 0; },
  asInt16(_endian) { return 0; },
};

const stubSPITransferResult: ISPITransferResult = {
  ok: true,
  status: SPIStatus.SUCCESS,
  bytes: new Uint8Array(0),
  asUint8() { return 0; },
  asUint16(_endian) { return 0; },
};

const spiConfigBuilder: ISPIFluentConfig = {
  frequency(_hz: number) { return this; },
  mode(_mode: SPIMode) { return this; },
  bitOrder(_order: SPIBitOrder) { return this; },
  cpol(_level: 0 | 1) { return this; },
  cpha(_level: 0 | 1) { return this; },
  begin() { /* transpiler: SPI.begin(); */ },
};

function createSPIDeviceAccessor(_csPin: IDigitalPin): ISPIFluentDevice {
  const writeBuilder: ISPIFluentWrite = {
    to(_register: number): ISPIWriteResult {
      return stubSPIWriteResult;
    },
  };

  const readBuilder: ISPIFluentRead = {
    from(_register: number): ISPIReadResult {
      return stubSPIReadResult;
    },
  };

  const transferBuilder: ISPIFluentTransfer = {
    execute(): ISPITransferResult {
      return stubSPITransferResult;
    },
  };

  return {
    write(_data: number | Uint8Array) { return writeBuilder; },
    read(_count: number) { return readBuilder; },
    transfer(_data: number | Uint8Array) { return transferBuilder; },
  };
}

/** SPI bus 0. */
export const SPI0: ISPIBus = {
  isInitialized: false,
  config: spiConfigBuilder,
  device(chipSelect: IDigitalPin): ISPIFluentDevice {
    return createSPIDeviceAccessor(chipSelect);
  },
} as ISPIBus;

// ---------------------------------------------------------------------------
// Serial — UART 0 - Fluent API only
// ---------------------------------------------------------------------------

const stubUARTReadResult: IUARTReadResult = {
  ok: true,
  status: UARTStatus.SUCCESS,
  bytes: new Uint8Array(0),
  bytesRead: 0,
  timedOut: false,
  asString() { return ''; },
  asStringTrim() { return ''; },
  asInt() { return 0; },
  asFloat() { return 0; },
  asUint8() { return 0; },
  asInt8() { return 0; },
  asUint16(_endian) { return 0; },
  asInt16(_endian) { return 0; },
  asUint32(_endian) { return 0; },
  asInt32(_endian) { return 0; },
};

const stubUARTWriteResult: IUARTWriteResult = {
  ok: true,
  status: UARTStatus.SUCCESS,
  bytesWritten: 0,
};

const uartConfigBuilder: IUARTFluentConfig = {
  baudRate(_bps: number) { return this; },
  dataBits(_bits: 5 | 6 | 7 | 8) { return this; },
  parity(_parity: UARTParity) { return this; },
  stopBits(_bits: UARTStopBits) { return this; },
  flowControl(_mode: UARTFlowControl) { return this; },
  tx(_pin: IPin) { return this; },
  rx(_pin: IPin) { return this; },
  rts(_pin: IPin) { return this; },
  cts(_pin: IPin) { return this; },
  rxBufferSize(_size: number) { return this; },
  txBufferSize(_size: number) { return this; },
  inverted(_invert: boolean) { return this; },
  defaultTimeout(_ms: number) { return this; },
  begin() { /* transpiler: Serial.begin(baud); */ },
} as IUARTFluentConfig;

const uartFluentRead: IUARTFluentRead = Object.assign(
  function(): number { return -1; },
  {
    line(_timeout?: number): IUARTReadResult { return stubUARTReadResult; },
    until(_delimiter: number | string, _timeout?: number): IUARTReadResult { return stubUARTReadResult; },
    untilEnter(_timeout?: number): IUARTReadResult { return stubUARTReadResult; },
    untilSpace(_timeout?: number): IUARTReadResult { return stubUARTReadResult; },
    untilTab(_timeout?: number): IUARTReadResult { return stubUARTReadResult; },
    bytes(_count: number, _timeout?: number): IUARTReadResult { return stubUARTReadResult; },
    all(): IUARTReadResult { return stubUARTReadResult; },
    byte(): IUARTReadResult { return stubUARTReadResult; },
    char(): IUARTReadResult { return stubUARTReadResult; },
  }
) as IUARTFluentRead;

const uartFluentWrite: IUARTFluentWrite = Object.assign(
  function(_data: number | Uint8Array | string): number { return 0; },
  {
    line(_text: string): IUARTWriteResult { return stubUARTWriteResult; },
    ln(_text: string): IUARTWriteResult { return stubUARTWriteResult; },
    char(_c: number | string): IUARTWriteResult { return stubUARTWriteResult; },
    string(_text: string): IUARTWriteResult { return stubUARTWriteResult; },
    bytes(_data: Uint8Array | number[]): IUARTWriteResult { return stubUARTWriteResult; },
    format(_fmt: string, ..._args: unknown[]): IUARTWriteResult { return stubUARTWriteResult; },
    formatln(_fmt: string, ..._args: unknown[]): IUARTWriteResult { return stubUARTWriteResult; },
    byte(_value: number): IUARTWriteResult { return stubUARTWriteResult; },
    uint16(_value: number, _endian: 'be' | 'le'): IUARTWriteResult { return stubUARTWriteResult; },
    int16(_value: number, _endian: 'be' | 'le'): IUARTWriteResult { return stubUARTWriteResult; },
    uint32(_value: number, _endian: 'be' | 'le'): IUARTWriteResult { return stubUARTWriteResult; },
    int32(_value: number, _endian: 'be' | 'le'): IUARTWriteResult { return stubUARTWriteResult; },
  }
) as IUARTFluentWrite;

/** Hardware serial (UART 0). */
export const UART0: ISerialPort = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,
  config: uartConfigBuilder,
  read: uartFluentRead,
  write: uartFluentWrite,
  getStatus(): UARTStatusInfo {
    return {
      available: 0,
      writeAvailable: 0,
      overrunError: false,
      parityError: false,
      framingError: false,
      breakDetected: false,
    };
  },
  clearErrors() {},
  onReceive(_callback: (bytesAvailable: number) => void) {},
  onTransmitComplete(_callback: () => void) {},
  onError(_callback: (error: Error) => void) {},
  print(..._args: unknown[]) {},
  println(..._args: unknown[]) {},
  printf(_format: string, ..._args: unknown[]) {},
  isConnected(): boolean { return false; },
  waitForConnection(_timeout?: number): Promise<void> { return Promise.resolve(); },
} as ISerialPort;
`;
}

// ---------------------------------------------------------------------------
// src/timing.ts template
// ---------------------------------------------------------------------------

export function generateTimingTs(): string {
  return `// ---------------------------------------------------------------------------
// Timing utilities
//
// These map 1-to-1 to the Arduino built-in timing functions.
// The transpiler replaces calls with the C++ equivalents.
// ---------------------------------------------------------------------------

/** Block execution for \`ms\` milliseconds.  Maps to Arduino \`delay()\`. */
export declare function delay(ms: number): Promise<void>;

/** Returns milliseconds since board reset.  Maps to Arduino \`millis()\`. */
export declare function millis(): number;

/** Returns microseconds since board reset.  Maps to Arduino \`micros()\`. */
export declare function micros(): number;

/** Block execution for \`us\` microseconds.  Maps to \`delayMicroseconds()\`. */
export declare function delayMicroseconds(us: number): Promise<void>;

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

/** Re-map a number from one range to another.  Maps to Arduino \`map()\`. */
export declare function map(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number;

/** Constrain a number between a low and high value.  Maps to \`constrain()\`. */
export declare function constrain(value: number, low: number, high: number): number;
`;
}

// ---------------------------------------------------------------------------
// src/analog.ts template - Architecture-specific
// ---------------------------------------------------------------------------

export function generateAnalogTs(architecture: ArchitectureIdentifier): string {
  // ESP32 variants use attenuation model
  if (architecture.startsWith('esp32')) {
    return `// ---------------------------------------------------------------------------
// Analog helpers — ESP32 attenuation model
//
// ESP32 boards use attenuation to set the ADC input voltage range.
// ---------------------------------------------------------------------------

/**
 * ADC attenuation levels.
 *
 * - DB_0   = 0 dB   (max ~1.1V)
 * - DB_2_5 = 2.5 dB (max ~1.5V)
 * - DB_6   = 6 dB   (max ~2.2V)
 * - DB_11  = 11 dB  (max ~3.3V, default)
 */
export enum AnalogAttenuation {
  DB_0   = 0,
  DB_2_5 = 1,
  DB_6   = 2,
  DB_11  = 3,
}

/**
 * Set the ADC attenuation for all analog pins.
 * Maps to ESP32 \`analogSetAttenuation()\`.
 */
export declare function analogSetAttenuation(attenuation: AnalogAttenuation): void;

/**
 * Write a value to the DAC.
 * Maps to ESP32 \`dacWrite()\`.
 */
export declare function dacWrite(pin: number, value: number): void;
`;
  }

  // AVR and others use reference voltage model
  return `// ---------------------------------------------------------------------------
// Analog helpers — Reference voltage model
//
// Typed wrappers around the Arduino ADC subsystem.
// ---------------------------------------------------------------------------

/**
 * ADC reference voltage source.
 *
 * On most AVR boards:
 * - \`DEFAULT\`  = AVcc (5 V or 3.3 V)
 * - \`INTERNAL\` = Internal reference (varies by board)
 * - \`EXTERNAL\` = Voltage on the AREF pin
 */
export enum AnalogReference {
  DEFAULT  = 1,
  INTERNAL = 3,
  EXTERNAL = 0,
}

/**
 * Set the ADC reference voltage.
 * Maps to Arduino \`analogReference()\`.
 */
export declare function analogReference(ref: AnalogReference): void;
`;
}

// ---------------------------------------------------------------------------
// src/interrupts.ts template
// ---------------------------------------------------------------------------

export function generateInterruptsTs(): string {
  return `// ---------------------------------------------------------------------------
// Interrupt helpers
//
// Typed wrappers around Arduino interrupt functions.
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typecode/core';

/** Disable all interrupts. Maps to \`noInterrupts()\`. */
export declare function noInterrupts(): void;

/** Re-enable interrupts. Maps to \`interrupts()\`. */
export declare function interrupts(): void;

/** Attach an interrupt handler to a pin. Maps to \`attachInterrupt()\`. */
export declare function attachInterrupt(pin: number, handler: InterruptHandler, mode: InterruptMode): void;

/** Detach an interrupt handler from a pin. Maps to \`detachInterrupt()\`. */
export declare function detachInterrupt(pin: number): void;
`;
}

// ---------------------------------------------------------------------------
// src/strategy.ts template
// ---------------------------------------------------------------------------

export function generateStrategyTs(): string {
  return `// ---------------------------------------------------------------------------
// Platform strategy re-export
//
// Most boards use the shared ArduinoStrategy from the framework-arduino package.
// Board packages that need customized emit behavior can extend
// ArduinoStrategy and override specific methods here.
// ---------------------------------------------------------------------------

export { ArduinoStrategy as BoardStrategy } from '@typecode/framework-arduino';
`;
}

// ---------------------------------------------------------------------------
// src/board.ts template
// ---------------------------------------------------------------------------

export function generateBoardTs(options: BoardTemplateOptions): string {
  const { name } = options;
  const className = toPascalCase(name);
  
  return `// ---------------------------------------------------------------------------
// Board namespace facade
//
// Single-import entry point that exposes every board feature under one
// namespace.  User code can simply write:
//
//   import { Board } from '@typecode/board-${name}';
//   Board.LED.high();
//   const serial = Board.UART0.begin(115200);
//   serial.println("Hello");
//   Board.delay(1000);
// ---------------------------------------------------------------------------

import type {
  IDigitalPin,
  IPWMPin,
  IAnalogInput,
  IInterruptPin,
  II2CBus,
  ISPIBus,
  ISerialPort,
  BoardDefinition,
} from '@typecode/core';

import {
  // D0, D1, D2, D3, D4, D5, D6, D7,
  // D8, D9, D10, D11, D12, D13,
  // A0, A1, A2, A3, A4, A5,
  // LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

import { I2C0, SPI0, UART0 } from './peripherals';
import { ${className} } from './index';

// ---------------------------------------------------------------------------
// Type-safe pin collections
// ---------------------------------------------------------------------------

export interface DigitalPins {
  // D0: IDigitalPin & IInterruptPin;
  // D1: IDigitalPin & IInterruptPin;
  // ... add all digital pins
}

export interface AnalogPins {
  // A0: IAnalogInput;
  // A1: IAnalogInput;
  // ... add all analog pins
}

// ---------------------------------------------------------------------------
// Board facade
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Individual pins (uncomment and customize) ------------------------
  // readonly D0: IDigitalPin & IInterruptPin;
  // readonly D1: IDigitalPin & IInterruptPin;
  // ...

  // ---- Aliases ----------------------------------------------------------
  // readonly LED: IDigitalPin;
  // readonly SDA: IAnalogInput;
  // readonly SCL: IAnalogInput;
  // readonly MOSI: IPWMPin;
  // readonly MISO: IDigitalPin;
  // readonly SCK: IDigitalPin;
  // readonly SS: IPWMPin;
  // readonly TX: IDigitalPin & IInterruptPin;
  // readonly RX: IDigitalPin & IInterruptPin;

  // ---- Peripherals ------------------------------------------------------
  readonly I2C0: II2CBus;
  readonly SPI0: ISPIBus;
  readonly UART0: ISerialPort;

  // ---- Pin collections --------------------------------------------------
  readonly digital: DigitalPins;
  readonly analog: AnalogPins;
}

// ---------------------------------------------------------------------------
// Singleton board instance
// ---------------------------------------------------------------------------

/**
 * \`Board\` — the ${options.displayName} expressed as a fully-typed namespace.
 *
 * Every pin, peripheral, and board constant is accessible here with
 * full TypeScript type safety.
 */
export const Board: IBoard = {
  definition: ${className},

  // Pins (uncomment and customize)
  // D0, D1, D2, D3, D4, D5, D6, D7,
  // D8, D9, D10, D11, D12, D13,
  // A0, A1, A2, A3, A4, A5,

  // Aliases (uncomment and customize)
  // LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,

  // Peripherals
  I2C0,
  SPI0,
  UART0,

  // Collections (uncomment and customize)
  digital: { /* D0, D1, ... */ },
  analog:  { /* A0, A1, ... */ },
} as IBoard;

export default Board;
`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
