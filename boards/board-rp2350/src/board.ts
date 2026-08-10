// ---------------------------------------------------------------------------
// @typecad/board-rp2350 — Board namespace
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22, D23,
  D24, D25, D26, D27, D28, D29, D30, D31, D32, D33,
  A0, A1, A2, A3, A4, A5, A6, A7,
} from './pins.js';

import { I2C0, I2C1, SPI0, SPI1, UART0, UART1 } from '@typecad/mcu-rp2350';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.RP2350Board; },

  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22, D23,
  D24, D25, D26, D27, D28, D29, D30, D31, D32, D33,

  A0, A1, A2, A3, A4, A5, A6, A7,

  I2C0, I2C1, SPI0, SPI1, UART0, UART1,

  digital: { D2, D3, D4, D5, D6, D7, D8, D9, D10, D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22, D23, D24, D25, D26, D27, D28, D29, D30, D31, D32, D33 },
  analog:  { A0, A1, A2, A3, A4, A5, A6, A7 },
};

export default Board;
