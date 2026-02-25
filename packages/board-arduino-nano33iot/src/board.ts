// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Board namespace
//
// Single-import entry point that exposes every board feature under one
// namespace.  User code can simply write:
//
//   import { Board } from '@typecode/board-arduino-nano33iot';
//   Board.LED.high();
//   Board.Serial.println("Hello NANO 33 IoT");
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
  A0, A1, A2, A3, A4, A5, A6, A7,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins';

import { I2C0, SPI0, Serial } from './peripherals';
import { delay, millis, micros, delayMicroseconds } from './timing';
import { ArduinoNano33IoT } from './index';

// ---------------------------------------------------------------------------
// Type-safe pin collection interfaces
// ---------------------------------------------------------------------------

export interface DigitalPins {
  D0:  IDigitalPin & IInterruptPin;
  D1:  IDigitalPin & IInterruptPin;
  D2:  IPWMPin & IInterruptPin;
  D3:  IPWMPin & IInterruptPin;
  D4:  IPWMPin & IInterruptPin;
  D5:  IPWMPin & IInterruptPin;
  D6:  IPWMPin & IInterruptPin;
  D7:  IPWMPin & IInterruptPin;
  D8:  IPWMPin & IInterruptPin;
  D9:  IPWMPin & IInterruptPin;
  D10: IPWMPin & IInterruptPin;
  D11: IPWMPin & IInterruptPin;
  D12: IDigitalPin & IInterruptPin;
  D13: IDigitalPin;
}

export interface AnalogPins {
  A0: IAnalogInput;
  A1: IAnalogInput;
  A2: IAnalogInput;
  A3: IAnalogInput;
  A4: IAnalogInput;
  A5: IAnalogInput;
  A6: IAnalogInput;
  A7: IAnalogInput;
}

// ---------------------------------------------------------------------------
// Board facade interface
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Digital pins -------------------------------------------------------
  readonly D0:  IDigitalPin & IInterruptPin;
  readonly D1:  IDigitalPin & IInterruptPin;
  readonly D2:  IPWMPin & IInterruptPin;
  readonly D3:  IPWMPin & IInterruptPin;
  readonly D4:  IPWMPin & IInterruptPin;
  readonly D5:  IPWMPin & IInterruptPin;
  readonly D6:  IPWMPin & IInterruptPin;
  readonly D7:  IPWMPin & IInterruptPin;
  readonly D8:  IPWMPin & IInterruptPin;
  readonly D9:  IPWMPin & IInterruptPin;
  readonly D10: IPWMPin & IInterruptPin;
  readonly D11: IPWMPin & IInterruptPin;
  readonly D12: IDigitalPin & IInterruptPin;
  readonly D13: IDigitalPin;

  // ---- Analog pins --------------------------------------------------------
  readonly A0: IAnalogInput;
  readonly A1: IAnalogInput;
  readonly A2: IAnalogInput;
  readonly A3: IAnalogInput;
  readonly A4: IAnalogInput;
  readonly A5: IAnalogInput;
  readonly A6: IAnalogInput;
  readonly A7: IAnalogInput;

  // ---- Named aliases ------------------------------------------------------
  readonly LED:  IDigitalPin;
  readonly SDA:  IAnalogInput;
  readonly SCL:  IAnalogInput;
  readonly MOSI: IPWMPin & IInterruptPin;
  readonly MISO: IDigitalPin & IInterruptPin;
  readonly SCK:  IDigitalPin;
  readonly SS:   IPWMPin & IInterruptPin;
  readonly TX:   IDigitalPin & IInterruptPin;
  readonly RX:   IDigitalPin & IInterruptPin;

  // ---- Peripherals --------------------------------------------------------
  readonly I2C0:   II2CBus;
  readonly SPI0:   ISPIBus;
  readonly Serial: ISerialPort;

  // ---- Pin collections ----------------------------------------------------
  readonly digital: DigitalPins;
  readonly analog:  AnalogPins;

  // ---- Timing helpers -----------------------------------------------------
  delay(ms: number): void;
  millis(): number;
  micros(): number;
  delayMicroseconds(us: number): void;
}

// ---------------------------------------------------------------------------
// Singleton board instance
// ---------------------------------------------------------------------------

/**
 * `Board` — the Arduino NANO 33 IoT expressed as a fully-typed namespace.
 *
 * Every pin, peripheral, and board constant is accessible through this
 * object with full TypeScript type safety.
 *
 * @example
 * import { Board } from '@typecode/board-arduino-nano33iot';
 *
 * function setup(): void {
 *   Board.Serial.begin(115200);
 * }
 *
 * function loop(): void {
 *   Board.LED.high();
 *   Board.delay(500);
 *   Board.LED.low();
 *   Board.delay(500);
 * }
 */
export const Board: IBoard = {
  definition: ArduinoNano33IoT,

  // Pins
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5, A6, A7,

  // Aliases
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,

  // Peripherals
  I2C0,
  SPI0,
  Serial,

  // Collections
  digital: { D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13 },
  analog:  { A0, A1, A2, A3, A4, A5, A6, A7 },

  // Timing
  delay, millis, micros, delayMicroseconds,
} as IBoard;

export default Board;
