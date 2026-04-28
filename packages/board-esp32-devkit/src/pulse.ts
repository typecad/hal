// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Pulse measurement utilities
// ---------------------------------------------------------------------------

import type { IPulseNamespace } from '@typehal/core';

/** Measure pulse length in microseconds. Maps to Arduino `pulseIn()`. */
export declare function pulseIn(pin: number, value: number, timeout?: number): number;

/** Measure pulse length (longer pulses). Maps to Arduino `pulseInLong()`. */
export declare function pulseInLong(pin: number, value: number, timeout?: number): number;

/** Stub for fluent pulse chain. Transpiler handles actual code generation. */
export declare const Pulse: IPulseNamespace;
