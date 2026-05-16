// ---------------------------------------------------------------------------
// @typehal/mcu-atmega328p — Datasheet pin definitions
//
// Each pin is a Pin instance created via Pin.fromPort() using the MCU port
// name from the ATmega328P datasheet. The port name is the canonical identity;
// framework-specific pin numbers are resolved at
// transpile time via the arduino-map.
// ---------------------------------------------------------------------------

import { Pin } from '@typehal/hal';

// ---------------------------------------------------------------------------
// Port D (PD0–PD7) — 8-bit bidirectional I/O port
// DIP-28 pins 2–6, 9–11
// ---------------------------------------------------------------------------

export const PD0 = Pin.fromPort('PD0');
export const PD1 = Pin.fromPort('PD1');
export const PD2 = Pin.fromPort('PD2');
export const PD3 = Pin.fromPort('PD3');
export const PD4 = Pin.fromPort('PD4');
export const PD5 = Pin.fromPort('PD5');
export const PD6 = Pin.fromPort('PD6');
export const PD7 = Pin.fromPort('PD7');

// ---------------------------------------------------------------------------
// Port B (PB0–PB7) — 8-bit bidirectional I/O port
// DIP-28 pins 12–19 (PB6/PB7 are crystal oscillator, not GPIO)
// ---------------------------------------------------------------------------

export const PB0 = Pin.fromPort('PB0');
export const PB1 = Pin.fromPort('PB1');
export const PB2 = Pin.fromPort('PB2');
export const PB3 = Pin.fromPort('PB3');
export const PB4 = Pin.fromPort('PB4');
export const PB5 = Pin.fromPort('PB5');
export const PB6 = Pin.fromPort('PB6');
export const PB7 = Pin.fromPort('PB7');

// ---------------------------------------------------------------------------
// Port C (PC0–PC6) — 7-bit bidirectional I/O port (PC6 is RESET on DIP-28)
// DIP-28 pins 23–28
// ---------------------------------------------------------------------------

export const PC0 = Pin.fromPort('PC0');
export const PC1 = Pin.fromPort('PC1');
export const PC2 = Pin.fromPort('PC2');
export const PC3 = Pin.fromPort('PC3');
export const PC4 = Pin.fromPort('PC4');
export const PC5 = Pin.fromPort('PC5');
export const PC6 = Pin.fromPort('PC6');

// ---------------------------------------------------------------------------
// Convenience aliases (Silicon-level defaults)
// ---------------------------------------------------------------------------

/** I2C data line (PC4). */
export const SDA  = PC4;
/** I2C clock line (PC5). */
export const SCL  = PC5;

/** SPI master-out / slave-in (PB3). */
export const MOSI = PB3;
/** SPI master-in / slave-out (PB4). */
export const MISO = PB4;
/** SPI clock (PB5). */
export const SCK  = PB5;
/** SPI slave select (PB2). */
export const SS   = PB2;

/** UART transmit (PD1). */
export const TX   = PD1;
/** UART receive (PD0). */
export const RX   = PD0;
