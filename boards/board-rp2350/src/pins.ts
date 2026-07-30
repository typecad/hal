// ---------------------------------------------------------------------------
// @typecad/board-rp2350 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7,
  GP8, GP9, GP10, GP11, GP12, GP13, GP14, GP15,
  GP16, GP17, GP18, GP19, GP20, GP21, GP22, GP23,
  GP24, GP25, GP26, GP27, GP28, GP29, GP30, GP31,
  GP32, GP33,
} from '@typecad/mcu-rp2350';

// Dx aliases (all 48 GP, but only importing the safe/non-unsafe subset)
export const D0 = GP0;
export const D1 = GP1;
export const D2 = GP2;
export const D3 = GP3;
export const D4 = GP4;
export const D5 = GP5;
export const D6 = GP6;
export const D7 = GP7;
export const D8 = GP8;
export const D9 = GP9;
export const D10 = GP10;
export const D11 = GP11;
export const D12 = GP12;
export const D13 = GP13;
export const D14 = GP14;
export const D15 = GP15;
export const D16 = GP16;
export const D17 = GP17;
export const D18 = GP18;
export const D19 = GP19;
export const D20 = GP20;
export const D21 = GP21;
export const D22 = GP22;
export const D23 = GP23;
export const D24 = GP24;
export const D25 = GP25;
export const D26 = GP26;
export const D27 = GP27;
export const D28 = GP28;
export const D29 = GP29;
export const D30 = GP30;
export const D31 = GP31;
export const D32 = GP32;
export const D33 = GP33;

// Ax aliases (ADC channels — GP26-GP33 = 8 channels)
export const A0 = GP26;
export const A1 = GP27;
export const A2 = GP28;
export const A3 = GP29;
export const A4 = GP30;
export const A5 = GP31;
export const A6 = GP32;
export const A7 = GP33;

// Bus aliases
export { I2C0, I2C1, SPI0, SPI1, UART0, UART1 } from '@typecad/mcu-rp2350';
