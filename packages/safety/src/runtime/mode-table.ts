import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";
import { emitResultStructs } from "./result-struct.js";

/** The pin-mode tracking table + accessors. Tree-shaken out unless
 *  __tc_safety_record_pin_mode appears in the program (registered in
 *  POLYFILL_HELPER_MAP).
 *
 *  Naming: internal types live in the __tc_safety namespace; the user-callable
 *  helpers are exposed at global scope as __tc_safety_* free functions. This
 *  matches the polyfill-helper-registry's extractor regex, which expects
 *  `__tc_*` immediately followed by `(`. */
export function modeTablePolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_mode_table",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [
      emitResultStructs(),
      `
namespace __tc_safety {
constexpr uint8_t TC_SAFETY_PIN_TABLE_SIZE = 255U;

enum class TrackedMode : uint8_t {
  Unknown     = 0U,
  Input       = 1U,
  Output      = 2U,
  InputPullup = 3U,
};

// Raw array: unavoidable for O(1) pin-indexed lookup in an embedded shim.
// Zero-initialized namespace-scope static storage (TrackedMode::Unknown = 0U)
// satisfies M3-2-1 (const-init) and M3-2-4 (trivial static init); no
// knownPatterns deviation is expected. If a rule fires anyway, add one.
TrackedMode g_pin_mode_table[TC_SAFETY_PIN_TABLE_SIZE];

inline void record_pin_mode(uint8_t pin, uint8_t mode) {
  if (pin < TC_SAFETY_PIN_TABLE_SIZE) {
    switch (mode) {
      case 0U: g_pin_mode_table[pin] = TrackedMode::Input;       break;
      case 1U: g_pin_mode_table[pin] = TrackedMode::Output;      break;
      case 2U: g_pin_mode_table[pin] = TrackedMode::InputPullup; break;
      default: g_pin_mode_table[pin] = TrackedMode::Unknown;     break;
    }
  }
}

inline TrackedMode get_pin_mode(uint8_t pin) {
  if (pin < TC_SAFETY_PIN_TABLE_SIZE) {
    return g_pin_mode_table[pin];
  }
  return TrackedMode::Unknown;
}
}  // namespace __tc_safety

// Global-scope callable wrappers (the __tc_safety_* names are what
// resolveSafetyOp emits and what POLYFILL_HELPER_MAP registers).
inline void __tc_safety_record_pin_mode(uint8_t pin, uint8_t mode) {
  __tc_safety::record_pin_mode(pin, mode);
}
`.trim(),
    ],
    shimMacros: [],
    dependencies: [],
  };
}
