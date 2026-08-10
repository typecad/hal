// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Board namespace
//
// Convenience namespace that exposes every board feature under one object.
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21,
  A0, A1, A2, A3, A4,
} from './pins.js';

import { I2C0, SPI0, UART0, UART1 } from '@typecad/mcu-esp32c3';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.ESP32C3Board; },

  // Common digital pins (strapping/USB pins omitted from the convenience namespace)
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21,

  // Analog aliases
  A0, A1, A2, A3, A4,

  // Peripherals
  I2C0, SPI0, UART0, UART1,

  // Collections
  digital: { D2, D3, D4, D5, D6, D7, D8, D9, D10, D12, D13, D14, D15, D16, D17, D18, D19, D20, D21 },
  analog:  { A0, A1, A2, A3, A4 },
};

export default Board;
