// ---------------------------------------------------------------------------
// @typecad/board-nano-33-iot — Board namespace
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  LED,
  A0, A1, A2, A3, A4, A5, A6, A7,
  D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13,
  USB0,
} from './pins.js';

import { I2C0, SPI0, UART0 } from '@typecad/mcu-samd21';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.Nano33IotBoard; },

  LED,

  A0, A1, A2, A3, A4, A5, A6, A7,
  D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13,

  I2C0, SPI0, UART0,
  USB0,
} as const;
