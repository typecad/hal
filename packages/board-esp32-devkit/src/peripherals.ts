// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Peripheral instances
//
// Ambient declarations for the board's built-in peripheral buses.
// These carry full type information at design-time so TypeScript prevents
// invalid usage. The transpiler replaces method calls with the
// architecture-specific C++ (Wire, SPI, Serial libraries).
//
// ESP32 DevKit peripherals:
//   - I2C0  (Wire)  on pins D21/D22
//   - I2C1           no fixed pins (remappable)
//   - SPI0  (HSPI)   on pins D13/D12/D14/D15
//   - SPI1  (VSPI)   on pins D23/D19/D18/D5
//   - UART0 (Serial) on pins D1/D3 (USB serial)
//   - UART2 (Serial2) on pins D17/D16
//
// NOTE: UART1 is NOT exported because its default pins (GPIO9/10) are
// connected to internal flash. UART1 can be remapped at runtime but no
// fixed-pin stub is provided to avoid misleading defaults.
// ---------------------------------------------------------------------------

import type {
  IUninitializedI2CBus,
  IUninitializedSPIBus,
  IUninitializedUARTBus,
} from '@typehal/core';

/** I2C bus 0 (Wire library, pins D21=SDA / D22=SCL). Starts uninitialized. */
export declare const I2C0: IUninitializedI2CBus;

/** I2C bus 1 (no fixed default pins — remap via Wire1.begin(SDA, SCL)). Starts uninitialized. */
export declare const I2C1: IUninitializedI2CBus;

/** SPI bus 0 / HSPI (pins D13=MOSI, D12=MISO, D14=SCK, D15=CS). Starts uninitialized. */
export declare const SPI0: IUninitializedSPIBus;

/** SPI bus 1 / VSPI (pins D23=MOSI, D19=MISO, D18=SCK, D5=CS). Starts uninitialized. */
export declare const SPI1: IUninitializedSPIBus;

/** Hardware serial 0 / UART0 (pins D1=TX, D3=RX, USB-CDC). Starts uninitialized. */
export declare const UART0: IUninitializedUARTBus;

/** Hardware serial 2 / UART2 (pins D17=TX, D16=RX). Starts uninitialized. */
export declare const UART2: IUninitializedUARTBus;
