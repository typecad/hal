// ---------------------------------------------------------------------------
// @typecad/board-arduino-uno — Board namespace
//
// Convenience namespace that exposes every board feature under one object.
// For method calls on pins/peripherals, prefer direct imports:
//
//   import { D13, UART0 } from '@typecad/board-arduino-uno';
//   D13.high();
//   UART0.begin(115200);
//
// The Board object is useful for pin iteration and metadata access.
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
} from './pins.js';

import { I2C0, SPI0, UART0 } from '@typecad/mcu-atmega328p';
import * as boardIndex from './index.js';

export const Board = {
  get definition() { return boardIndex.ArduinoUno; },

  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,

  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,

  I2C0, SPI0, UART0,

  digital: { D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13 },
  analog:  { A0, A1, A2, A3, A4, A5 },
};

export default Board;
