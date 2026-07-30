// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. The ESP32-C3 has 22 GPIO
// (0-10, 12-21); GPIO 11 is consumed by internal flash Vpp and is not broken
// out. All GPIOs are bidirectional (no input-only pins). DAC is not present.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Named GPIO constants (Pin instances)
// ---------------------------------------------------------------------------

export const GPIO0  = new Pin(0);
export const GPIO1  = new Pin(1);
export const GPIO2  = new Pin(2);
export const GPIO3  = new Pin(3);
export const GPIO4  = new Pin(4);
export const GPIO5  = new Pin(5);
export const GPIO6  = new Pin(6);
export const GPIO7  = new Pin(7);
export const GPIO8  = new Pin(8);
export const GPIO9  = new Pin(9);
export const GPIO10 = new Pin(10);
// GPIO 11 — internal flash Vpp, not broken out on the C3 package.
export const GPIO12 = new Pin(12);
export const GPIO13 = new Pin(13);
export const GPIO14 = new Pin(14);
export const GPIO15 = new Pin(15);
export const GPIO16 = new Pin(16);
export const GPIO17 = new Pin(17);
export const GPIO18 = new Pin(18);
export const GPIO19 = new Pin(19);
export const GPIO20 = new Pin(20);
export const GPIO21 = new Pin(21);

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults — match Arduino-ESP32 core)
// ---------------------------------------------------------------------------

/** I2C0 data line (GPIO8). */
export const SDA = GPIO8;
/** I2C0 clock line (GPIO9). */
export const SCL = GPIO9;

/** SPI0 MOSI (GPIO6). */
export const MOSI = GPIO6;
/** SPI0 MISO (GPIO5). */
export const MISO = GPIO5;
/** SPI0 clock (GPIO4). */
export const SCK = GPIO4;
/** SPI0 slave select (GPIO7). */
export const SS = GPIO7;

/** UART0 transmit (GPIO21). */
export const TX = GPIO21;
/** UART0 receive (GPIO20). */
export const RX = GPIO20;
