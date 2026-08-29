// ---------------------------------------------------------------------------
// shiftOut / shiftIn — the thin bit-bang shift (the legacy shiftOut/shiftIn
// shape, Zephyr-lowered): clock idles low; each bit sets data then pulses the
// clock. For real SPI, use SPITarget. Pin arguments accept board pin aliases
// (resolved to their numbers by the transpiler).
// ---------------------------------------------------------------------------

import { gpioShiftOut, gpioShiftIn } from './emit.js';

export function shiftOut(dataPin: number, clockPin: number, value: number, msbFirst: boolean = true): void {
  gpioShiftOut(dataPin, clockPin, value, msbFirst);
}

export function shiftIn(dataPin: number, clockPin: number, msbFirst: boolean = true): number {
  return gpioShiftIn(dataPin, clockPin, msbFirst);
}
