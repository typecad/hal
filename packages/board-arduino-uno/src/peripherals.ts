// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Peripheral instances
//
// Ambient declarations for the board's built-in peripheral buses.
// These carry full type information at design-time so TypeScript prevents
// invalid usage.  The transpiler replaces method calls with the
// architecture-specific C++ (Wire, SPI, Serial libraries).
//
// NOTE: Arduino Uno only has ONE of each peripheral:
//   - I2C0 (Wire) on pins A4/A5
//   - SPI0 (SPI) on pins D11/D12/D13
//   - UART0 (Serial) on pins D0/D1 + USB
//
// Using I2C1, I2C2, SPI1, UART1, etc. will result in a transpile error.
//
// INITIALIZATION STATE:
//   Peripherals start as IUninitialized*Bus. Call .begin() to get the
//   initialized interface with full device access.
// ---------------------------------------------------------------------------

import type {
  IUninitializedI2CBus,
  IUninitializedSPIBus,
  IUninitializedUARTBus,
} from '@typecode/core';

/** I2C bus 0 (Wire library, pins A4=SDA / A5=SCL). Starts uninitialized. */
export declare const I2C0: IUninitializedI2CBus;

/** SPI bus 0 (pins D11=MOSI, D12=MISO, D13=SCK, D10=SS). Starts uninitialized. */
export declare const SPI0: IUninitializedSPIBus;

/** Hardware serial (UART 0, pins D0/RX, D1/TX, + USB). Starts uninitialized. */
export declare const UART0: IUninitializedUARTBus;
