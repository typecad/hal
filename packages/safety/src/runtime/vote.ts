import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";

/** The 2-of-3 voter. Tree-shaken out unless __tc_safety_read_safe appears
 *  in the program (registered in POLYFILL_HELPER_MAP).
 *
 *  Naming: the voter lives in the __tc_safety namespace; the user-callable
 *  wrapper is exposed at global scope as __tc_safety_read_safe so the
 *  polyfill-helper-registry extractor regex matches it. */
export function voterPolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_read_safe",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [`
namespace __tc_safety {

// Perform 3 temporally-separated reads, take the majority. On disagreement,
// return VoteDisagreement. On pin-mode mismatch, PinModeMismatch. On
// untracked pin, PinModeUnknown. value is left 0 when ok==false — callers
// must check 'ok' before consuming 'value'.
inline SafeReadResult read_safe(uint8_t pin) {
  SafeReadResult result;
  result.value    = 0U;
  result.category = SafetyFaultCategory::Ok;
  result.code     = SafetyFaultCode::Ok;

  // 1. Confirm pin mode.
  const TrackedMode mode = get_pin_mode(pin);
  if (mode == TrackedMode::Unknown) {
    result.category = SafetyFaultCategory::Configuration;
    result.code     = SafetyFaultCode::PinModeUnknown;
    result.ok       = false;
    return result;
  }
  if ((mode != TrackedMode::Input) && (mode != TrackedMode::InputPullup)) {
    result.category = SafetyFaultCategory::Configuration;
    result.code     = SafetyFaultCode::PinModeMismatch;
    result.ok       = false;
    return result;
  }

  // 2. 2-of-3 vote (temporally separated reads).
  const uint8_t r0 = digitalRead(pin);
  for (uint8_t i = 0U; i < 50U; ++i) { /* short settle */ }
  const uint8_t r1 = digitalRead(pin);
  for (uint8_t i = 0U; i < 50U; ++i) { }
  const uint8_t r2 = digitalRead(pin);

  if ((r0 == r1) && (r1 == r2)) {
    result.ok    = true;
    result.value = r0;
  } else {
    result.category = SafetyFaultCategory::Signal;
    result.code     = SafetyFaultCode::VoteDisagreement;
    result.ok       = false;
  }
  return result;
}

}  // namespace __tc_safety

// Global-scope callable wrapper (the __tc_safety_read_safe name is what
// resolveSafetyOp emits and what POLYFILL_HELPER_MAP registers).
inline SafeReadResult __tc_safety_read_safe(uint8_t pin) {
  return __tc_safety::read_safe(pin);
}
`.trim()],
    shimMacros: [],
    dependencies: ["safety_mode_table"],
  };
}
