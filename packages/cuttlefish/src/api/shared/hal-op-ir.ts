// ---------------------------------------------------------------------------
// HAL Operation IR — semantic hardware operations
//
// Each HALOpIR node represents a single hardware operation (GPIO write, I2C
// transfer, timing delay, etc.) that the framework strategy translates into
// framework-specific C++.
//
// The transpiler produces these nodes when resolving HAL method calls.
// Framework strategies (ArduinoStrategy, NativeAVRStrategy, etc.) implement
// resolveHALOperation() to map each operation to concrete C++ code.
//
// Pin-carrying operations include an optional `port` field for the MCU
// datasheet port name (e.g. "PB5"). When present, framework strategies
// should prefer the port name and look up the framework pin number via
// the MCU package's pin mapping. The `pin` field provides backward
// compatibility as a legacy framework pin number.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "./display-op-ir.js";

// ---------------------------------------------------------------------------
// GPIO — digital pin control
// ---------------------------------------------------------------------------

export interface GpioWriteOp {
  operation: "gpio.write";
  /** MCU port name (e.g. "PB5") — canonical identity from datasheet */
  port?: string;
  /** Legacy framework pin number */
  pin: number;
  /** 0 = LOW, 1 = HIGH, or a runtime expression string (e.g. "state", "!state") */
  value: 0 | 1 | string;
}

export interface GpioReadOp {
  operation: "gpio.read";
  port?: string;
  pin: number;
}

export interface GpioToggleOp {
  operation: "gpio.toggle";
  port?: string;
  pin: number;
}

export interface GpioSetModeOp {
  operation: "gpio.set_mode";
  port?: string;
  pin: number;
  /** "output" | "input" | "input_pullup" | "input_pulldown" */
  mode: string;
}

// ---------------------------------------------------------------------------
// PWM — pulse-width modulation output
// ---------------------------------------------------------------------------

export interface PwmWriteOp {
  operation: "pwm.write";
  port?: string;
  pin: number;
  /** Duty cycle — numeric value or runtime expression string */
  duty: number | string;
}

export interface PwmGetFrequencyOp {
  operation: "pwm.get_frequency";
  port?: string;
  pin: number;
}

export interface PwmGetResolutionOp {
  operation: "pwm.get_resolution";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// ADC — analog-to-digital conversion
// ---------------------------------------------------------------------------

export interface AdcReadOp {
  operation: "adc.read";
  port?: string;
  pin: number;
}

export interface AdcGetResolutionOp {
  operation: "adc.get_resolution";
}

export interface AdcSetReferenceOp {
  operation: "adc.set_reference";
  /** Reference constant name or numeric value */
  reference: string | number;
}

export interface AdcGetReferenceOp {
  operation: "adc.get_reference";
}

export interface AdcReadVoltageOp {
  operation: "adc.read_voltage";
  port?: string;
  pin: number;
  vRef?: number;
  maxValue?: number;
}

// ---------------------------------------------------------------------------
// DAC — digital-to-analog conversion
// ---------------------------------------------------------------------------

export interface DacWriteOp {
  operation: "dac.write";
  port?: string;
  pin: number;
  /** Output value — numeric or runtime expression string */
  value: number | string;
}

// ---------------------------------------------------------------------------
// Interrupts
// ---------------------------------------------------------------------------

export interface InterruptAttachOp {
  operation: "interrupt.attach";
  port?: string;
  pin: number;
  /** Resolved C++ callback function name */
  handler: string;
  /** "rising" | "falling" | "change" | "high" | "low" */
  mode: string;
}

export interface InterruptDetachOp {
  operation: "interrupt.detach";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// Tone / audio output
// ---------------------------------------------------------------------------

export interface TonePlayOp {
  operation: "tone.play";
  port?: string;
  pin: number;
  /** Frequency in Hz — numeric or runtime expression string */
  frequency: number | string;
  /** Optional duration in milliseconds — numeric or runtime expression string */
  duration?: number | string;
}

export interface ToneStopOp {
  operation: "tone.stop";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface TimingDelayOp {
  operation: "timing.delay";
  ms: number;
}

export interface TimingDelayMicrosecondsOp {
  operation: "timing.delay_microseconds";
  us: number;
}

export interface TimingMillisOp {
  operation: "timing.millis";
}

export interface TimingMicrosOp {
  operation: "timing.micros";
}

export interface TimingFreeHeapOp {
  operation: "timing.free_heap";
}

export interface TimingSetIntervalOp {
  operation: "timing.set_interval";
  /** Resolved C++ callback function name */
  handler: string;
  timeout: number;
}

export interface TimingSetTimeoutOp {
  operation: "timing.set_timeout";
  /** Resolved C++ callback function name */
  handler: string;
  timeout: number;
}

export interface TimingClearIntervalOp {
  operation: "timing.clear_interval";
  id: number;
}

export interface TimingClearTimeoutOp {
  operation: "timing.clear_timeout";
  id: number;
}

// ---------------------------------------------------------------------------
// I2C — inter-integrated circuit bus
// ---------------------------------------------------------------------------

export interface I2cBeginOp {
  operation: "i2c.begin";
  bus: string;
  /** Slave address (only for slave mode) — numeric or runtime expression string */
  address?: number | string;
}

export interface I2cEndOp {
  operation: "i2c.end";
  bus: string;
}

export interface I2cSetClockOp {
  operation: "i2c.set_clock";
  bus: string;
  /** Clock speed in Hz — numeric or runtime expression string */
  hz: number | string;
}

export interface I2cBeginTransmissionOp {
  operation: "i2c.begin_transmission";
  bus: string;
  /** Slave address — numeric or runtime expression string */
  address: number | string;
}

export interface I2cWriteOp {
  operation: "i2c.write";
  bus: string;
  /** Resolved C++ expression for the data to write */
  data: string;
}

export interface I2cWriteBytesOp {
  operation: "i2c.write_bytes";
  bus: string;
  /** Individual byte values — numeric literals or runtime expressions */
  bytes: (number | string)[];
}

export interface I2cWriteBufferOp {
  operation: "i2c.write_buffer";
  bus: string;
  /** C array / buffer variable name */
  data: string;
}

export interface I2cReadBufferOp {
  operation: "i2c.read_buffer";
  bus: string;
  count: number | string;
  /** Buffer variable name, or "__DISCARD__" to read-and-drop */
  buffer: string;
}

export interface I2cEndTransmissionOp {
  operation: "i2c.end_transmission";
  bus: string;
  stop: boolean;
}

export interface I2cRequestFromOp {
  operation: "i2c.request_from";
  bus: string;
  /** Slave address — numeric or runtime expression string */
  address: number | string;
  /** Number of bytes — numeric or runtime expression string */
  quantity: number | string;
  stop: boolean;
}

export interface I2cAvailableOp {
  operation: "i2c.available";
  bus: string;
}

export interface I2cReadOp {
  operation: "i2c.read";
  bus: string;
}

export interface I2cRecoverOp {
  operation: "i2c.recover";
  bus: string;
}

// ---------------------------------------------------------------------------
// SPI — serial peripheral interface bus
// ---------------------------------------------------------------------------

export interface SpiBeginOp {
  operation: "spi.begin";
  bus: string;
}

export interface SpiEndOp {
  operation: "spi.end";
  bus: string;
}

export interface SpiTransferOp {
  operation: "spi.transfer";
  bus: string;
  /** Resolved C++ expression for data to transfer */
  data: string;
}

export interface SpibeginTransactionOp {
  operation: "spi.begin_transaction";
  bus: string;
  /** Resolved C++ SPISettings expression */
  settings: string;
}

export interface SpiEndTransactionOp {
  operation: "spi.end_transaction";
  bus: string;
}

export interface SpiSetFrequencyOp {
  operation: "spi.set_frequency";
  bus: string;
  hz: number;
}

export interface SpiSetModeOp {
  operation: "spi.set_mode";
  bus: string;
  /** SPI mode (0-3) — numeric or runtime expression string */
  mode: number | string;
}

export interface SpiSetBitOrderOp {
  operation: "spi.set_bit_order";
  bus: string;
  /** "lsb" | "msb" */
  order: string;
}

export interface SpiCsLowOp {
  operation: "spi.cs_low";
  port?: string;
  pin: number;
}

export interface SpiCsHighOp {
  operation: "spi.cs_high";
  port?: string;
  pin: number;
}

// ---------------------------------------------------------------------------
// UART — universal asynchronous receiver-transmitter (serial)
// ---------------------------------------------------------------------------

export interface UartBeginOp {
  operation: "uart.begin";
  port: string;
  /** Baud rate — numeric or runtime expression string */
  baud: number | string;
}

export interface UartEndOp {
  operation: "uart.end";
  port: string;
}

export interface UartPrintOp {
  operation: "uart.print";
  port: string;
  /** Resolved C++ expression to print */
  value: string;
}

export interface UartPrintlnOp {
  operation: "uart.println";
  port: string;
  /** Resolved C++ expression to print */
  value: string;
}

export interface UartPrintfOp {
  operation: "uart.printf";
  port: string;
  /** printf format string */
  format: string;
  /** Resolved C++ argument expressions */
  args: string[];
}

export interface UartWriteOp {
  operation: "uart.write";
  port: string;
  /** Resolved C++ expression for data */
  data: string;
}

export interface UartReadOp {
  operation: "uart.read";
  port: string;
}

export interface UartPeekOp {
  operation: "uart.peek";
  port: string;
}

export interface UartAvailableOp {
  operation: "uart.available";
  port: string;
}

export interface UartFlushOp {
  operation: "uart.flush";
  port: string;
}

// ---------------------------------------------------------------------------
// Pulse measurement
// ---------------------------------------------------------------------------

export interface PulseInOp {
  operation: "pulse.in";
  port?: string;
  pin: number;
  /** 0 = LOW, 1 = HIGH */
  value: 0 | 1;
  /** Optional timeout in microseconds */
  timeout?: number;
}

export interface PulseInLongOp {
  operation: "pulse.in_long";
  port?: string;
  pin: number;
  /** 0 = LOW, 1 = HIGH */
  value: 0 | 1;
}

// ---------------------------------------------------------------------------
// Shift register
// ---------------------------------------------------------------------------

export interface ShiftOutOp {
  operation: "shift.out";
  dataPin: number;
  clockPin: number;
  /** "lsb" | "msb" */
  bitOrder: string;
  value: number;
}

export interface ShiftInOp {
  operation: "shift.in";
  dataPin: number;
  clockPin: number;
  /** "lsb" | "msb" */
  bitOrder: string;
}

// ---------------------------------------------------------------------------
// Board constant resolution
// ---------------------------------------------------------------------------

export interface BoardResolveOp {
  operation: "board.resolve";
  /** Dot-separated path into the board definition (e.g. "peripherals.pwm.resolution") */
  path: string;
}

// ---------------------------------------------------------------------------
// Watchdog timer (WDT)
// ---------------------------------------------------------------------------

export interface WdtEnableOp {
  operation: "wdt.enable";
  /** Timeout — a duration string ("250ms"), a WDTO_* constant name, or a number */
  timeout: string | number;
}

export interface WdtResetOp {
  operation: "wdt.reset";
}

export interface WdtDisableOp {
  operation: "wdt.disable";
}

// ---------------------------------------------------------------------------
// Snprintf — formatted string output
// ---------------------------------------------------------------------------

export interface SnprintfEmitOp {
  operation: "snprintf.emit";
  /** Temporary buffer variable name */
  bufferName: string;
  /** printf-style format string */
  format: string;
  /** Resolved C++ argument expressions */
  args: string[];
}

// ---------------------------------------------------------------------------
// Raw C++ passthrough — escape hatch for unsupported operations
// ---------------------------------------------------------------------------

export interface RawCppOp {
  operation: "raw";
  /** Raw C++ code string (framework-agnostic, use sparingly) */
  code: string;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/**
 * HAL Operation IR — a discriminated union of all supported hardware
 * operations. Each node carries a semantic `operation` tag and typed
 * arguments. Framework strategies translate these into concrete C++.
 */
export type HALOpIR =
  // GPIO
  | GpioWriteOp
  | GpioReadOp
  | GpioToggleOp
  | GpioSetModeOp
  // PWM
  | PwmWriteOp
  | PwmGetFrequencyOp
  | PwmGetResolutionOp
  // ADC
  | AdcReadOp
  | AdcGetResolutionOp
  | AdcSetReferenceOp
  | AdcGetReferenceOp
  | AdcReadVoltageOp
  // DAC
  | DacWriteOp
  // Interrupts
  | InterruptAttachOp
  | InterruptDetachOp
  // Tone
  | TonePlayOp
  | ToneStopOp
  // Timing
  | TimingDelayOp
  | TimingDelayMicrosecondsOp
  | TimingMillisOp
  | TimingMicrosOp
  | TimingFreeHeapOp
  | TimingSetIntervalOp
  | TimingSetTimeoutOp
  | TimingClearIntervalOp
  | TimingClearTimeoutOp
  // I2C
  | I2cBeginOp
  | I2cEndOp
  | I2cSetClockOp
  | I2cBeginTransmissionOp
  | I2cWriteOp
  | I2cWriteBytesOp
  | I2cWriteBufferOp
  | I2cReadBufferOp
  | I2cEndTransmissionOp
  | I2cRequestFromOp
  | I2cAvailableOp
  | I2cReadOp
  | I2cRecoverOp
  // SPI
  | SpiBeginOp
  | SpiEndOp
  | SpiTransferOp
  | SpibeginTransactionOp
  | SpiEndTransactionOp
  | SpiSetFrequencyOp
  | SpiSetModeOp
  | SpiSetBitOrderOp
  | SpiCsLowOp
  | SpiCsHighOp
  // UART
  | UartBeginOp
  | UartEndOp
  | UartPrintOp
  | UartPrintlnOp
  | UartPrintfOp
  | UartWriteOp
  | UartReadOp
  | UartPeekOp
  | UartAvailableOp
  | UartFlushOp
  // Pulse
  | PulseInOp
  | PulseInLongOp
  // Shift
  | ShiftOutOp
  | ShiftInOp
  // Board
  | BoardResolveOp
  // Watchdog timer
  | WdtEnableOp
  | WdtResetOp
  | WdtDisableOp
  // Snprintf
  | SnprintfEmitOp
  // Raw passthrough
  | RawCppOp
  // Display / graphics
  | DisplayHALOp;

/**
 * Helper type: extracts the operation string from a HALOpIR variant.
 * Useful for type-safe switch statements in framework strategies.
 */
export type HALOperationKind = HALOpIR["operation"];
