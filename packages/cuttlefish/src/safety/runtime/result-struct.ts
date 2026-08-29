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
 *  reference. Works in both single-file and split-file emit modes because
 *  the polyfill is inlined into the entry file's source, visible to all
 *  functions in that translation unit. */
export function emitResultStructs(): string {
  return `
enum class SafetyStatus : uint32_t {
  Ok    = 0x5A5A5A5AU,
  Fault = 0xA5A5A5A5U,
};

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
  WriteMismatch    = 0x3C5AA5C3U,
};

struct SafeReadResult {
  SafetyStatus status;
  uint32_t value;
  SafetyFaultCategory category;
  SafetyFaultCode code;

  // Chainable result handlers. Each calls the handler at runtime when its
  // condition matches, then returns *this so chains compose and the result
  // stays inspectable afterward. Template F&& accepts the inline C++ lambdas
  // cuttlefish renders — no std::function, no heap allocation.
  template <typename F>
  SafeReadResult& ok(F&& handler) noexcept {
    if (status == SafetyStatus::Ok) { handler(*this); }
    return *this;
  }
  template <typename F>
  SafeReadResult& fail(F&& handler) noexcept {
    if (status != SafetyStatus::Ok) { handler(*this); }
    return *this;
  }
  // fault is an alias of fail (no std::forward — avoids the <utility> header
  // AVR lacks; the handler is called once immediately, so perfect forwarding
  // is not load-bearing).
  template <typename F>
  SafeReadResult& fault(F&& handler) noexcept { return fail(handler); }
  template <typename F>
  SafeReadResult& always(F&& handler) noexcept { handler(*this); return *this; }
};

struct SafeWriteResult {
  SafetyStatus status;
  SafetyFaultCode code;

  template <typename F>
  SafeWriteResult& ok(F&& handler) noexcept {
    if (status == SafetyStatus::Ok) { handler(*this); }
    return *this;
  }
  template <typename F>
  SafeWriteResult& fail(F&& handler) noexcept {
    if (status != SafetyStatus::Ok) { handler(*this); }
    return *this;
  }
  template <typename F>
  SafeWriteResult& fault(F&& handler) noexcept { return fail(handler); }
  template <typename F>
  SafeWriteResult& always(F&& handler) noexcept { handler(*this); return *this; }
};
`.trim();
}
