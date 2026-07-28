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

/** Returns the C++ enum + struct definitions for the safety runtime.
 *
 *  These are emitted by the polyfill as the SINGLE canonical source.
 *  @typecad/safety is skipped by the graph-builder (like @typecad/ui), so
 *  its TypeScript source is never parsed into the user program's IR — the
 *  type-decl emitter never sees the enums. The polyfill provides the
 *  definitions that both the voter and the user's switch statements
 *  reference. Works in both .ino (single-file) and .cc (split) modes because
 *  the polyfill is inlined into the entry file's source, visible to all
 *  functions in that translation unit. */
export function emitResultStructs(): string {
  return `
enum class SafetyFaultCategory : uint32_t {
  Ok            = 0x3C3C3C3CU,
  Signal        = 0x5A5A5A5AU,
  Integrity     = 0xA5A5A5A5U,
  Timing        = 0xC3C3C3C3U,
  System        = 0x55AA55AAU,
  Configuration = 0xAA55AA55U,
};

enum class SafetyFaultCode : uint32_t {
  Ok               = 0x3C3C3C3CU,
  VoteDisagreement = 0x5A5A5A5AU,
  StuckHigh        = 0xA5A5A5A5U,
  StuckLow         = 0xC3C3C3C3U,
  PinModeMismatch  = 0x55AA55AAU,
  PinModeUnknown   = 0xAA55AA55U,
};

constexpr uint32_t SAFETY_STATUS_OK = 0x5A5A5A5AU;
constexpr uint32_t SAFETY_STATUS_FAULT = 0xA5A5A5A5U;

struct SafeReadResult {
  uint32_t status;
  uint32_t value;
  SafetyFaultCategory category;
  SafetyFaultCode code;
};
`.trim();
}
