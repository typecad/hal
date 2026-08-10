// ---------------------------------------------------------------------------
// @typecad/mcu-esp32c3 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use GPIO numbers
// matching the ESP32-C3 datasheet and the silkscreen. The ESP32-C3 has 22 GPIO
// (0-10, 12-21); GPIO 11 is consumed by internal flash Vpp and is not broken
// out. All GPIOs are bidirectional (no input-only pins). DAC is not present.
//
// The preferred way to refer to a pin is its GPIO number form (GPIO0, GPIO2, …)
// because that is the notation printed in the datasheet and on a schematic —
// see "Pin Naming Conventions" in the root AGENTS.md. Each pin is constructed
// via Pin.fromPort("GPION") so the port string is the pin's canonical identity;
// the transpiler resolves it to the framework pin number via the MCU manifest.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

// ---------------------------------------------------------------------------
// Named GPIO constants (Pin instances)
// ---------------------------------------------------------------------------

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
// GPIO 11 — internal flash Vpp, not broken out on the C3 package.
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
