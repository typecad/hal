// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Shift register utilities
// ---------------------------------------------------------------------------

import type { IShiftNamespace, ShiftBitOrder } from '@typecode/core';

/** Bit order type */
export type { ShiftBitOrder } from '@typecode/core';

/** Shift data in from a pin. */
export declare function shiftIn(dataPin: number, clockPin: number, bitOrder: ShiftBitOrder): number;

/** Shift data out to a pin. */
export declare function shiftOut(dataPin: number, clockPin: number, bitOrder: ShiftBitOrder, value: number): void;

/** Stub for fluent shift chain. Transpiler handles actual code generation. */
export declare const Shift: IShiftNamespace;
