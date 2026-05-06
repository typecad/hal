// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Pin exports
//
// Each pin is a Pin instance from @typehal/hal. The transpiler inlines
// method calls (high(), low(), write(), etc.) as direct Arduino C++.
// Pin numbers match the Arduino digital/analog pin numbering.
// ---------------------------------------------------------------------------

import { Pin } from '@typehal/hal';

// ---------------------------------------------------------------------------
// Digital-only pins (no PWM, no interrupt)
// ---------------------------------------------------------------------------

export const D4  = new Pin(4);
export const D7  = new Pin(7);
export const D8  = new Pin(8);
export const D12 = new Pin(12);
export const D13 = new Pin(13);  // onboard LED

// ---------------------------------------------------------------------------
// Interrupt-capable digital pins (INT0 on D2, INT1 on D3)
// ---------------------------------------------------------------------------

export const D0 = new Pin(0);   // RX
export const D1 = new Pin(1);   // TX
export const D2 = new Pin(2);

// ---------------------------------------------------------------------------
// PWM pins
// ---------------------------------------------------------------------------

export const D3  = new Pin(3);    // also INT1
export const D5  = new Pin(5);
export const D6  = new Pin(6);
export const D9  = new Pin(9);
export const D10 = new Pin(10);
export const D11 = new Pin(11);

// ---------------------------------------------------------------------------
// Analog input pins (also support digital I/O)
// ---------------------------------------------------------------------------

export const A0 = new Pin(14);
export const A1 = new Pin(15);
export const A2 = new Pin(16);
export const A3 = new Pin(17);
export const A4 = new Pin(18);  // SDA
export const A5 = new Pin(19);  // SCL

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

/** On-board LED (D13). */
export const LED  = D13;

/** I2C data line (A4). */
export const SDA  = A4;
/** I2C clock line (A5). */
export const SCL  = A5;

/** SPI master-out / slave-in (D11). */
export const MOSI = D11;
/** SPI master-in / slave-out (D12). */
export const MISO = D12;
/** SPI clock (D13). */
export const SCK  = D13;
/** SPI slave select (D10). */
export const SS   = D10;

/** UART transmit (D1). */
export const TX   = D1;
/** UART receive (D0). */
export const RX   = D0;
