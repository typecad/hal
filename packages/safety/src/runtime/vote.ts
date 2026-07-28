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
// Forward declaration — the strategy's shimLines() defines this AFTER the
// polyfill block (polyfills emit before shims in emitPreamble). Without the
// forward decl, the voter's __tc_gpio_read calls below would be unresolved.
int __tc_gpio_read(uint32_t pin);

namespace __tc_safety {

// Perform 3 temporally-separated reads via the strategy-injected shim, take
// the majority. On disagreement, VoteDisagreement. On pin-mode mismatch,
// PinModeMismatch. On untracked pin, PinModeUnknown. value is left 0 when
// ok==false — callers must check 'ok' before consuming 'value'.
inline SafeReadResult read_safe(uint32_t pin) {
  SafeReadResult result;
  result.value    = 0x00000000U;
  result.category = SafetyFaultCategory::Ok;
  result.code     = SafetyFaultCode::Ok;
  result.status   = SAFETY_STATUS_OK;

  // 1. Confirm pin mode (Input or InputPullup are valid for reading).
  const TrackedMode mode = get_pin_mode(pin);
  if (mode == TrackedMode::Unknown) {
    result.category = SafetyFaultCategory::Configuration;
    result.code     = SafetyFaultCode::PinModeUnknown;
    result.status   = SAFETY_STATUS_FAULT;
    return result;
  }
  if ((mode != TrackedMode::Input) && (mode != TrackedMode::InputPullup)) {
    result.category = SafetyFaultCategory::Configuration;
    result.code     = SafetyFaultCode::PinModeMismatch;
    result.status   = SAFETY_STATUS_FAULT;
    return result;
  }

  // 2. 2-of-3 vote via the strategy-injected __tc_gpio_read shim.
  const uint32_t r0 = __tc_gpio_read(pin);
  for (uint32_t i = 0U; i < 50U; ++i) { /* short settle */ }
  const uint32_t r1 = __tc_gpio_read(pin);
  for (uint32_t i = 0U; i < 50U; ++i) { }
  const uint32_t r2 = __tc_gpio_read(pin);

  if ((r0 == r1) && (r1 == r2)) {
    result.status = SAFETY_STATUS_OK;
    result.value  = r0 ? 0xFFFFFFFFU : 0x00000000U;
  } else {
    result.category = SafetyFaultCategory::Signal;
    result.code     = SafetyFaultCode::VoteDisagreement;
    result.status   = SAFETY_STATUS_FAULT;
  }
  return result;
}

// Namespace-scoped forwarding entry point — kept inside the namespace so
// Arduino's .ino preprocessor does not generate a global prototype that
// references SafeReadResult before the struct is defined.
inline SafeReadResult __tc_safety_read_safe(uint32_t pin) {
  return read_safe(pin);
}

}  // namespace __tc_safety`.trim()],
    shimMacros: [],
    dependencies: ["safety_mode_table"],
  };
}
