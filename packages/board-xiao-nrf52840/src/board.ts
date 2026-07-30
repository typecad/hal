// ---------------------------------------------------------------------------
// @typecad/board-xiao-nrf52840 — Board namespace
//
// Convenience namespace exposing board features under one object. For method
// calls on pins, prefer direct imports:
//   import { LED } from '@typecad/board';
//   LED.high();
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

// Pins come from the MCU package (the board adds no D-number remapping — XIAO
// silkscreen names already match). Analog aliases are board-local.
import {
  D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10,
  LED, BUTTON, SDA, SCL, MOSI, MISO, SCK, TX, RX,
} from '@typecad/mcu-nrf52840';
import { A0, A1, A2, A3 } from './pins.js';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.XiaoNRF52840; },

  // XIAO edge pins
  D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10,

  // Analog aliases
  A0, A1, A2, A3,

  // Onboard LED + button
  LED, BUTTON,

  // Default bus pins
  SDA, SCL, MOSI, MISO, SCK, TX, RX,

  // Collections
  digital: { D0, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10 },
  analog: { A0, A1, A2, A3 },
};

export default Board;
