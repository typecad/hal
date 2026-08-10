// ---------------------------------------------------------------------------
// @typecad/board-esp32-devkit — Board namespace
//
// Convenience namespace that exposes every board feature under one object.
// For method calls on pins/peripherals, prefer direct imports:
//
//   import { D2, UART0 } from '@typecad/board-esp32-devkit';
//   D2.high();
//   UART0.begin(115200);
//
// The Board object is useful for pin iteration and metadata access.
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';

import {
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17, D18, D19,
  D21, D22, D23, D25, D26, D27, D32, D33,
  D34, D35, D36, D39,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,
} from './pins.js';

import { I2C0, I2C1, SPI0, SPI1, UART0, UART2 } from '@typecad/mcu-esp32';
import * as boardIndex from './index.js';

export const Board = {
  get definition(): BoardDefinition { return boardIndex.ESP32DevKit; },

  // Output-capable GPIOs
  D0, D1, D2, D3, D4, D5,
  D12, D13, D14, D15, D16, D17, D18, D19,
  D21, D22, D23, D25, D26, D27, D32, D33,

  // Input-only pins
  D34, D35, D36, D39,

  // Analog aliases
  A0, A1, A2, A3, A4, A5,

  // Convenience aliases
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX, TX2, RX2, DAC1, DAC2,

  // Peripherals
  I2C0, I2C1, SPI0, SPI1, UART0, UART2,

  // Collections
  digital: { D0, D1, D2, D3, D4, D5, D12, D13, D14, D15, D16, D17, D18, D19, D21, D22, D23, D25, D26, D27, D32, D33 },
  analog:  { A0, A1, A2, A3, A4, A5 },
};

export default Board;
