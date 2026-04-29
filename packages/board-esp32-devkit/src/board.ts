// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Board namespace
//
// Single-import entry point that exposes every board feature under one
// namespace. User code can simply write:
//
//   import { Board } from '@typehal/board-esp32-devkit/board';
//   Board.D2.high();
//   const serial = Board.UART0.begin(115200);
//   serial.println("Hello");
//   Board.delay(1000);
// ---------------------------------------------------------------------------

import type {
  BasePin,
  PWMPin,
  AnalogPin,
  InterruptPin,
  IUninitializedI2CBus,
  IUninitializedSPIBus,
  IUninitializedUARTBus,
} from '@typehal/core';
import type { BoardDefinition } from '@typehal/schema';
import type { IESP32FullGPIOPin, IESP32InputOnlyPin } from './pin-types';

import {
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17, D18, D19,
  D21, D22, D23, D25, D26, D27, D32, D33,
  D34, D35, D36, D39,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,
} from './pins';

import { I2C0, I2C1, SPI0, SPI1, UART0, UART2 } from './peripherals';
import { ESP32DevKit } from './index';

// ---------------------------------------------------------------------------
// Type-safe pin collections
// ---------------------------------------------------------------------------

export interface DigitalPins {
  D0: IESP32FullGPIOPin;
  D1: IESP32FullGPIOPin;
  D2: IESP32FullGPIOPin;
  D3: IESP32FullGPIOPin;
  D4: IESP32FullGPIOPin;
  D5: IESP32FullGPIOPin;
  D12: IESP32FullGPIOPin;
  D13: IESP32FullGPIOPin;
  D14: IESP32FullGPIOPin;
  D15: IESP32FullGPIOPin;
  D16: IESP32FullGPIOPin;
  D17: IESP32FullGPIOPin;
  D18: IESP32FullGPIOPin;
  D19: IESP32FullGPIOPin;
  D21: IESP32FullGPIOPin;
  D22: IESP32FullGPIOPin;
  D23: IESP32FullGPIOPin;
  D25: IESP32FullGPIOPin;
  D26: IESP32FullGPIOPin;
  D27: IESP32FullGPIOPin;
  D32: IESP32FullGPIOPin;
  D33: IESP32FullGPIOPin;
}

export interface AnalogPins {
  A0: IESP32InputOnlyPin;
  A1: IESP32InputOnlyPin;
  A2: IESP32InputOnlyPin;
  A3: IESP32InputOnlyPin;
  A4: IESP32FullGPIOPin;
  A5: IESP32FullGPIOPin;
}

export interface InputOnlyPins {
  D34: IESP32InputOnlyPin;
  D35: IESP32InputOnlyPin;
  D36: IESP32InputOnlyPin;
  D39: IESP32InputOnlyPin;
}

// ---------------------------------------------------------------------------
// Board facade
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Output-capable GPIO pins ------------------------------------------
  readonly D0: IESP32FullGPIOPin;
  readonly D1: IESP32FullGPIOPin;
  readonly D2: IESP32FullGPIOPin;
  readonly D3: IESP32FullGPIOPin;
  readonly D4: IESP32FullGPIOPin;
  readonly D5: IESP32FullGPIOPin;
  readonly D12: IESP32FullGPIOPin;
  readonly D13: IESP32FullGPIOPin;
  readonly D14: IESP32FullGPIOPin;
  readonly D15: IESP32FullGPIOPin;
  readonly D16: IESP32FullGPIOPin;
  readonly D17: IESP32FullGPIOPin;
  readonly D18: IESP32FullGPIOPin;
  readonly D19: IESP32FullGPIOPin;
  readonly D21: IESP32FullGPIOPin;
  readonly D22: IESP32FullGPIOPin;
  readonly D23: IESP32FullGPIOPin;
  readonly D25: IESP32FullGPIOPin;
  readonly D26: IESP32FullGPIOPin;
  readonly D27: IESP32FullGPIOPin;
  readonly D32: IESP32FullGPIOPin;
  readonly D33: IESP32FullGPIOPin;

  // ---- Input-only pins ---------------------------------------------------
  readonly D34: IESP32InputOnlyPin;
  readonly D35: IESP32InputOnlyPin;
  readonly D36: IESP32InputOnlyPin;
  readonly D39: IESP32InputOnlyPin;

  // ---- Analog aliases ----------------------------------------------------
  readonly A0: IESP32InputOnlyPin;
  readonly A1: IESP32InputOnlyPin;
  readonly A2: IESP32InputOnlyPin;
  readonly A3: IESP32InputOnlyPin;
  readonly A4: IESP32FullGPIOPin;
  readonly A5: IESP32FullGPIOPin;

  // ---- Convenience aliases -----------------------------------------------
  readonly LED: IESP32FullGPIOPin;
  readonly SDA: IESP32FullGPIOPin;
  readonly SCL: IESP32FullGPIOPin;
  readonly MOSI: IESP32FullGPIOPin;
  readonly MISO: IESP32FullGPIOPin;
  readonly SCK: IESP32FullGPIOPin;
  readonly SS: IESP32FullGPIOPin;
  readonly TX: IESP32FullGPIOPin;
  readonly RX: IESP32FullGPIOPin;
  readonly TX2: IESP32FullGPIOPin;
  readonly RX2: IESP32FullGPIOPin;
  readonly DAC1: IESP32FullGPIOPin;
  readonly DAC2: IESP32FullGPIOPin;

  // ---- Peripherals -------------------------------------------------------
  readonly I2C0: IUninitializedI2CBus;
  readonly I2C1: IUninitializedI2CBus;
  readonly SPI0: IUninitializedSPIBus;
  readonly SPI1: IUninitializedSPIBus;
  readonly UART0: IUninitializedUARTBus;
  readonly UART2: IUninitializedUARTBus;

  // ---- Pin collections ---------------------------------------------------
  readonly digital: DigitalPins;
  readonly analog: AnalogPins;
}

// ---------------------------------------------------------------------------
// Singleton board instance
// ---------------------------------------------------------------------------

/**
 * `Board` — the ESP32 DevKit expressed as a fully-typed namespace.
 *
 * Every pin, peripheral, and board constant is accessible here with
 * full TypeScript type safety.
 */
export const Board: IBoard = {
  definition: ESP32DevKit,

  // Output-capable GPIOs
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17, D18, D19,
  D21, D22, D23, D25, D26, D27, D32, D33,

  // Input-only pins
  D34, D35, D36, D39,

  // Analog aliases
  A0, A1, A2, A3, A4, A5,

  // Convenience aliases
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,

  // Peripherals
  I2C0, I2C1, SPI0, SPI1, UART0, UART2,

  // Collections
  digital: { D0, D1, D2, D3, D4, D5, D12, D13, D14, D15, D16, D17, D18, D19, D21, D22, D23, D25, D26, D27, D32, D33 },
  analog:  { A0, A1, A2, A3, A4, A5 },
} as IBoard;

export default Board;
