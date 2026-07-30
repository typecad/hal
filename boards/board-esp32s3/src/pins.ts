// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43, GPIO44,
  GPIO45, GPIO46, GPIO47, GPIO48,
} from '@typecad/mcu-esp32s3';

// ---------------------------------------------------------------------------
// Arduino-style digital pin aliases (D-numbers match GPIO numbers on ESP32-S3)
// ---------------------------------------------------------------------------

export const D0  = GPIO0;   export const D1  = GPIO1;   export const D2  = GPIO2;
export const D3  = GPIO3;   export const D4  = GPIO4;   export const D5  = GPIO5;
export const D6  = GPIO6;   export const D7  = GPIO7;   export const D8  = GPIO8;
export const D9  = GPIO9;   export const D10 = GPIO10;  export const D11 = GPIO11;
export const D12 = GPIO12;  export const D13 = GPIO13;  export const D14 = GPIO14;
export const D15 = GPIO15;  export const D16 = GPIO16;  export const D17 = GPIO17;
export const D18 = GPIO18;  export const D19 = GPIO19;  export const D20 = GPIO20;
export const D21 = GPIO21;
export const D38 = GPIO38;  export const D39 = GPIO39;  export const D40 = GPIO40;
export const D41 = GPIO41;  export const D42 = GPIO42;  export const D43 = GPIO43;
export const D44 = GPIO44;  export const D45 = GPIO45;  export const D46 = GPIO46;
export const D47 = GPIO47;  export const D48 = GPIO48;

// ---------------------------------------------------------------------------
// Analog input aliases (ADC1 channels — usable while Wi-Fi is active).
// ADC2 pins (GPIO11-GPIO20) are omitted from Ax aliases because they are
// unusable while Wi-Fi is enabled.
// ---------------------------------------------------------------------------

export const A0 = GPIO1;
export const A1 = GPIO2;
export const A2 = GPIO3;
export const A3 = GPIO4;
export const A4 = GPIO5;
export const A5 = GPIO6;
export const A6 = GPIO7;
export const A7 = GPIO8;
export const A8 = GPIO9;
export const A9 = GPIO10;

// ---------------------------------------------------------------------------
// Board-specific aliases
// ---------------------------------------------------------------------------

/** On-board LED (GPIO48 — addressable RGB on most S3 dev modules). */
export const LED = GPIO48;

// Bus aliases (default pins for I2C0 / SPI0 / UART0)
export { I2C0, I2C1, SPI0, SPI1, UART0, UART1, UART2 } from '@typecad/mcu-esp32s3';
