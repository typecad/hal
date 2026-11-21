// ---------------------------------------------------------------------------
// shiftOut / shiftIn — the thin bit-bang shift (the legacy shiftOut/shiftIn
// shape, Zephyr-lowered): clock idles low; each bit sets data then pulses the
// clock. For real SPI, use SPITarget. Pin arguments accept board pin aliases
// (resolved to their numbers by the transpiler).
// ---------------------------------------------------------------------------

import { gpioShiftOut, gpioShiftIn } from './emit.js';
import type { Pin } from './gpio.js';

/** Shift one byte out, bit by bit: sets each data bit on `dataPin`, then
 *  pulses `clockPin` (which idles low). MSB first unless `msbFirst` is
 *  false. Software-timed — for a real SPI peripheral use SPITarget. Pin
 *  arguments accept board pin aliases or `.number` (resolved to their
 *  numbers by the transpiler). */
export function shiftOut(dataPin: number | Pin, clockPin: number | Pin, value: number, msbFirst: boolean = true): void {
  gpioShiftOut(dataPin, clockPin, value, msbFirst);
}

/** Shift one byte in, bit by bit: pulses `clockPin` (which idles low) and
 *  reads `dataPin` for each bit. MSB first unless `msbFirst` is false.
 *  Software-timed — for a real SPI peripheral use SPITarget. Pin arguments
 *  accept board pin aliases or `.number` (resolved to their numbers by the
 *  transpiler). */
export function shiftIn(dataPin: number | Pin, clockPin: number | Pin, msbFirst: boolean = true): number {
  return gpioShiftIn(dataPin, clockPin, msbFirst);
}
