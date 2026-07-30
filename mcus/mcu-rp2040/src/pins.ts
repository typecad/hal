// ---------------------------------------------------------------------------
// @typecad/mcu-rp2040 — Datasheet pin definitions
// 30 GPIO (GP0-GP29). GP23-GP25 and GP29 are connected to internal flash/LED
// on the Pico and are flagged unsafe. All GPIOs are bidirectional. No DAC.
// ---------------------------------------------------------------------------

import { Pin } from '@typecad/hal';

export const GP0  = new Pin(0);
export const GP1  = new Pin(1);
export const GP2  = new Pin(2);
export const GP3  = new Pin(3);
export const GP4  = new Pin(4);
export const GP5  = new Pin(5);
export const GP6  = new Pin(6);
export const GP7  = new Pin(7);
export const GP8  = new Pin(8);
export const GP9  = new Pin(9);
export const GP10 = new Pin(10);
export const GP11 = new Pin(11);
export const GP12 = new Pin(12);
export const GP13 = new Pin(13);
export const GP14 = new Pin(14);
export const GP15 = new Pin(15);
export const GP16 = new Pin(16);
export const GP17 = new Pin(17);
export const GP18 = new Pin(18);
export const GP19 = new Pin(19);
export const GP20 = new Pin(20);
export const GP21 = new Pin(21);
export const GP22 = new Pin(22);
export const GP23 = new Pin(23);
export const GP24 = new Pin(24);
export const GP25 = new Pin(25);
export const GP26 = new Pin(26);
export const GP27 = new Pin(27);
export const GP28 = new Pin(28);
export const GP29 = new Pin(29);

// Bus aliases (match earlephilhower core defaults)
export const SDA = GP4;
export const SCL = GP5;
export const MOSI = GP19;
export const MISO = GP16;
export const SCK = GP18;
export const SS = GP17;
export const TX = GP0;
export const RX = GP1;
