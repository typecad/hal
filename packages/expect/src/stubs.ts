// ---------------------------------------------------------------------------
// @typecad/expect — Firmware stubs
//
// These are `declare` functions — they provide types to the user's IDE but
// have no runtime body.  The test preprocessor rewrites every call into
// Serial protocol statements before the cuttlefish transpiler ever sees them.
// ---------------------------------------------------------------------------

import type { Suite } from './types';

/**
 * Open a describe group.  Returns a `Suite` to chain `.it()` / `.expect()`.
 *
 * @example
 * ```ts
 * describe("A0 analog read")
 *   .it("reads zero").expect(A0.readAnalog()).toBe(0);
 * ```
 */
export declare function describe(name: string): Suite;

/**
 * Mark the end of test execution.  Must be the last statement in every
 * test file.  Emits the `[TC:SUITE_END]` sentinel and enters an idle loop
 * so the host runner knows the firmware is done.
 */
export declare function done(): void;
