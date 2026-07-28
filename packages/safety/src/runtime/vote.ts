import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";

/** The 2-of-3 voter. Tree-shaken out unless __tc_safety_read_safe appears
 *  in the program (registered in POLYFILL_HELPER_MAP).
 *
 *  MCU-agnosticism: the voter reads via the strategy-injected __tc_gpio_read
 *  shim (defined per-target by each framework strategy's shimLines()). The
 *  safety package references zero target-specific symbols. */
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

// Perform 3 temporally-separated reads via the strategy-injected shim, take
// the majority. On disagreement, VoteDisagreement. On pin-mode mismatch,
// PinModeMismatch. On untracked pin, PinModeUnknown. value is left 0 when
// ok==false — callers must check 'ok' before consuming 'value'.
inline SafeReadResult read_safe(uint8_t pin) {
  SafeReadResult result;
  result.value    = 0U;
  result.category = SafetyFaultCategory::Ok;
  result.code     = SafetyFaultCode::Ok;

  // 1. Confirm pin mode (Input or InputPullup are valid for reading).
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

  // 2. 2-of-3 vote via the strategy-injected __tc_gpio_read shim.
  const uint8_t r0 = __tc_gpio_read(pin);
  for (uint8_t i = 0U; i < 50U; ++i) { /* short settle */ }
  const uint8_t r1 = __tc_gpio_read(pin);
  for (uint8_t i = 0U; i < 50U; ++i) { }
  const uint8_t r2 = __tc_gpio_read(pin);

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

inline SafeReadResult __tc_safety_read_safe(uint8_t pin) {
  return __tc_safety::read_safe(pin);
}
`.trim()],
    shimMacros: [],
    dependencies: ["safety_mode_table"],
  };
}
