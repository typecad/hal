// ---------------------------------------------------------------------------
// @typecad/mcu-rp2040 — Datasheet pin definitions
//
// Each pin is a Pin instance from @typecad/hal. Pin names use the Raspberry Pi
// GP<number> form matching the RP2040 datasheet and the Pico silkscreen. 30 GPIO
// (GP0-GP29); GP23-GP25 and GP29 are connected to internal flash/LED on the
// Pico and are flagged unsafe. All GPIOs are bidirectional. No DAC.
//
// The preferred way to refer to a pin is its GP form (GP0, GP1, …) because that
// is the notation printed in the datasheet and on a schematic — see "Pin Naming
// Conventions" in the root AGENTS.md. Each pin is constructed via
// Pin.fromPort("GPN") so the port string is the pin's canonical identity; the
// transpiler resolves it to the framework pin number via the MCU manifest.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

export const GP0  = Pin.fromPort('GP0');
export const GP1  = Pin.fromPort('GP1');
export const GP2  = Pin.fromPort('GP2');
export const GP3  = Pin.fromPort('GP3');
export const GP4  = Pin.fromPort('GP4');
export const GP5  = Pin.fromPort('GP5');
export const GP6  = Pin.fromPort('GP6');
export const GP7  = Pin.fromPort('GP7');
export const GP8  = Pin.fromPort('GP8');
export const GP9  = Pin.fromPort('GP9');
export const GP10 = Pin.fromPort('GP10');
export const GP11 = Pin.fromPort('GP11');
export const GP12 = Pin.fromPort('GP12');
export const GP13 = Pin.fromPort('GP13');
export const GP14 = Pin.fromPort('GP14');
export const GP15 = Pin.fromPort('GP15');
export const GP16 = Pin.fromPort('GP16');
export const GP17 = Pin.fromPort('GP17');
export const GP18 = Pin.fromPort('GP18');
export const GP19 = Pin.fromPort('GP19');
export const GP20 = Pin.fromPort('GP20');
export const GP21 = Pin.fromPort('GP21');
export const GP22 = Pin.fromPort('GP22');
export const GP23 = Pin.fromPort('GP23');
export const GP24 = Pin.fromPort('GP24');
export const GP25 = Pin.fromPort('GP25');
export const GP26 = Pin.fromPort('GP26');
export const GP27 = Pin.fromPort('GP27');
export const GP28 = Pin.fromPort('GP28');
export const GP29 = Pin.fromPort('GP29');

// Bus aliases (match earlephilhower core defaults)
export const SDA = GP4;
export const SCL = GP5;
export const MOSI = GP19;
export const MISO = GP16;
export const SCK = GP18;
export const SS = GP17;
export const TX = GP0;
export const RX = GP1;
