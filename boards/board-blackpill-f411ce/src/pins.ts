// ---------------------------------------------------------------------------
// @typecad/board-blackpill-f411ce — Pin aliases
// ---------------------------------------------------------------------------

import {
  PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7,
  PB0, PB1, PC13,
} from '@typecad/mcu-stm32f411';

// Board-fixed aliases
export const LED    = PC13;  // onboard user LED (active-low)
export const BUTTON = PA0;   // KEY button (active-low + pull-up)

// Ax analog aliases (ADC1 IN0–IN9, matching the stm32duino analogInputPin
// table for this board).
export const A0 = PA0;
export const A1 = PA1;
export const A2 = PA2;
export const A3 = PA3;
export const A4 = PA4;
export const A5 = PA5;
export const A6 = PA6;
export const A7 = PA7;
export const A8 = PB0;
export const A9 = PB1;

// Bus aliases
export { I2C0, I2C1, I2C2, SPI0, SPI1, SPI2, UART0, UART1, UART2 } from '@typecad/mcu-stm32f411';
