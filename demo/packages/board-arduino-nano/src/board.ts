// ---------------------------------------------------------------------------
// Board namespace facade
//
// Single-import entry point that exposes every board feature under one
// namespace.  User code can simply write:
//
//   import { Board } from '@typecode/board-arduino-nano';
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
  // D0, D1, D2, D3, D4, D5, D6, D7,
  // D8, D9, D10, D11, D12, D13,
  // A0, A1, A2, A3, A4, A5,
  // LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

import { I2C0, SPI0, UART0 } from './peripherals';
import { ArduinoNano } from './index';

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
 * `Board` — the Arduino Nano expressed as a fully-typed namespace.
 *
 * Every pin, peripheral, and board constant is accessible here with
 * full TypeScript type safety.
 */
export const Board: IBoard = {
  definition: ArduinoNano,

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
