// ---------------------------------------------------------------------------
// @typecad/mcu-esp32s3 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal.
// Pin names use GPIO numbers matching the ESP32-S3 datasheet. The S3 has 45
// GPIO (0-21, 26-48); GPIO 22-25 and 32-37 do NOT exist on the S3. All GPIOs
// are bidirectional (no input-only pins). DAC was removed on the S3.
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
export const GPIO26 = new Pin(26);
export const GPIO27 = new Pin(27);
export const GPIO28 = new Pin(28);
export const GPIO29 = new Pin(29);
export const GPIO30 = new Pin(30);
export const GPIO31 = new Pin(31);
export const GPIO32 = new Pin(32);
export const GPIO33 = new Pin(33);
export const GPIO34 = new Pin(34);
export const GPIO35 = new Pin(35);
export const GPIO36 = new Pin(36);
export const GPIO37 = new Pin(37);
export const GPIO38 = new Pin(38);
export const GPIO39 = new Pin(39);
export const GPIO40 = new Pin(40);
export const GPIO41 = new Pin(41);
export const GPIO42 = new Pin(42);
export const GPIO43 = new Pin(43);
export const GPIO44 = new Pin(44);
export const GPIO45 = new Pin(45);
export const GPIO46 = new Pin(46);
export const GPIO47 = new Pin(47);
export const GPIO48 = new Pin(48);

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults)
// ---------------------------------------------------------------------------

/** I2C0 data line (GPIO8). */
export const SDA = GPIO8;
/** I2C0 clock line (GPIO9). */
export const SCL = GPIO9;

/** SPI0 MOSI — FSPI (GPIO12). */
export const MOSI = GPIO12;
/** SPI0 MISO — FSPI (GPIO13). */
export const MISO = GPIO13;
/** SPI0 clock — FSPI (GPIO11). */
export const SCK = GPIO11;
/** SPI0 slave select — FSPI (GPIO10). */
export const SS = GPIO10;

/** UART0 transmit (GPIO43). */
export const TX = GPIO43;
/** UART0 receive (GPIO44). */
export const RX = GPIO44;
