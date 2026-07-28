// C++ source strings for the safety result struct + fault enums. Emitted by
// the mode-table polyfill (Task 9) BEFORE the voter, so the voter can return
// a SafeReadResult.
//
// AUTOSAR C++14 compliance:
//  - enum class (A7-2-1)
//  - fixed-width types (A3-9-1): uint8_t
//  - no C-style casts (M5-0-7), no malloc (A18-5-10)
//  - the raw pin table in mode-table.ts is zero-initialized namespace-scope
//    static storage, satisfying M3-2-1/M3-2-4. No knownPatterns deviation is
//    expected; if a rule fires anyway, add one (see
//    docs/superpowers/plans/2026-07-27-safety-package-part-a.md Task 17).

/** Returns the C++ SafeReadResult struct definition.
 *
 *  NOTE: SafetyFaultCategory and SafetyFaultCode are NOT emitted here. They
 *  are TypeScript `enum`s in the public API (index.ts), which the cuttlefish
 *  transpiler lowers to C++ `enum class` definitions in user code. The
 *  polyfill only emits the SafeReadResult struct that references them by
 *  name. Emitting the enums here too would cause duplicate-definition
 *  conflicts with the user-code lowering. */
export function emitResultStructs(): string {
  return `
struct SafeReadResult {
  bool ok;
  uint8_t value;
  SafetyFaultCategory category;
  SafetyFaultCode code;
};
`.trim();
}
