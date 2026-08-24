// ---------------------------------------------------------------------------
// @typecad/board-blackpill-f411ce — Board namespace
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  LED, BUTTON,
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9,
} from './pins.js';

import { I2C0, I2C1, I2C2, SPI0, SPI1, SPI2, UART0, UART1, UART2 } from '@typecad/mcu-stm32f411';
import { USB0 } from './pins.js';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.BlackPillF411CEBoard; },

  LED, BUTTON,

  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9,

  I2C0, I2C1, I2C2,
  SPI0, SPI1, SPI2,
  UART0, UART1, UART2,
  USB0,
} as const;
