// ---------------------------------------------------------------------------
// @typecad/board-rp2040 — Board namespace
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22,
  D26, D27, D28,
  A0, A1, A2,
} from './pins.js';

import { I2C0, I2C1, SPI0, SPI1, UART0, UART1 } from '@typecad/mcu-rp2040';
import { RP2040Board } from './index.js';

export const Board = {
  definition: RP2040Board,

  D2, D3, D4, D5, D6, D7, D8, D9, D10,
  D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22,
  D26, D27, D28,

  A0, A1, A2,

  I2C0, I2C1, SPI0, SPI1, UART0, UART1,

  digital: { D2, D3, D4, D5, D6, D7, D8, D9, D10, D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22, D26, D27, D28 },
  analog:  { A0, A1, A2 },
};

export default Board;
