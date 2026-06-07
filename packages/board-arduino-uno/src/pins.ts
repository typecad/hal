// ---------------------------------------------------------------------------
// @typecad/board-arduino-uno — Pin exports
//
// Each pin is a Pin instance from @typecad/hal. The transpiler inlines
// method calls (high(), low(), write(), etc.) as direct Arduino C++.
// Pin names use MCU port identifiers (PD0, PB5, PC0) matching the
// ATmega328P datasheet and KiCad symbol library.
//
// Port-name pins are imported from the MCU package and re-exported here
// for backward compatibility. The Pin.fromPort() factory stores both the
// port name and the resolved Arduino pin number.
// ---------------------------------------------------------------------------

// Import datasheet pins from MCU package — these use Pin.fromPort() internally
// so each Pin carries both its port name (PB5) and Arduino pin number (13).
export {
  PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7,
  PB0, PB1, PB2, PB3, PB4, PB5,
  PC0, PC1, PC2, PC3, PC4, PC5,
} from '@typecad/mcu-atmega328p';

// Re-import for local aliasing
import {
  PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7,
  PB0, PB1, PB2, PB3, PB4, PB5,
  PC0, PC1, PC2, PC3, PC4, PC5,
} from '@typecad/mcu-atmega328p';

// ---------------------------------------------------------------------------
// Arduino-style pin aliases (D0–D13, A0–A5)
// ---------------------------------------------------------------------------

export const D0  = PD0;
export const D1  = PD1;
export const D2  = PD2;
export const D3  = PD3;
export const D4  = PD4;
export const D5  = PD5;
export const D6  = PD6;
export const D7  = PD7;
export const D8  = PB0;
export const D9  = PB1;
export const D10 = PB2;
export const D11 = PB3;
export const D12 = PB4;
export const D13 = PB5;

export const A0 = PC0;
export const A1 = PC1;
export const A2 = PC2;
export const A3 = PC3;
export const A4 = PC4;
export const A5 = PC5;

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

/** On-board LED (PB5). */
export const LED  = PB5;

// Re-export silicon-level aliases (SDA, MOSI, etc.) from MCU package
export { SDA, SCL, MOSI, MISO, SCK, SS, TX, RX } from '@typecad/mcu-atmega328p';
