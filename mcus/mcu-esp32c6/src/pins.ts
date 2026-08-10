// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c6 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use GPIO numbers
// matching the ESP32-C6 datasheet and the silkscreen. The ESP32-C6 has 30 GPIO
// (0-7, 8-14, 15-30). All GPIOs are bidirectional. No DAC. No PSRAM.
//
// The preferred way to refer to a pin is its GPIO number form (GPIO0, GPIO2, …)
// because that is the notation printed in the datasheet and on a schematic —
// see "Pin Naming Conventions" in the root AGENTS.md. Each pin is constructed
// via Pin.fromPort("GPION") so the port string is the pin's canonical identity;
// the transpiler resolves it to the framework pin number via the MCU manifest.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

export const GPIO0  = Pin.fromPort('GPIO0');
export const GPIO1  = Pin.fromPort('GPIO1');
export const GPIO2  = Pin.fromPort('GPIO2');
export const GPIO3  = Pin.fromPort('GPIO3');
export const GPIO4  = Pin.fromPort('GPIO4');
export const GPIO5  = Pin.fromPort('GPIO5');
export const GPIO6  = Pin.fromPort('GPIO6');
export const GPIO7  = Pin.fromPort('GPIO7');
export const GPIO8  = Pin.fromPort('GPIO8');
export const GPIO9  = Pin.fromPort('GPIO9');
export const GPIO10 = Pin.fromPort('GPIO10');
export const GPIO11 = Pin.fromPort('GPIO11');
export const GPIO12 = Pin.fromPort('GPIO12');
export const GPIO13 = Pin.fromPort('GPIO13');
export const GPIO14 = Pin.fromPort('GPIO14');
export const GPIO15 = Pin.fromPort('GPIO15');
export const GPIO16 = Pin.fromPort('GPIO16');
export const GPIO17 = Pin.fromPort('GPIO17');
export const GPIO18 = Pin.fromPort('GPIO18');
export const GPIO19 = Pin.fromPort('GPIO19');
export const GPIO20 = Pin.fromPort('GPIO20');
export const GPIO21 = Pin.fromPort('GPIO21');
export const GPIO22 = Pin.fromPort('GPIO22');
export const GPIO23 = Pin.fromPort('GPIO23');
export const GPIO24 = Pin.fromPort('GPIO24');
export const GPIO25 = Pin.fromPort('GPIO25');
export const GPIO26 = Pin.fromPort('GPIO26');
export const GPIO27 = Pin.fromPort('GPIO27');
export const GPIO28 = Pin.fromPort('GPIO28');
export const GPIO29 = Pin.fromPort('GPIO29');
export const GPIO30 = Pin.fromPort('GPIO30');

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
