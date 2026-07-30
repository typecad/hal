// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. The ESP32-C6 has 30 GPIO
// (0-7, 8-14, 15-30). All GPIOs are bidirectional. No DAC. No PSRAM.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

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
export const GPIO11 = new Pin(11);
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
export const GPIO22 = new Pin(22);
export const GPIO23 = new Pin(23);
export const GPIO24 = new Pin(24);
export const GPIO25 = new Pin(25);
export const GPIO26 = new Pin(26);
export const GPIO27 = new Pin(27);
export const GPIO28 = new Pin(28);
export const GPIO29 = new Pin(29);
export const GPIO30 = new Pin(30);

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults — match Arduino-ESP32 core)
// ---------------------------------------------------------------------------

/** I2C0 data line (GPIO23). */
export const SDA = GPIO23;
/** I2C0 clock line (GPIO22). */
export const SCL = GPIO22;

/** SPI0 MOSI (GPIO19). */
export const MOSI = GPIO19;
/** SPI0 MISO (GPIO20). */
export const MISO = GPIO20;
/** SPI0 clock (GPIO21). */
export const SCK = GPIO21;
/** SPI0 slave select (GPIO18). */
export const SS = GPIO18;

/** UART0 transmit (GPIO16). */
export const TX = GPIO16;
/** UART0 receive (GPIO17). */
export const RX = GPIO17;
