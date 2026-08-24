// ---------------------------------------------------------------------------
// @typecad/board-xiao-nrf52840 — Pin aliases and header mappings
//
// The mcu package already exports the D0–D10 / LED / BUTTON / bus pins by
// their canonical names (they match the XIAO silkscreen directly, unlike
// ESP32 where the board adds D-number aliases over GPIO numbers). This file
// only adds the board-specific analog aliases (A0–A3 → D0–D3) and re-exports
// the bus-pin aliases for IDE convenience.
// ---------------------------------------------------------------------------

import { D0, D1, D2, D3 } from '@typecad/mcu-nrf52840';
import { USBSerialPort } from '@typecad/hal';

// ---------------------------------------------------------------------------

// Analog input aliases (SAADC channels on XIAO D0–D3)
// ---------------------------------------------------------------------------

export const A0 = D0;
export const A1 = D1;
export const A2 = D2;
export const A3 = D3;

// ---------------------------------------------------------------------------
// USB CDC serial over the XIAO's USB-C connector (nRF52840 native USBD).
// Board-level instance — the connector is board wiring, not silicon.
// ---------------------------------------------------------------------------

export const USB0 = new USBSerialPort('USBSerial');
