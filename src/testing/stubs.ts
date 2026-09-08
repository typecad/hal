// ---------------------------------------------------------------------------
// @typecad/hal/testing — Firmware stubs
//
// These provide types to the user's IDE. The test preprocessor rewrites every
// call into Serial protocol statements before the typecad-hal transpiler ever
// sees them, so the runtime bodies are no-ops (only reached if the preprocessor
// is skipped, e.g. type-checking in the IDE).
// ---------------------------------------------------------------------------

import type { Suite } from './types.js';

/**
 * Open a describe group.  Returns a `Suite` to chain `.it()` / `.expect()`.
 *
 * @example
 * ```ts
 * describe("A0 analog read")
 *   .it("reads zero").expect(A0.readAnalog()).toBe(0);
 * ```
 */
export function describe(_name: string): Suite {
  return undefined as unknown as Suite;
}

/**
 * Mark the end of test execution.  Must be the last statement in every
 * test file.  Emits the `[TC:SUITE_END]` sentinel and enters an idle loop
 * so the host runner knows the firmware is done.
 */
export function done(): void {}
