// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Board namespace
//
// Convenience namespace that exposes every board feature under one object.
// For method calls on pins/peripherals, prefer direct imports:
//
//   import { D2, UART0 } from '@typecad/board-esp32s3';
//   D2.high();
//   UART0.begin(115200);
//
// The Board object is useful for pin iteration and metadata access.
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D1, D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D38, D39, D40, D41, D42, D43, D44, D45, D46, D47, D48,
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9,
  LED,
} from './pins.js';

import { I2C0, I2C1, SPI0, SPI1, UART0, UART1, UART2 } from '@typecad/mcu-esp32s3';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.ESP32S3Board; },

  // Common digital pins (strapping/flash/USB pins omitted from the convenience namespace)
  D1, D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D38, D39, D40, D41, D42, D43, D44, D45, D46, D47, D48,

  // Analog aliases
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9,

  // Convenience aliases
  LED,

  // Peripherals
  I2C0, I2C1, SPI0, SPI1, UART0, UART1, UART2,

  // Collections
  digital: { D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D38, D39, D40, D41, D42, D43, D44, D45, D46, D47, D48 },
  analog:  { A0, A1, A2, A3, A4, A5, A6, A7, A8, A9 },
};

export default Board;
