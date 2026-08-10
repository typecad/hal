// ---------------------------------------------------------------------------
// @typecad/mcu-esp32s3 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use GPIO numbers
// matching the ESP32-S3 datasheet and the silkscreen. The S3 has 45 GPIO
// (0-21, 26-48); GPIO 22-25 and 32-37 do NOT exist on the S3. All GPIOs are
// bidirectional (no input-only pins). DAC was removed on the S3.
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
export const GPIO26 = Pin.fromPort('GPIO26');
export const GPIO27 = Pin.fromPort('GPIO27');
export const GPIO28 = Pin.fromPort('GPIO28');
export const GPIO29 = Pin.fromPort('GPIO29');
export const GPIO30 = Pin.fromPort('GPIO30');
export const GPIO31 = Pin.fromPort('GPIO31');
export const GPIO32 = Pin.fromPort('GPIO32');
export const GPIO33 = Pin.fromPort('GPIO33');
export const GPIO34 = Pin.fromPort('GPIO34');
export const GPIO35 = Pin.fromPort('GPIO35');
export const GPIO36 = Pin.fromPort('GPIO36');
export const GPIO37 = Pin.fromPort('GPIO37');
export const GPIO38 = Pin.fromPort('GPIO38');
export const GPIO39 = Pin.fromPort('GPIO39');
export const GPIO40 = Pin.fromPort('GPIO40');
export const GPIO41 = Pin.fromPort('GPIO41');
export const GPIO42 = Pin.fromPort('GPIO42');
export const GPIO43 = Pin.fromPort('GPIO43');
export const GPIO44 = Pin.fromPort('GPIO44');
export const GPIO45 = Pin.fromPort('GPIO45');
export const GPIO46 = Pin.fromPort('GPIO46');
export const GPIO47 = Pin.fromPort('GPIO47');
export const GPIO48 = Pin.fromPort('GPIO48');

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
