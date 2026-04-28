// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Board namespace
//
// Single-import entry point that exposes every board feature under one
// namespace.  User code can simply write:
//
//   import { Board } from './code/board-arduino-uno/board';
//   Board.LED.high();
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
import type { BoardDefinition } from '@typehal/hal';

import {
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

import { I2C0, SPI0, UART0 } from './peripherals';
import { ArduinoUno } from './index';

// ---------------------------------------------------------------------------
// Type-safe pin collections
// ---------------------------------------------------------------------------

export interface DigitalPins {
  D0: BasePin & InterruptPin;
  D1: BasePin & InterruptPin;
  D2: BasePin & InterruptPin;
  D3: PWMPin;
  D4: BasePin;
  D5: PWMPin;
  D6: PWMPin;
  D7: BasePin;
  D8: BasePin;
  D9: PWMPin;
  D10: PWMPin;
  D11: PWMPin;
  D12: BasePin;
  D13: BasePin;
}

export interface AnalogPins {
  A0: AnalogPin;
  A1: AnalogPin;
  A2: AnalogPin;
  A3: AnalogPin;
  A4: AnalogPin;
  A5: AnalogPin;
}

// ---------------------------------------------------------------------------
// Board facade
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Individual pins (convenience) ------------------------------------
  readonly D0: BasePin & InterruptPin;
  readonly D1: BasePin & InterruptPin;
  readonly D2: BasePin & InterruptPin;
  readonly D3: PWMPin;
  readonly D4: BasePin;
  readonly D5: PWMPin;
  readonly D6: PWMPin;
  readonly D7: BasePin;
  readonly D8: BasePin;
  readonly D9: PWMPin;
  readonly D10: PWMPin;
  readonly D11: PWMPin;
  readonly D12: BasePin;
  readonly D13: BasePin;

  readonly A0: AnalogPin;
  readonly A1: AnalogPin;
  readonly A2: AnalogPin;
  readonly A3: AnalogPin;
  readonly A4: AnalogPin;
  readonly A5: AnalogPin;

  // ---- Aliases ----------------------------------------------------------
  readonly LED: BasePin;
  readonly SDA: AnalogPin;
  readonly SCL: AnalogPin;
  readonly MOSI: PWMPin;
  readonly MISO: BasePin;
  readonly SCK: BasePin;
  readonly SS: PWMPin;
  readonly TX: BasePin & InterruptPin;
  readonly RX: BasePin & InterruptPin;

  // ---- Peripherals ------------------------------------------------------
  readonly I2C0: IUninitializedI2CBus;
  readonly SPI0: IUninitializedSPIBus;
  readonly UART0: IUninitializedUARTBus;

  // ---- Pin collections --------------------------------------------------
  readonly digital: DigitalPins;
  readonly analog: AnalogPins;
}

// ---------------------------------------------------------------------------
// Singleton board instance
// ---------------------------------------------------------------------------

/**
 * `Board` — the Arduino Uno expressed as a fully-typed namespace.
 *
 * Every pin, peripheral, and board constant is accessible here with
 * full TypeScript type safety.
 */
export const Board: IBoard = {
  definition: ArduinoUno,

  // Pins
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,

  // Aliases
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,

  // Peripherals
  I2C0,
  SPI0,
  UART0,

  // Collections
  digital: { D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13 },
  analog:  { A0, A1, A2, A3, A4, A5 },
} as IBoard;

export default Board;
