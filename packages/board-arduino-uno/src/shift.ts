// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Shift register utilities
// ---------------------------------------------------------------------------

import type { IShiftNamespace } from '@typecode/core';

/** Bit order constants */
export { MSBFIRST, LSBFIRST } from '@typecode/core';

/** Shift data in from a pin. Maps to Arduino `shiftIn()`. */
export declare function shiftIn(dataPin: number, clockPin: number, bitOrder: number): number;

/** Shift data out to a pin. Maps to Arduino `shiftOut()`. */
export declare function shiftOut(dataPin: number, clockPin: number, bitOrder: number, value: number): void;

/** Stub for fluent shift chain. Transpiler handles actual code generation. */
export declare const Shift: IShiftNamespace;