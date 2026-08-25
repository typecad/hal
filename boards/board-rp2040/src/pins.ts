// ---------------------------------------------------------------------------
// @typecad/board-rp2040 — Pin aliases
// ---------------------------------------------------------------------------

import {
  GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7,
  GP8, GP9, GP10, GP11, GP12, GP13, GP14, GP15,
  GP16, GP17, GP18, GP19, GP20, GP21, GP22,
  GP25,
  GP26, GP27, GP28,
} from '@typecad/mcu-rp2040';

// Dx aliases (GP0-GP22 + GP26-GP28; GP23-25 and GP29 are unsafe, omitted)
export const D0  = GP0;   export const D1  = GP1;   export const D2  = GP2;
export const D3  = GP3;   export const D4  = GP4;   export const D5  = GP5;
export const D6  = GP6;   export const D7  = GP7;   export const D8  = GP8;
export const D9  = GP9;   export const D10 = GP10;  export const D11 = GP11;
export const D12 = GP12;  export const D13 = GP13;  export const D14 = GP14;
export const D15 = GP15;  export const D16 = GP16;  export const D17 = GP17;
export const D18 = GP18;  export const D19 = GP19;  export const D20 = GP20;
export const D21 = GP21;  export const D22 = GP22;
export const D26 = GP26;  export const D27 = GP27;  export const D28 = GP28;

// Board-fixed alias: the onboard user LED (GP25, driven through the board's
// led0 DT spec). Expressed as the alias rather than a Dx entry because GP25
// is reserved for the LED — the MCU package marks generic GPIO use unsafe.
export const LED = GP25;

// Ax aliases (ADC channels)
export const A0 = GP26;
export const A1 = GP27;
export const A2 = GP28;

// Bus aliases
export { I2C0, I2C1, SPI0, SPI1, UART0, UART1 } from '@typecad/mcu-rp2040';

// USB CDC serial over the USB-C connector (the RP2040 USBD peripheral's
// dedicated D+/D- pads — not GPIOs, so there is no PeripheralPins entry).
// Board-level instance — the connector is board wiring, not silicon, so it
// lives here rather than in the MCU package.
import { USBSerialPort } from '@typecad/hal';
export const USB0 = new USBSerialPort('USBSerial');
