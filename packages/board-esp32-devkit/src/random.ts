// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Random number utilities
// ---------------------------------------------------------------------------

import type { IRandomNamespace } from '@typehal/core';

/** Initialize pseudo-random number generator. Maps to Arduino `randomSeed()`. */
export declare function randomSeed(seed: number): void;

/** Generate random number up to max (exclusive). Maps to Arduino `random(max)`. */
export declare function random(max: number): number;

/** Generate random number in range [min, max). Maps to Arduino `random(min, max)`. */
export declare function random(min: number, max: number): number;

/** Stub for fluent random chain. Transpiler handles actual code generation. */
export declare const Random: IRandomNamespace;
