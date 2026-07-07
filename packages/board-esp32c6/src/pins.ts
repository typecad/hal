// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27,
} from '@typecad/mcu-esp32c6';

// ---------------------------------------------------------------------------
// Arduino-style digital pin aliases (D-numbers match GPIO numbers on ESP32-C6)
// GPIO28-30 (SPI flash) are omitted from Dx aliases — they're unsafe.
// ---------------------------------------------------------------------------

export const D0  = GPIO0;   export const D1  = GPIO1;   export const D2  = GPIO2;
export const D3  = GPIO3;   export const D4  = GPIO4;   export const D5  = GPIO5;
export const D6  = GPIO6;   export const D7  = GPIO7;   export const D8  = GPIO8;
export const D9  = GPIO9;   export const D10 = GPIO10;  export const D11 = GPIO11;
export const D12 = GPIO12;  export const D13 = GPIO13;  export const D14 = GPIO14;
export const D15 = GPIO15;  export const D16 = GPIO16;  export const D17 = GPIO17;
export const D18 = GPIO18;  export const D19 = GPIO19;  export const D20 = GPIO20;
export const D21 = GPIO21;  export const D22 = GPIO22;  export const D23 = GPIO23;
export const D24 = GPIO24;  export const D25 = GPIO25;  export const D26 = GPIO26;
export const D27 = GPIO27;

// ---------------------------------------------------------------------------
// Analog input aliases (ADC1 channels — usable while Wi-Fi is active).
// ADC2 pin (GPIO7) is omitted from Ax aliases because it is unusable while
// Wi-Fi is enabled.
// ---------------------------------------------------------------------------

export const A0 = GPIO0;
export const A1 = GPIO1;
export const A2 = GPIO2;
export const A3 = GPIO3;
export const A4 = GPIO4;
export const A5 = GPIO5;
export const A6 = GPIO6;

// Bus aliases (default pins for I2C0 / SPI0 / UART0)
export { I2C0, SPI0, UART0, UART1 } from '@typecad/mcu-esp32c6';
