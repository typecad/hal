// ---------------------------------------------------------------------------
// @typecad/hal — Public type definitions
//
// Transpiler-shim type surface: value aliases and the enums consumed by the
// HAL's transpiler-shim classes (Pin, GPIO, I2CBus/SPIBus) and re-exported
// for downstream type-checking.
//
// Runtime-contract interfaces (BasePin, II2CBus, ISPIBus, ISerialPort, the
// status enums, capability guards, and the legacy Wire/SPI protocol-shape
// types I2CAddress/SPIMode/SPIBitOrder/SPISettings) live in
// src/sim/contracts.ts — they describe the runtime objects the simulator
// implements, not the transpiler shims that live here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Digital/analog value types
// ---------------------------------------------------------------------------

/** A digital value is a plain boolean. */
export type DigitalValue = boolean;

/** An analog value is a plain number (resolution-dependent). */
export type AnalogValue = number;

// ---------------------------------------------------------------------------
// Serial write value
// ---------------------------------------------------------------------------

/** A value a serial port (UART / USB console) can write: text, a number, or
 *  a boolean. Numbers format as decimal (integer + trimmed fractional);
 *  booleans print as 1/0. */
export type SerialValue = string | number | boolean;

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
// Interrupt handler type
// ---------------------------------------------------------------------------

export type InterruptHandler = () => void;

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

