// ---------------------------------------------------------------------------
// @typecad/board-nano-33-iot — Pin aliases
// ---------------------------------------------------------------------------

import {
  PA2, PA4, PA5, PA6, PA7, PA9, PA10, PA11, PA17,
  PA16, PA18, PA19, PA20, PA21,
  PB2, PB3, PB8, PB9, PB10, PB11, PB22, PB23,
} from '@typecad/mcu-samd21';
import { USBSerialPort } from '@typecad/hal';

// Board-fixed alias
export const LED = PA17;  // D13, onboard user LED (active-high)

// Ax analog aliases — matching the Arduino core's analogInputPin table
// (A0=PA2, A1=PB2, A2=PA11, A3=PA10, A4=PB8, A5=PB9, A6=PA9, A7=PB3).
export const A0 = PA2;
export const A1 = PB2;
export const A2 = PA11;
export const A3 = PA10;
export const A4 = PB8;
export const A5 = PB9;
export const A6 = PA9;
export const A7 = PB3;

// Dx digital aliases — the Arduino nano header pin map (Zephyr's
// arduino_nano_connector.dtsi).
export const D0  = PB23;  // UART RX
export const D1  = PB22;  // UART TX
export const D2  = PB10;
export const D3  = PB11;
export const D4  = PA7;
export const D5  = PA5;
export const D6  = PA4;
export const D7  = PA6;
export const D8  = PA18;
export const D9  = PA20;
export const D10 = PA21;  // SPI CS
export const D11 = PA16;  // SPI MOSI
export const D12 = PA19;  // SPI MISO
export const D13 = PA17;  // SPI SCK + user LED

// Bus aliases
export { I2C0, SPI0, UART0 } from '@typecad/mcu-samd21';

// USB CDC serial over the micro-USB connector (the SAMD21 USB peripheral on
// PA24/PA25). Board-level instance — the connector is board wiring, not
// silicon, so it lives here rather than in the MCU package.
export const USB0 = new USBSerialPort('USBSerial');
