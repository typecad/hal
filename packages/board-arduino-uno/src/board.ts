// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Board namespace
//
// Single-import entry point that exposes every board feature under one
// namespace.  User code can simply write:
//
//   import { Board } from './code/board-arduino-uno/board';
//   Board.LED.high();
//   Board.UART0.println("Hello");
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
  D0: IDigitalPin & IInterruptPin;
  D1: IDigitalPin & IInterruptPin;
  D2: IDigitalPin & IInterruptPin;
  D3: IPWMPin;
  D4: IDigitalPin;
  D5: IPWMPin;
  D6: IPWMPin;
  D7: IDigitalPin;
  D8: IDigitalPin;
  D9: IPWMPin;
  D10: IPWMPin;
  D11: IPWMPin;
  D12: IDigitalPin;
  D13: IDigitalPin;
}

export interface AnalogPins {
  A0: IAnalogInput;
  A1: IAnalogInput;
  A2: IAnalogInput;
  A3: IAnalogInput;
  A4: IAnalogInput;
  A5: IAnalogInput;
}

// ---------------------------------------------------------------------------
// Board facade
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Individual pins (convenience) ------------------------------------
  readonly D0: IDigitalPin & IInterruptPin;
  readonly D1: IDigitalPin & IInterruptPin;
  readonly D2: IDigitalPin & IInterruptPin;
  readonly D3: IPWMPin;
  readonly D4: IDigitalPin;
  readonly D5: IPWMPin;
  readonly D6: IPWMPin;
  readonly D7: IDigitalPin;
  readonly D8: IDigitalPin;
  readonly D9: IPWMPin;
  readonly D10: IPWMPin;
  readonly D11: IPWMPin;
  readonly D12: IDigitalPin;
  readonly D13: IDigitalPin;

  readonly A0: IAnalogInput;
  readonly A1: IAnalogInput;
  readonly A2: IAnalogInput;
  readonly A3: IAnalogInput;
  readonly A4: IAnalogInput;
  readonly A5: IAnalogInput;

  // ---- Aliases ----------------------------------------------------------
  readonly LED: IDigitalPin;
  readonly SDA: IAnalogInput;
  readonly SCL: IAnalogInput;
  readonly MOSI: IPWMPin;
  readonly MISO: IDigitalPin;
  readonly SCK: IDigitalPin;
  readonly SS: IPWMPin;
  readonly TX: IDigitalPin & IInterruptPin;
  readonly RX: IDigitalPin & IInterruptPin;

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
