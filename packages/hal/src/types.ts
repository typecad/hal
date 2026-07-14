// ---------------------------------------------------------------------------
// @typecad/hal — Public type definitions
//
// Transpiler-shim type surface: enums, type aliases, and the pin-group API
// consumed by the HAL's transpiler-shim classes (Pin/OutputPin/InputPin,
// I2CBus/SPIBus/SerialPort) and re-exported for downstream type-checking.
//
// Runtime-contract interfaces (BasePin, II2CBus, ISPIBus, ISerialPort, the
// status enums, capability guards, etc.) have been relocated to
// @typecad/simulator/src/contracts.ts — they describe the runtime objects the
// simulator implements, not the transpiler shims that live here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Digital/analog value types
// ---------------------------------------------------------------------------

/** A digital value is a plain boolean. */
export type DigitalValue = boolean;

/** An analog value is a plain number (resolution-dependent). */
export type AnalogValue = number;

// ---------------------------------------------------------------------------
// Pin mode enum
// ---------------------------------------------------------------------------

export enum PinMode {
  INPUT             = 'INPUT',
  OUTPUT            = 'OUTPUT',
  INPUT_PULLUP      = 'INPUT_PULLUP',
  INPUT_PULLDOWN    = 'INPUT_PULLDOWN',
  OUTPUT_OPEN_DRAIN = 'OUTPUT_OPEN_DRAIN',
  ANALOG            = 'ANALOG',
}

// ---------------------------------------------------------------------------
// Interrupt mode enum
// ---------------------------------------------------------------------------

export enum InterruptMode {
  RISING  = 'RISING',
  FALLING = 'FALLING',
  CHANGE  = 'CHANGE',
  LOW     = 'LOW',
  HIGH    = 'HIGH',
}

// ---------------------------------------------------------------------------
// Interrupt handler type
// ---------------------------------------------------------------------------

export type InterruptHandler = () => void;

// ---------------------------------------------------------------------------
// Pin groups
// ---------------------------------------------------------------------------

export interface PinGroupMember {
  readonly number: number;
  readonly gpio: number;
  write(value: DigitalValue): void;
  high(): void;
  low(): void;
  toggle(): void;
  read(): DigitalValue;
  isHigh(): boolean;
  isLow(): boolean;
}

export interface IPinGroup<T extends PinGroupMember = PinGroupMember> {
  readonly name: string;
  readonly pins: ReadonlyArray<T>;
  writePattern(pattern: number): void;
  readPattern(): number;
  fill(value: DigitalValue): void;
}

export function createPinGroup<T extends PinGroupMember>(
  pins: T[]
): IPinGroup<T> {
  return {
    name: 'PinGroup',
    pins: Object.freeze(pins) as ReadonlyArray<T>,
    writePattern(pattern: number): void {
      for (let i = 0; i < this.pins.length; i++) {
        const bit = (pattern >> i) & 1;
        const pin = this.pins[i];
        if ('write' in pin && typeof pin.write === 'function') {
          pin.write(bit === 1);
        }
      }
    },
    readPattern(): number {
      let value = 0;
      for (let i = 0; i < this.pins.length; i++) {
        const pin = this.pins[i];
        if ('isHigh' in pin && typeof pin.isHigh === 'function' && pin.isHigh()) {
          value |= (1 << i);
        }
      }
      return value;
    },
    fill(value: DigitalValue): void {
      for (const pin of this.pins) {
        if ('write' in pin && typeof pin.write === 'function') {
          pin.write(value);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Architecture identifier
// ---------------------------------------------------------------------------

export type ArchitectureIdentifier =
  | 'avr'
  | 'esp32'
  | 'esp32s2'
  | 'esp32s3'
  | 'esp32c3'
  | 'esp32c6'
  | 'rp2040'
  | 'rp2350'
  | 'samd'
  | 'stm32'
  | 'nrf52'
  | (string & {});

// ---------------------------------------------------------------------------
// Protocol-shape types (re-exported by @typecad/framework-arduino)
// ---------------------------------------------------------------------------

export type I2CAddress = number;

export type SPIBitOrder = 'msb' | 'lsb';
export type SPIMode = 0 | 1 | 2 | 3;

export interface SPISettings {
  frequency: number;
  mode: SPIMode;
  bitOrder: SPIBitOrder;
}
