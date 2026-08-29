import type { RuntimePolyfillIR } from "../../api/index.js";

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
// Forward declarations — the strategy's shimLines() defines these AFTER the
// polyfill block (polyfills emit before shims in emitPreamble). Without the
// forward decls, the voter's __tc_gpio_read / __tc_delay_us calls below would
// be unresolved.
int __tc_gpio_read(uint32_t pin);
void __tc_delay_us(uint32_t us);

namespace __tc_safety {

// Settle delay between temporally-separated reads. ~2 us is enough to defeat
// single-event transient (SET) glitches on a typical GPIO line while staying
// well under a debounce timescale. Tunable in one place.
constexpr uint32_t TC_SAFETY_SETTLE_US = 2U;

// Perform 3 temporally-separated reads via the strategy-injected shim, take
// the majority. On disagreement, VoteDisagreement. On pin-mode mismatch,
// PinModeMismatch. On untracked pin, PinModeUnknown. value is left 0 when
// ok==false — callers must check 'ok' before consuming 'value'.
inline SafeReadResult read_safe(uint32_t pin) {
  SafeReadResult result;
  result.value    = 0x00000000U;
  result.category = SafetyFaultCategory::Ok;
  result.code     = SafetyFaultCode::Ok;
  result.status   = SafetyStatus::Ok;

  // 1. Confirm pin mode (Input, InputPullup, or InputPulldown are valid for
  // reading). Output is rejected (PinModeMismatch). InputPulldown is
  // accepted because it is a legitimate input mode on ESP32 (and AVR via
  // external pulldown); rejecting it caused false faults.
  const TrackedMode mode = get_pin_mode(pin);
  if (mode == TrackedMode::Unknown) {
    result.category = SafetyFaultCategory::Configuration;
    result.code     = SafetyFaultCode::PinModeUnknown;
    result.status   = SafetyStatus::Fault;
    return result;
  }
  if ((mode != TrackedMode::Input) && (mode != TrackedMode::InputPullup) && (mode != TrackedMode::InputPulldown)) {
    result.category = SafetyFaultCategory::Configuration;
    result.code     = SafetyFaultCode::PinModeMismatch;
    result.status   = SafetyStatus::Fault;
    return result;
  }

  // 2. 2-of-3 vote via the strategy-injected __tc_gpio_read shim.
  // __tc_delay_us provides temporal separation between reads so a single
  // input glitch is unlikely to corrupt two samples; the strategy injects a
  // real microsecond delay (Arduino/ESP32: delayMicroseconds; AVR:
  // _native_delay_us; native: stub).
  const uint32_t r0 = __tc_gpio_read(pin);
  __tc_delay_us(TC_SAFETY_SETTLE_US);
  const uint32_t r1 = __tc_gpio_read(pin);
  __tc_delay_us(TC_SAFETY_SETTLE_US);
  const uint32_t r2 = __tc_gpio_read(pin);

  if ((r0 == r1) && (r1 == r2)) {
    result.status = SafetyStatus::Ok;
    result.value  = r0 ? 0xFFFFFFFFU : 0x00000000U;
  } else {
    result.category = SafetyFaultCategory::Signal;
    result.code     = SafetyFaultCode::VoteDisagreement;
    result.status   = SafetyStatus::Fault;
  }
  return result;
}

// Namespace-scoped forwarding entry point — kept inside the namespace so
// the emitter's forward-declaration pass does not generate a global prototype
// that references SafeReadResult before the struct is defined.
inline SafeReadResult __tc_safety_read_safe(uint32_t pin) {
  return read_safe(pin);
}

}  // namespace __tc_safety`.trim()],
    shimMacros: [],
    dependencies: ["safety_mode_table"],
  };
}
