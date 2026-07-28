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

/** Returns the C++ defining SafetyFaultCategory, SafetyFaultCode, SafeReadResult. */
export function emitResultStructs(): string {
  return `
enum class SafetyFaultCategory : uint8_t {
  Ok            = 0U,
  Signal        = 1U,
  Integrity     = 2U,
  Timing        = 3U,
  System        = 4U,
  Configuration = 5U,
};

enum class SafetyFaultCode : uint8_t {
  // Signal sub-codes (Part A: code 1 implemented; codes 2,3 reserved for stuck-fault detection)
  Ok               = 0U,
  VoteDisagreement = 1U,
  StuckHigh        = 2U,
  StuckLow         = 3U,
  // Configuration sub-codes (Part A: implemented)
  PinModeMismatch  = 16U,
  PinModeUnknown   = 17U,
  // Reserved ranges for Part B/C:
  //   32-47 Integrity (RAM CRC, ECC, ROM)
  //   48-63 Timing (program-flow, watchdog)
  //   64-79 System (MPU, stack)
};

struct SafeReadResult {
  bool ok;
  uint8_t value;
  SafetyFaultCategory category;
  SafetyFaultCode code;
};
`.trim();
}
