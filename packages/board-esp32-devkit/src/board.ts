// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Board namespace
//
// Single-import entry point that exposes every board feature under one
// namespace.  Example usage:
//
//   import { Board } from '@typecode/board-esp32-devkit';
//
//   Board.LED.high();
//   Board.Serial.println("Hello ESP32");
//   Board.delay(500);
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
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17,
  D18, D19, D21, D22, D23,
  D25, D26, D27, D32, D33,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,
} from './pins';

import { I2C0, SPI0, Serial, Serial2 } from './peripherals';
import { Esp32DevKit } from './index';

// ---------------------------------------------------------------------------
// Type-safe pin collections
// ---------------------------------------------------------------------------

export interface DigitalPins {
  D0:  IAnalogInput & IPWMPin & IInterruptPin;
  D1:  IDigitalPin & IInterruptPin;
  D2:  IAnalogInput & IPWMPin & IInterruptPin;
  D3:  IDigitalPin & IInterruptPin;
  D4:  IAnalogInput & IPWMPin & IInterruptPin;
  D5:  IPWMPin & IInterruptPin;
  D12: IAnalogInput & IPWMPin & IInterruptPin;
  D13: IAnalogInput & IPWMPin & IInterruptPin;
  D14: IAnalogInput & IPWMPin & IInterruptPin;
  D15: IAnalogInput & IPWMPin & IInterruptPin;
  D16: IPWMPin & IInterruptPin;
  D17: IPWMPin & IInterruptPin;
  D18: IPWMPin & IInterruptPin;
  D19: IPWMPin & IInterruptPin;
  D21: IPWMPin & IInterruptPin;
  D22: IPWMPin & IInterruptPin;
  D23: IPWMPin & IInterruptPin;
  D25: IAnalogInput & IPWMPin & IInterruptPin;
  D26: IAnalogInput & IPWMPin & IInterruptPin;
  D27: IAnalogInput & IPWMPin & IInterruptPin;
  D32: IAnalogInput & IPWMPin & IInterruptPin;
  D33: IAnalogInput & IPWMPin & IInterruptPin;
}

export interface AnalogPins {
  A0: IAnalogInput;
  A1: IAnalogInput;
  A2: IAnalogInput;
  A3: IAnalogInput;
  A4: IAnalogInput & IPWMPin & IInterruptPin;
  A5: IAnalogInput & IPWMPin & IInterruptPin;
}

// ---------------------------------------------------------------------------
// Board facade interface
// ---------------------------------------------------------------------------

export interface IBoard {
  /** Board definition manifest (read-only metadata). */
  readonly definition: BoardDefinition;

  // ---- Individual pins ---------------------------------------------------
  readonly D0:  IAnalogInput & IPWMPin & IInterruptPin;
  readonly D1:  IDigitalPin & IInterruptPin;
  readonly D2:  IAnalogInput & IPWMPin & IInterruptPin;
  readonly D3:  IDigitalPin & IInterruptPin;
  readonly D4:  IAnalogInput & IPWMPin & IInterruptPin;
  readonly D5:  IPWMPin & IInterruptPin;
  readonly D12: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D13: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D14: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D15: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D16: IPWMPin & IInterruptPin;
  readonly D17: IPWMPin & IInterruptPin;
  readonly D18: IPWMPin & IInterruptPin;
  readonly D19: IPWMPin & IInterruptPin;
  readonly D21: IPWMPin & IInterruptPin;
  readonly D22: IPWMPin & IInterruptPin;
  readonly D23: IPWMPin & IInterruptPin;
  readonly D25: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D26: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D27: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D32: IAnalogInput & IPWMPin & IInterruptPin;
  readonly D33: IAnalogInput & IPWMPin & IInterruptPin;

  readonly A0: IAnalogInput;
  readonly A1: IAnalogInput;
  readonly A2: IAnalogInput;
  readonly A3: IAnalogInput;
  readonly A4: IAnalogInput & IPWMPin & IInterruptPin;
  readonly A5: IAnalogInput & IPWMPin & IInterruptPin;

  // ---- Aliases -----------------------------------------------------------
  readonly LED:  IAnalogInput & IPWMPin & IInterruptPin;  // GPIO 2
  readonly SDA:  IPWMPin & IInterruptPin;                 // GPIO 21
  readonly SCL:  IPWMPin & IInterruptPin;                 // GPIO 22
  readonly MOSI: IPWMPin & IInterruptPin;                 // GPIO 23
  readonly MISO: IPWMPin & IInterruptPin;                 // GPIO 19
  readonly SCK:  IPWMPin & IInterruptPin;                 // GPIO 18
  readonly SS:   IPWMPin & IInterruptPin;                 // GPIO 5
  readonly TX:   IDigitalPin & IInterruptPin;             // GPIO 1
  readonly RX:   IDigitalPin & IInterruptPin;             // GPIO 3
  readonly TX2:  IPWMPin & IInterruptPin;                 // GPIO 17
  readonly RX2:  IPWMPin & IInterruptPin;                 // GPIO 16
  readonly DAC1: IAnalogInput & IPWMPin & IInterruptPin;  // GPIO 25
  readonly DAC2: IAnalogInput & IPWMPin & IInterruptPin;  // GPIO 26

  // ---- Peripherals -------------------------------------------------------
  readonly I2C0:   II2CBus;
  readonly SPI0:   ISPIBus;
  readonly Serial:  ISerialPort;
  readonly Serial2: ISerialPort;

  // ---- Pin collections ---------------------------------------------------
  readonly digital: DigitalPins;
  readonly analog:  AnalogPins;
}

// ---------------------------------------------------------------------------
// Singleton board instance
// ---------------------------------------------------------------------------

/**
 * `Board` — the ESP32 DevKit V1 expressed as a fully-typed namespace.
 *
 * Every pin, peripheral and board constant is accessible here with full
 * TypeScript type safety.
 */
export const Board: IBoard = {
  definition: Esp32DevKit,

  // Pins
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17,
  D18, D19, D21, D22, D23,
  D25, D26, D27, D32, D33,
  A0, A1, A2, A3, A4, A5,

  // Aliases
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,

  // Peripherals
  I2C0,
  SPI0,
  Serial,
  Serial2,

  // Collections
  digital: {
    D0, D1, D2, D3, D4, D5,
    D12, D13, D14, D15, D16, D17,
    D18, D19, D21, D22, D23,
    D25, D26, D27, D32, D33,
  },
  analog: { A0, A1, A2, A3, A4, A5 },
} as IBoard;

export default Board;
